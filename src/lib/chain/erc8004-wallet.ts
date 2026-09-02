import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { bsc } from "viem/chains";
import {
  BSC_MAINNET_CHAIN_ID,
  ERC8004_IDENTITY_REGISTRY_ABI,
  ERC8004_IDENTITY_REGISTRY_ADDRESS,
} from "./erc8004-contract";
import { createBscMainnetTransport, DEFAULT_BSC_MAINNET_RPC_URL } from "./bsc-mainnet-rpc";

const REQUEST_TIMEOUT_MS = 10_000;

export interface InjectedErc8004Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  providers?: InjectedErc8004Provider[];
}

export interface ConnectedErc8004Wallet {
  account: Address;
  chainId: typeof BSC_MAINNET_CHAIN_ID;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

export interface Erc8004TransactionResult {
  transactionHash: Hex;
  explorerUrl: string;
}

export interface Erc8004RegistrationResult extends Erc8004TransactionResult {
  agentId: string;
  agentExplorerUrl: string;
}

function getInjectedProvider(): InjectedErc8004Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as Window & { ethereum?: InjectedErc8004Provider };
  const injected = win.ethereum;
  if (!injected) return undefined;
  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    return injected.providers.find((provider) => provider.isMetaMask) ?? injected.providers[0];
  }
  return injected;
}

function configuredRpcUrl() {
  return process.env.NEXT_PUBLIC_ERC8004_RPC_URL?.trim()
    || process.env.NEXT_PUBLIC_BSC_RPC_URL?.trim()
    || DEFAULT_BSC_MAINNET_RPC_URL;
}

function createMainnetPublicClient(rpcUrl = configuredRpcUrl()): PublicClient {
  return createPublicClient({
    chain: bsc,
    transport: createBscMainnetTransport(rpcUrl, REQUEST_TIMEOUT_MS),
  });
}

export async function connectErc8004Wallet(): Promise<ConnectedErc8004Wallet> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet was found. Install a wallet that supports BSC Mainnet.");

  const walletClient = createWalletClient({
    chain: bsc,
    transport: custom(provider),
  });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("The wallet did not return an account.");

  const chainId = await walletClient.getChainId();
  if (chainId !== BSC_MAINNET_CHAIN_ID) {
    throw new Error(`Wrong network. Switch the wallet to BSC Mainnet (chain ${BSC_MAINNET_CHAIN_ID}).`);
  }

  return {
    account,
    chainId: BSC_MAINNET_CHAIN_ID,
    walletClient,
    publicClient: createMainnetPublicClient(),
  };
}

function transactionExplorerUrl(hash: Hex) {
  return `https://bscscan.com/tx/${hash}`;
}

function agentExplorerUrl(agentId: string) {
  return `https://bscscan.com/token/${ERC8004_IDENTITY_REGISTRY_ADDRESS}?a=${encodeURIComponent(agentId)}`;
}

function readRegisteredAgent(receipt: { logs: readonly { data: Hex; topics: readonly Hex[] }[] }) {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: ERC8004_IDENTITY_REGISTRY_ABI,
        eventName: "Registered",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const agentId = decoded.args.agentId;
      if (typeof agentId === "bigint") return { agentId: agentId.toString(), owner: decoded.args.owner };
    } catch {
      // Receipts can contain logs from other contracts. Keep looking for Registered.
    }
  }
  return undefined;
}

export async function registerErc8004Identity(input: ConnectedErc8004Wallet): Promise<Erc8004RegistrationResult> {
  const transactionHash = await input.walletClient.writeContract({
    address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [],
    account: input.account,
    chain: bsc,
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error("The ERC 8004 identity registration transaction reverted.");

  const registered = readRegisteredAgent(receipt);
  if (!registered) throw new Error("The registration succeeded, but no ERC 8004 agent ID was found in the receipt.");
  if (registered.owner.toLowerCase() !== input.account.toLowerCase()) {
    throw new Error("The registration receipt does not belong to the connected wallet.");
  }

  const owner = await input.publicClient.readContract({
    address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [BigInt(registered.agentId)],
  });
  if (owner.toLowerCase() !== input.account.toLowerCase()) {
    throw new Error("The new ERC 8004 identity is not owned by the connected wallet.");
  }

  return {
    agentId: registered.agentId,
    transactionHash,
    explorerUrl: transactionExplorerUrl(transactionHash),
    agentExplorerUrl: agentExplorerUrl(registered.agentId),
  };
}

function validAgentId(agentId: string) {
  const normalized = agentId.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("The ERC 8004 agent ID must contain digits only.");
  return normalized;
}

function validMetadataUri(uri: string) {
  const normalized = uri.trim();
  if (!normalized || normalized.length > 2_000) throw new Error("The metadata URI is required and must be no more than 2,000 characters.");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("The metadata URI must be a valid URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("The metadata URI must use HTTPS.");
  const hostname = parsed.hostname.toLowerCase();
  const privateIpv4 = /^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[0-1]))\./.test(hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || privateIpv4 || hostname === "::1" || hostname === "[::1]") {
    throw new Error("The metadata URI must use a public HTTPS host.");
  }
  return normalized;
}

export async function setErc8004AgentUri(
  input: ConnectedErc8004Wallet,
  agentId: string,
  metadataUri: string,
): Promise<Erc8004TransactionResult> {
  const normalizedAgentId = validAgentId(agentId);
  const normalizedUri = validMetadataUri(metadataUri);
  const tokenId = BigInt(normalizedAgentId);
  const owner = await input.publicClient.readContract({
    address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  });
  if (owner.toLowerCase() !== input.account.toLowerCase()) {
    throw new Error("The connected wallet does not own this ERC 8004 identity.");
  }

  const transactionHash = await input.walletClient.writeContract({
    address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: "setAgentURI",
    args: [tokenId, normalizedUri],
    account: input.account,
    chain: bsc,
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error("The ERC 8004 metadata update transaction reverted.");

  const currentUri = await input.publicClient.readContract({
    address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: "tokenURI",
    args: [tokenId],
  });
  if (currentUri !== normalizedUri) throw new Error("The transaction succeeded, but the registry returned a different metadata URI.");

  return { transactionHash, explorerUrl: transactionExplorerUrl(transactionHash) };
}
