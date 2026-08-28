import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  http,
  isAddress,
  keccak256,
  maxUint256,
  parseAbi,
  parseUnits,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";

export const ERC8183_NETWORK = "eip155:56" as const;
export const ERC8183_TESTNET_NETWORK = "eip155:97" as const;
export type ERC8183Network = typeof ERC8183_NETWORK | typeof ERC8183_TESTNET_NETWORK;
export const ERC8183_CHAIN_ID = 56;
export const ERC8183_TESTNET_CHAIN_ID = 97;
export const ERC8183_STATUS = {
  open: 0,
  funded: 1,
  submitted: 2,
  completed: 3,
  rejected: 4,
  expired: 5,
} as const;

const DEFAULT_RPC_URL = "https://bsc.publicnode.com";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * ABI for the deployed AgenticCommerce kernel (bnbagent-sdk v1 stack).
 * Deployments: bsc-mainnet 0xea4daa3100a767e86fded867729ae7446476eba6,
 * bsc-testnet 0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de. Addresses remain
 * configuration values and the adapter stays disabled until they are set.
 */
export const ERC8183_ABI = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)",
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes deliverable))",
  "function paymentToken() view returns (address)",
  "function jobCounter() view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  "event JobFunded(uint256 indexed jobId, address indexed client, address payer, uint256 amount)",
]);

export const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export interface ERC8183Config {
  contractAddress?: Address;
  paymentTokenAddress?: Address;
  evaluatorAddress?: Address;
  hookAddress: Address;
  rpcUrl: string;
  rpcSource: "environment" | "default";
  network: ERC8183Network;
  networkName: "BSC Mainnet" | "BSC Testnet";
  chainId: typeof ERC8183_CHAIN_ID | typeof ERC8183_TESTNET_CHAIN_ID;
  networkConfigured: boolean;
  contractConfigured: boolean;
  paymentTokenConfigured: boolean;
  evaluatorConfigured: boolean;
  hookConfigured: boolean;
  missing: readonly string[];
  enabled: boolean;
  reason?: string;
}

export interface InjectedEip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

