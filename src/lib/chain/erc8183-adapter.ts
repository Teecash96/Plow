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
import { assertPermissionAllows } from "@/lib/marketplace/permission-policy";
import type { SessionPermission } from "@/lib/marketplace/types";
import { createBscMainnetTransport, DEFAULT_BSC_MAINNET_RPC_URL } from "./bsc-mainnet-rpc";

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

export const ERC8183_POLICY_VERDICT = {
  pending: 0,
  approve: 1,
  reject: 2,
} as const;

const DEFAULT_RPC_URL = DEFAULT_BSC_MAINNET_RPC_URL;
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
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
  "function complete(uint256 jobId, bytes32 reason, bytes optParams)",
  "function reject(uint256 jobId, bytes32 reason, bytes optParams)",
  "function claimRefund(uint256 jobId)",
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
  "function paymentToken() view returns (address)",
  "function jobCounter() view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  "event JobFunded(uint256 indexed jobId, address indexed client, address payer, uint256 amount)",
  "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
  "event JobCompleted(uint256 indexed jobId, bytes32 reason)",
  "event JobRejected(uint256 indexed jobId, bytes32 reason)",
]);

export const ERC8183_ROUTER_ABI = parseAbi([
  "function registerJob(uint256 jobId, address policy)",
  "function settle(uint256 jobId, bytes evidence)",
  "function markExpired(uint256 jobId)",
]);