export interface ConnectedBscWallet {
  account: Address;
  chainId: number;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

function readEnvValue(key: string) {
  switch (key) {
    case "NEXT_PUBLIC_HIRE_NETWORK": return process.env.NEXT_PUBLIC_HIRE_NETWORK;
    case "HIRE_NETWORK": return process.env.HIRE_NETWORK;
    case "NEXT_PUBLIC_BSC_RPC_URL": return process.env.NEXT_PUBLIC_BSC_RPC_URL;
    case "BSC_RPC_URL": return process.env.BSC_RPC_URL;
    case "NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS": return process.env.NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS;
    case "ERC8183_CONTRACT_ADDRESS": return process.env.ERC8183_CONTRACT_ADDRESS;
    case "NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS": return process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS;
    case "PAYMENT_TOKEN_ADDRESS": return process.env.PAYMENT_TOKEN_ADDRESS;
    case "NEXT_PUBLIC_ERC8183_PAYMENT_TOKEN_ADDRESS": return process.env.NEXT_PUBLIC_ERC8183_PAYMENT_TOKEN_ADDRESS;
    case "ERC8183_PAYMENT_TOKEN_ADDRESS": return process.env.ERC8183_PAYMENT_TOKEN_ADDRESS;
    case "NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS": return process.env.NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS;
    case "ERC8183_EVALUATOR_ADDRESS": return process.env.ERC8183_EVALUATOR_ADDRESS;
    case "NEXT_PUBLIC_ERC8183_HOOK_ADDRESS": return process.env.NEXT_PUBLIC_ERC8183_HOOK_ADDRESS;
    case "ERC8183_HOOK_ADDRESS": return process.env.ERC8183_HOOK_ADDRESS;
    default: return undefined;
  }
}

function readAddressSetting(...keys: string[]) {
  for (const key of keys) {
    const value = readEnvValue(key)?.trim();
    if (!value) continue;
    return {
      key,
      value,
      address: isAddress(value) ? value as Address : undefined,
    };
  }
  return { key: keys[0], value: undefined, address: undefined };
}

function readRpcUrl() {
  const configured = readEnvValue("NEXT_PUBLIC_BSC_RPC_URL")?.trim() || readEnvValue("BSC_RPC_URL")?.trim();
  return {
    url: configured || DEFAULT_RPC_URL,
    source: configured ? "environment" as const : "default" as const,
  };
}

function readNetworkSetting() {
  const configured = readEnvValue("NEXT_PUBLIC_HIRE_NETWORK")?.trim() || readEnvValue("HIRE_NETWORK")?.trim();
  const normalized = configured?.toLowerCase();
  if (normalized === "bsc-mainnet" || normalized === "mainnet" || normalized === "56") {
    return { configured: true, network: ERC8183_NETWORK, networkName: "BSC Mainnet" as const, chainId: ERC8183_CHAIN_ID as 56 };
  }
  if (normalized === "bsc-testnet" || normalized === "testnet" || normalized === "97") {
    return { configured: true, network: ERC8183_TESTNET_NETWORK, networkName: "BSC Testnet" as const, chainId: ERC8183_TESTNET_CHAIN_ID as 97 };
  }
  return { configured: false, network: ERC8183_NETWORK, networkName: "BSC Mainnet" as const, chainId: ERC8183_CHAIN_ID as 56 };
}

export function getERC8183Config(): ERC8183Config {
  const networkSetting = readNetworkSetting();
  const rpc = readRpcUrl();
  const contractSetting = readAddressSetting("NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS", "ERC8183_CONTRACT_ADDRESS");
  const paymentTokenSetting = readAddressSetting(
    "NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS",
    "PAYMENT_TOKEN_ADDRESS",
    "NEXT_PUBLIC_ERC8183_PAYMENT_TOKEN_ADDRESS",
    "ERC8183_PAYMENT_TOKEN_ADDRESS",
  );
  const evaluatorSetting = readAddressSetting("NEXT_PUBLIC_ERC8183_EVALUATOR_ADDRESS", "ERC8183_EVALUATOR_ADDRESS");
  const hookSetting = readAddressSetting("NEXT_PUBLIC_ERC8183_HOOK_ADDRESS", "ERC8183_HOOK_ADDRESS");
  const missing: string[] = [];
  if (!networkSetting.configured) missing.push("NEXT_PUBLIC_HIRE_NETWORK");
  if (contractSetting.value && !contractSetting.address) missing.push(`${contractSetting.key} is not a valid address`);
  else if (!contractSetting.address) missing.push("ERC8183_CONTRACT_ADDRESS");
  if (paymentTokenSetting.value && !paymentTokenSetting.address) missing.push(`${paymentTokenSetting.key} is not a valid address`);
  else if (!paymentTokenSetting.address) missing.push("PAYMENT_TOKEN_ADDRESS");
  if (evaluatorSetting.value && !evaluatorSetting.address) missing.push(`${evaluatorSetting.key} is not a valid address`);
  if (hookSetting.value && !hookSetting.address) missing.push(`${hookSetting.key} is not a valid address`);
  const reason = missing.length ? `Live hiring is blocked. Configure ${missing.join(", ")}.` : undefined;
  return {
    contractAddress: contractSetting.address,
    paymentTokenAddress: paymentTokenSetting.address,
    evaluatorAddress: evaluatorSetting.address,
    hookAddress: hookSetting.address ?? zeroAddress,
    rpcUrl: rpc.url,
    rpcSource: rpc.source,
    network: networkSetting.network,
    networkName: networkSetting.networkName,
    chainId: networkSetting.chainId,
    networkConfigured: networkSetting.configured,
    contractConfigured: Boolean(contractSetting.address),
    paymentTokenConfigured: Boolean(paymentTokenSetting.address),
    evaluatorConfigured: Boolean(evaluatorSetting.address),
    hookConfigured: Boolean(hookSetting.address),
    missing,
    enabled: missing.length === 0,
    reason,
  };
}

function configuredChain() {
  return getERC8183Config().chainId === ERC8183_TESTNET_CHAIN_ID ? bscTestnet : bsc;
}

export function createBscPublicClient(rpcUrl = readRpcUrl().url): PublicClient {
  return createPublicClient({
    chain: configuredChain(),
    transport: http(rpcUrl, { timeout: REQUEST_TIMEOUT_MS }),
  });
}

export interface InjectedProviderCandidate extends InjectedEip1193Provider {
  isMetaMask?: boolean;
  providers?: InjectedProviderCandidate[];
}

export function getInjectedProvider(): InjectedEip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as Window & { ethereum?: InjectedProviderCandidate };
  const injected = win.ethereum;
  if (!injected) return undefined;
  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    const metamask = injected.providers.find((provider) => provider.isMetaMask);
    if (metamask) return metamask;
  }
  return injected;
}

export async function connectBscWallet(): Promise<ConnectedBscWallet> {
  const config = getERC8183Config();
  if (!config.networkConfigured) throw new Error(config.reason ?? "The BSC network is not configured.");
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet was found. Install a wallet that supports BSC Mainnet.");

  const walletClient = createWalletClient({
    chain: configuredChain(),
    transport: custom(provider),
  });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("The wallet did not return an account.");
  const chainId = await walletClient.getChainId();
  if (chainId !== config.chainId) {
    throw new Error(`Wrong network. Switch the wallet to ${config.networkName} (chain ${config.chainId}).`);
  }

  return {
    account,
    chainId,
    walletClient,
    publicClient: createBscPublicClient(),
  };
}

export function hashJobTerms(value: unknown) {
  return keccak256(toBytes(JSON.stringify(value)));
}

function getJobCreatedId(receipt: { logs: readonly { data: Hex; topics: readonly Hex[] }[] }) {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: ERC8183_ABI,
        eventName: "JobCreated",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const jobId = decoded.args.jobId;
      if (typeof jobId === "bigint") return jobId.toString();
    } catch {
      // A receipt may include unrelated logs. Continue until the event is found.
    }
  }
  return undefined;
}