export const ERC8183_POLICY_ABI = parseAbi([
  "function dispute(uint256 jobId)",
  "function disputeWindow() view returns (uint256)",
  "function check(uint256 jobId, bytes evidence) view returns (uint8 verdict, bytes32 reason)",
  "function submittedAt(uint256 jobId) view returns (uint64)",
  "function disputed(uint256 jobId) view returns (bool)",
  "function rejectVotes(uint256 jobId) view returns (uint16)",
  "function disputeQuorumSnapshot(uint256 jobId) view returns (uint16)",
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
  routerAddress?: Address;
  policyAddress?: Address;
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
  routerConfigured?: boolean;
  policyConfigured?: boolean;
  lifecycleEnabled?: boolean;
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
    case "NEXT_PUBLIC_ERC8183_ROUTER_ADDRESS": return process.env.NEXT_PUBLIC_ERC8183_ROUTER_ADDRESS;
    case "ERC8183_ROUTER_ADDRESS": return process.env.ERC8183_ROUTER_ADDRESS;
    case "NEXT_PUBLIC_ERC8183_POLICY_ADDRESS": return process.env.NEXT_PUBLIC_ERC8183_POLICY_ADDRESS;
    case "ERC8183_POLICY_ADDRESS": return process.env.ERC8183_POLICY_ADDRESS;
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
  const routerSetting = readAddressSetting("NEXT_PUBLIC_ERC8183_ROUTER_ADDRESS", "ERC8183_ROUTER_ADDRESS");
  const policySetting = readAddressSetting("NEXT_PUBLIC_ERC8183_POLICY_ADDRESS", "ERC8183_POLICY_ADDRESS");
  const missing: string[] = [];
  if (!networkSetting.configured) missing.push("NEXT_PUBLIC_HIRE_NETWORK");
  if (contractSetting.value && !contractSetting.address) missing.push(`${contractSetting.key} is not a valid address`);
  else if (!contractSetting.address) missing.push("ERC8183_CONTRACT_ADDRESS");
  if (paymentTokenSetting.value && !paymentTokenSetting.address) missing.push(`${paymentTokenSetting.key} is not a valid address`);
  else if (!paymentTokenSetting.address) missing.push("PAYMENT_TOKEN_ADDRESS");
  if (evaluatorSetting.value && !evaluatorSetting.address) missing.push(`${evaluatorSetting.key} is not a valid address`);
  if (hookSetting.value && !hookSetting.address) missing.push(`${hookSetting.key} is not a valid address`);
  if (routerSetting.value && !routerSetting.address) missing.push(`${routerSetting.key} is not a valid address`);
  else if (!routerSetting.address) missing.push("ERC8183_ROUTER_ADDRESS");
  if (policySetting.value && !policySetting.address) missing.push(`${policySetting.key} is not a valid address`);
  else if (!policySetting.address) missing.push("ERC8183_POLICY_ADDRESS");
  const reason = missing.length ? `Live hiring is blocked. Configure ${missing.join(", ")}.` : undefined;
  return {
    contractAddress: contractSetting.address,
    paymentTokenAddress: paymentTokenSetting.address,
    evaluatorAddress: evaluatorSetting.address,
    hookAddress: hookSetting.address ?? zeroAddress,
    routerAddress: routerSetting.address,
    policyAddress: policySetting.address,
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
    routerConfigured: Boolean(routerSetting.address),
    policyConfigured: Boolean(policySetting.address),
    lifecycleEnabled: Boolean(routerSetting.address && policySetting.address),
    missing,
    enabled: missing.length === 0,
    reason,
  };
}

function configuredChain() {
  return getERC8183Config().chainId === ERC8183_TESTNET_CHAIN_ID ? bscTestnet : bsc;
}

export class ERC8183TransactionError extends Error {
  readonly transactionHash: Hex;

  constructor(message: string, transactionHash: Hex) {
    super(`${message} Verify this transaction before retrying: ${transactionHash}`);
    this.name = "ERC8183TransactionError";
    this.transactionHash = transactionHash;
  }
}

export function createBscPublicClient(rpcUrl = readRpcUrl().url): PublicClient {
  const chain = configuredChain();
  return createPublicClient({
    chain,
    transport: chain.id === 56
      ? createBscMainnetTransport(rpcUrl, REQUEST_TIMEOUT_MS)
      : http(rpcUrl, { timeout: REQUEST_TIMEOUT_MS }),
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
  permission: SessionPermission;
}

export async function createERC8183Job(input: CreateERC8183JobInput) {
  const config = getERC8183Config();
  const contractAddress = getRequiredAddress(config.contractAddress, "ERC8183 contract");
  assertPermissionAllows({
    permission: input.permission,
    action: "erc8183-create",
    contractAddress,
  });
  const hash = await input.walletClient.writeContract({
    address: contractAddress,
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

export async function registerERC8183Job(input: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  jobId: bigint;
  permission: SessionPermission;
}) {
  const config = getERC8183Config();
  const routerAddress = getRequiredAddress(config.routerAddress, "ERC 8183 evaluator router");
  const policyAddress = getRequiredAddress(config.policyAddress, "ERC 8183 policy");
  assertPermissionAllows({ permission: input.permission, action: "erc8183-register", contractAddress: routerAddress });
  assertPermissionAllows({ permission: input.permission, action: "erc8183-register", contractAddress: policyAddress });
  const hash = await input.walletClient.writeContract({
    address: routerAddress,
    abi: ERC8183_ROUTER_ABI,
    functionName: "registerJob",
    args: [input.jobId, policyAddress],
    account: input.account,
    chain: configuredChain(),
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  return { transactionHash: hash, receipt };
}

export async function setERC8183Budget(input: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  jobId: bigint;
  amount: bigint;
  optParams?: `0x${string}`;
  permission: SessionPermission;
  tokenAddress: Address;
  tokenDecimals: number;
}) {
  const config = getERC8183Config();
  const contractAddress = getRequiredAddress(config.contractAddress, "ERC8183 contract");
  assertPermissionAllows({
    permission: input.permission,
    action: "erc8183-budget",
    contractAddress,
    tokenAddress: input.tokenAddress,
    amountAtomic: input.amount,
    tokenDecimals: input.tokenDecimals,
    countAmount: false,
  });
  const hash = await input.walletClient.writeContract({
    address: contractAddress,
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
  approvalAmount?: bigint;
  tokenAddress: Address;
  permission: SessionPermission;
  tokenDecimals: number;
}) {
  const approvalAmount = input.approvalAmount ?? input.amount;
  if (approvalAmount < input.amount) {
    throw new Error("The reusable token approval must cover the current job amount.");
  }
  assertPermissionAllows({
    permission: input.permission,
    action: "token-approval",
    contractAddress: input.spender,
    tokenAddress: input.tokenAddress,
    amountAtomic: input.amount,
    tokenDecimals: input.tokenDecimals,
    countAmount: false,
  });
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
    args: [input.spender, approvalAmount],
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
  permission: SessionPermission;
  tokenAddress: Address;
  tokenDecimals: number;
  spentAmountAtomic: bigint;
  onTransactionBroadcast?: (hash: Hex) => Promise<void> | void;
}) {
  const config = getERC8183Config();
  const contractAddress = getRequiredAddress(config.contractAddress, "ERC8183 contract");
  assertPermissionAllows({
    permission: input.permission,
    action: "erc8183-fund",
    contractAddress,
    tokenAddress: input.tokenAddress,
    amountAtomic: input.amount,
    tokenDecimals: input.tokenDecimals,
    spentAmountAtomic: input.spentAmountAtomic,
  });
  const hash = await input.walletClient.writeContract({
    address: contractAddress,
    abi: ERC8183_ABI,
    functionName: "fund",
    args: [input.jobId, input.amount, input.optParams ?? "0x"],
    account: input.account,
    chain: configuredChain(),
  });
  try {
    await input.onTransactionBroadcast?.(hash);
  } catch {
    throw new ERC8183TransactionError("The ERC 8183 funding transaction was broadcast, but its audit record could not be saved.", hash);
  }
  let receipt;
  try {
    receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  } catch {
    throw new ERC8183TransactionError("The ERC 8183 funding transaction was broadcast, but its receipt could not be confirmed.", hash);
  }
  if (receipt.status !== "success") {
    throw new ERC8183TransactionError("The ERC 8183 funding transaction reverted on chain.", hash);
  }
  return { transactionHash: hash, receipt };
}

export async function disputeERC8183Job(input: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  jobId: bigint;
  permission: SessionPermission;
}) {
  const config = getERC8183Config();
  const policyAddress = getRequiredAddress(config.policyAddress, "ERC 8183 policy");
  assertPermissionAllows({ permission: input.permission, action: "erc8183-dispute", contractAddress: policyAddress });
  const hash = await input.walletClient.writeContract({
    address: policyAddress,
    abi: ERC8183_POLICY_ABI,
    functionName: "dispute",
    args: [input.jobId],
    account: input.account,
    chain: configuredChain(),
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  return { transactionHash: hash, receipt };
}

export async function settleERC8183Job(input: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  jobId: bigint;
  permission: SessionPermission;
  evidence?: `0x${string}`;
}) {
  const config = getERC8183Config();
  const routerAddress = getRequiredAddress(config.routerAddress, "ERC 8183 evaluator router");
  assertPermissionAllows({ permission: input.permission, action: "erc8183-settle", contractAddress: routerAddress });
  const policy = await readERC8183PolicyState(input.publicClient, input.jobId);
  if (policy.verdict === ERC8183_POLICY_VERDICT.pending) {
    const settleAt = policy.submittedAt + policy.disputeWindow;
    const settleAtSeconds = Number(settleAt);
    const unlockMessage = Number.isSafeInteger(settleAtSeconds)
      ? ` Settlement unlocks at ${new Date(settleAtSeconds * 1_000).toISOString()}.`
      : "";
    throw new Error(`The evaluator policy is still pending.${unlockMessage}`);
  }
  if (policy.verdict !== ERC8183_POLICY_VERDICT.approve && policy.verdict !== ERC8183_POLICY_VERDICT.reject) {
    throw new Error("The evaluator returned an unknown verdict.");
  }
  const hash = await input.walletClient.writeContract({
    address: routerAddress,
    abi: ERC8183_ROUTER_ABI,
    functionName: "settle",
    args: [input.jobId, input.evidence ?? "0x"],
    account: input.account,
    chain: configuredChain(),
  });
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
  return { transactionHash: hash, receipt };
}

export async function claimERC8183Refund(input: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
  jobId: bigint;
  permission: SessionPermission;
}) {
  const config = getERC8183Config();
  const contractAddress = getRequiredAddress(config.contractAddress, "ERC 8183 contract");
  assertPermissionAllows({ permission: input.permission, action: "erc8183-refund", contractAddress });
  const hash = await input.walletClient.writeContract({
    address: contractAddress,
    abi: ERC8183_ABI,
    functionName: "claimRefund",
    args: [input.jobId],
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

export async function readERC8183DisputeWindow(publicClient: PublicClient) {
  const config = getERC8183Config();
  const policyAddress = getRequiredAddress(config.policyAddress, "ERC 8183 policy");
  return publicClient.readContract({
    address: policyAddress,
    abi: ERC8183_POLICY_ABI,
    functionName: "disputeWindow",
  });
}

export async function readERC8183PolicyState(publicClient: PublicClient, jobId: bigint) {
  const config = getERC8183Config();
  const policyAddress = getRequiredAddress(config.policyAddress, "ERC 8183 policy");
  const block = await publicClient.getBlock();
  const [decision, disputeWindow, submittedAt, disputed, rejectVotes, disputeQuorum] = await Promise.all([
    publicClient.readContract({
      address: policyAddress,
      abi: ERC8183_POLICY_ABI,
      functionName: "check",
      args: [jobId, "0x"],
      blockNumber: block.number,
    }),
    publicClient.readContract({
      address: policyAddress,
      abi: ERC8183_POLICY_ABI,
      functionName: "disputeWindow",
      blockNumber: block.number,
    }),
    publicClient.readContract({
      address: policyAddress,
      abi: ERC8183_POLICY_ABI,
      functionName: "submittedAt",
      args: [jobId],
      blockNumber: block.number,
    }),
    publicClient.readContract({
      address: policyAddress,
      abi: ERC8183_POLICY_ABI,
      functionName: "disputed",
      args: [jobId],
      blockNumber: block.number,
    }),
    publicClient.readContract({
      address: policyAddress,
      abi: ERC8183_POLICY_ABI,
      functionName: "rejectVotes",
      args: [jobId],
      blockNumber: block.number,
    }),
    publicClient.readContract({
      address: policyAddress,
      abi: ERC8183_POLICY_ABI,
      functionName: "disputeQuorumSnapshot",
      args: [jobId],
      blockNumber: block.number,
    }),
  ]);

  return {
    verdict: Number(decision[0]),
    reason: decision[1],
    disputeWindow,
    submittedAt,
    disputed,
    rejectVotes,
    disputeQuorum,
    blockTimestamp: block.timestamp,
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
  const routerAddress = getRequiredAddress(config.routerAddress, "ERC 8183 evaluator router");
  const policyAddress = getRequiredAddress(config.policyAddress, "ERC 8183 policy");
  const [code, routerCode, policyCode] = await Promise.all([
    publicClient.getCode({ address: contractAddress }),
    publicClient.getCode({ address: routerAddress }),
    publicClient.getCode({ address: policyAddress }),
  ]);
  if (!code || code === "0x") throw new Error(`No contract code was found at ${contractAddress} on ${config.networkName}.`);
  if (!routerCode || routerCode === "0x") throw new Error(`No evaluator router code was found at ${routerAddress} on ${config.networkName}.`);
  if (!policyCode || policyCode === "0x") throw new Error(`No evaluator policy code was found at ${policyAddress} on ${config.networkName}.`);
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
  return { contractAddress, paymentTokenAddress, routerAddress, policyAddress, code, routerCode, policyCode };
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