export interface CreateERC8183JobInput {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  provider: Address;
  evaluator: Address;
  expiredAt: bigint;
  description: string;
  hookAddress: Address;
}

export async function createERC8183Job(input: CreateERC8183JobInput) {
  const hash = await input.walletClient.writeContract({
    address: getRequiredAddress(getERC8183Config().contractAddress, "ERC8183 contract"),
    abi: ERC8183_ABI,
    functionName: "createJob",
    args: [input.provider, input.evaluator, input.expiredAt, input.description, input.hookAddress],
    account: input.account,
    chain: configuredChain(),
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  const jobId = getJobCreatedId(receipt);
  if (!jobId) {
    throw new Error(`ERC8183 create transaction ${hash} succeeded, but no JobCreated event was found.`);
  }
  return { jobId, transactionHash: hash, receipt };
}

export async function setERC8183Budget(input: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  jobId: bigint;
  amount: bigint;
  optParams?: `0x${string}`;
}) {
  const hash = await input.walletClient.writeContract({
    address: getRequiredAddress(getERC8183Config().contractAddress, "ERC8183 contract"),
    abi: ERC8183_ABI,
    functionName: "setBudget",
    args: [input.jobId, input.amount, input.optParams ?? "0x"],
    account: input.account,
    chain: configuredChain(),
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  return { transactionHash: hash, receipt };
}

export async function ensureERC20Allowance(input: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  spender: Address;
  amount: bigint;
  tokenAddress: Address;
}) {
  const allowance = await input.publicClient.readContract({
    address: input.tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [input.account, input.spender],
  });
  if (allowance >= input.amount) return { transactionHash: undefined, allowance };

  const hash = await input.walletClient.writeContract({
    address: input.tokenAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [input.spender, input.amount],
    account: input.account,
    chain: configuredChain(),
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  return { transactionHash: hash, allowance, receipt };
}

export async function fundERC8183Job(input: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  jobId: bigint;
  amount: bigint;
  optParams?: `0x${string}`;
}) {
  const hash = await input.walletClient.writeContract({
    address: getRequiredAddress(getERC8183Config().contractAddress, "ERC8183 contract"),
    abi: ERC8183_ABI,
    functionName: "fund",
    args: [input.jobId, input.amount, input.optParams ?? "0x"],
    account: input.account,
    chain: configuredChain(),
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  return { transactionHash: hash, receipt };
}

export async function readERC8183Job(publicClient: PublicClient, jobId: bigint) {
  const config = getERC8183Config();
  const job = await publicClient.readContract({
    address: getRequiredAddress(config.contractAddress, "ERC8183 contract"),
    abi: ERC8183_ABI,
    functionName: "getJob",
    args: [jobId],
  });
  return {
    id: job.id,
    client: job.client,
    provider: job.provider,
    evaluator: job.evaluator,
    description: job.description,
    budget: job.budget,
    expiredAt: job.expiredAt,
    status: Number(job.status),
    hook: job.hook,
    submittedAt: job.submittedAt,
    deliverable: job.deliverable,
  };
}

export async function readPaymentToken(publicClient: PublicClient, tokenAddress = getERC8183Config().paymentTokenAddress) {
  const address = getRequiredAddress(tokenAddress, "ERC8183 payment token");
  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
  ]);
  return { address, decimals: Number(decimals), symbol };
}

export async function verifyERC8183Deployment(publicClient: PublicClient) {
  const config = getERC8183Config();
  const contractAddress = getRequiredAddress(config.contractAddress, "ERC8183 contract");
  const paymentTokenAddress = getRequiredAddress(config.paymentTokenAddress, "ERC8183 payment token");
  const code = await publicClient.getCode({ address: contractAddress });
  if (!code || code === "0x") throw new Error(`No contract code was found at ${contractAddress} on ${config.networkName}.`);
  let deployedPaymentToken: Address;
  try {
    deployedPaymentToken = await publicClient.readContract({
      address: contractAddress,
      abi: ERC8183_ABI,
      functionName: "paymentToken",
    });
  } catch {
    throw new Error("The configured contract does not expose the ERC 8183 paymentToken function.");
  }
  if (deployedPaymentToken.toLowerCase() !== paymentTokenAddress.toLowerCase()) {
    throw new Error("The configured payment token does not match the ERC 8183 contract paymentToken value.");
  }
  return { contractAddress, paymentTokenAddress, code };
}

export function parseERC20Amount(amount: string, decimals: number) {
  const value = amount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Enter a positive token amount before submitting the job.");
  const parsed = parseUnits(value, decimals);
  if (parsed <= BigInt(0)) throw new Error("The job budget must be greater than zero.");
  return parsed;
}

function getRequiredAddress(value: Address | undefined, label: string): Address {
  if (!value) throw new Error(`${label} is not configured.`);
  return value;
}

export function explorerTransactionUrl(hash: string) {
  return `https://bscscan.com/tx/${hash}`;
}

export function explorerJobUrl(contractAddress: string, jobId: string) {
  return `https://bscscan.com/address/${contractAddress}#readContract#${jobId}`;
}

export function maxApprovalAmount() {
  return maxUint256;
}
