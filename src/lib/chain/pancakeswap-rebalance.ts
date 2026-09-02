import {
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { assertPermissionAllows } from "@/lib/marketplace/permission-policy";
import type { SessionPermission } from "@/lib/marketplace/types";
import type { ConnectedBscWallet } from "./erc8183-adapter";
import { getERC8183Config } from "./erc8183-adapter";

export const PANCAKESWAP_V2_ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] memory path) view returns (uint256[] memory amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)",
]);

export const REBALANCE_ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const MAX_DEADLINE_SECONDS = 5 * 60;
const MIN_DEADLINE_SECONDS = 15;
const MAX_QUOTE_AGE_MS = 2 * 60 * 1000;

export interface PancakeSwapRebalanceConfig {
  chainId: 56 | 97;
  networkName: "BSC Mainnet" | "BSC Testnet";
  paymentTokenAddress?: Address;
  routerAddress?: Address;
  tokenInAddress?: Address;
  tokenOutAddress?: Address;
  maxSlippageBps: number;
  enabled: boolean;
  missing: readonly string[];
  reason?: string;
}

export interface PancakeSwapTokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

export interface PancakeSwapRebalanceQuote {
  chainId: 56 | 97;
  routerAddress: Address;
  tokenIn: PancakeSwapTokenInfo;
  tokenOut: PancakeSwapTokenInfo;
  amountInAtomic: bigint;
  quotedAmountOutAtomic: bigint;
  minimumAmountOutAtomic: bigint;
  slippageBps: number;
  deadline: bigint;
  quotedAt: string;
}

export interface PancakeSwapRebalanceResult {
  transactionHash: Hex;
  approvalTransactionHash?: Hex;
  quote: PancakeSwapRebalanceQuote;
}

export class PancakeSwapRebalanceError extends Error {
  readonly broadcastTransactionHash?: Hex;
  readonly stage?: "approval" | "swap";

  constructor(message: string, options?: { broadcastTransactionHash?: Hex; stage?: "approval" | "swap" }) {
    super(message);
    this.name = "PancakeSwapRebalanceError";
    this.broadcastTransactionHash = options?.broadcastTransactionHash;
    this.stage = options?.stage;
  }
}

function readAddress(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && isAddress(trimmed) ? trimmed as Address : undefined;
}

function sameAddress(left: string | undefined, right: string | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function readSlippage() {
  const configured = process.env.NEXT_PUBLIC_PANCAKESWAP_REBALANCE_MAX_SLIPPAGE_BPS?.trim();
  if (!configured) return { value: 100, invalid: false };
  const value = Number(configured);
  return { value, invalid: !Number.isInteger(value) || value < 1 || value > 500 };
}

export function getPancakeSwapRebalanceConfig(): PancakeSwapRebalanceConfig {
  const ercConfig = getERC8183Config();
  const routerAddress = readAddress(process.env.NEXT_PUBLIC_PANCAKESWAP_REBALANCE_ROUTER_ADDRESS);
  const tokenInAddress = readAddress(process.env.NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_IN_ADDRESS);
  const tokenOutAddress = readAddress(process.env.NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_OUT_ADDRESS);
  const slippage = readSlippage();
  const missing: string[] = [];

  if (!ercConfig.networkConfigured) missing.push("NEXT_PUBLIC_HIRE_NETWORK");
  if (!ercConfig.paymentTokenAddress) missing.push("NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS");
  if (!routerAddress) missing.push("NEXT_PUBLIC_PANCAKESWAP_REBALANCE_ROUTER_ADDRESS");
  if (!tokenInAddress) missing.push("NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_IN_ADDRESS");
  if (!tokenOutAddress) missing.push("NEXT_PUBLIC_PANCAKESWAP_REBALANCE_TOKEN_OUT_ADDRESS");
  if (slippage.invalid) missing.push("NEXT_PUBLIC_PANCAKESWAP_REBALANCE_MAX_SLIPPAGE_BPS must be an integer from 1 to 500");
  if (tokenInAddress && tokenOutAddress && sameAddress(tokenInAddress, tokenOutAddress)) {
    missing.push("PancakeSwap rebalance tokens must be different");
  }
  if (routerAddress && tokenInAddress && sameAddress(routerAddress, tokenInAddress)) {
    missing.push("PancakeSwap router must differ from token in");
  }
  if (routerAddress && tokenOutAddress && sameAddress(routerAddress, tokenOutAddress)) {
    missing.push("PancakeSwap router must differ from token out");
  }
  if (tokenInAddress && ercConfig.paymentTokenAddress && !sameAddress(tokenInAddress, ercConfig.paymentTokenAddress)) {
    missing.push("PancakeSwap token in must equal NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS");
  }

  const reason = missing.length
    ? `PancakeSwap rebalance is disabled. Configure ${missing.join(", ")}.`
    : undefined;
  return {
    chainId: ercConfig.chainId,
    networkName: ercConfig.networkName,
    paymentTokenAddress: ercConfig.paymentTokenAddress,
    routerAddress,
    tokenInAddress,
    tokenOutAddress,
    maxSlippageBps: slippage.invalid ? 100 : slippage.value,
    enabled: missing.length === 0,
    missing,
    reason,
  };
}

function configuredAddress(value: Address | undefined, label: string): Address {
  if (!value) throw new PancakeSwapRebalanceError(`${label} is not configured.`);
  return value;
}

function chainForId(chainId: number) {
  if (chainId === 56) return bsc;
  if (chainId === 97) return bscTestnet;
  throw new PancakeSwapRebalanceError("The connected wallet is not on a supported BSC network.");
}

function positiveAtomic(value: bigint, label: string) {
  if (value <= BigInt(0)) throw new PancakeSwapRebalanceError(`${label} must be greater than zero.`);
}

function assertDeadline(deadline: bigint, now = Date.now()) {
  const nowSeconds = BigInt(Math.floor(now / 1000));
  if (deadline <= nowSeconds + BigInt(MIN_DEADLINE_SECONDS)) {
    throw new PancakeSwapRebalanceError("The swap deadline is too close. Refresh the quote before approving.");
  }
  if (deadline > nowSeconds + BigInt(MAX_DEADLINE_SECONDS)) {
    throw new PancakeSwapRebalanceError("The swap deadline is outside the five minute safety window.");
  }
}

export function assertPancakeSwapRebalancePolicy(input: {
  permission?: SessionPermission;
  config: PancakeSwapRebalanceConfig;
  routerAddress: Address;
  tokenInAddress: Address;
  tokenOutAddress: Address;
  amountInAtomic: bigint;
  minimumAmountOutAtomic: bigint;
  tokenInDecimals: number;
  tokenInSymbol?: string;
  deadline: bigint;
  now?: number;
}) {
  if (!input.config.enabled) throw new PancakeSwapRebalanceError(input.config.reason ?? "PancakeSwap rebalance is disabled.");
  const routerAddress = configuredAddress(input.config.routerAddress, "PancakeSwap router");
  const tokenInAddress = configuredAddress(input.config.tokenInAddress, "PancakeSwap token in");
  const tokenOutAddress = configuredAddress(input.config.tokenOutAddress, "PancakeSwap token out");
  if (!sameAddress(input.routerAddress, routerAddress) || !sameAddress(input.tokenInAddress, tokenInAddress) || !sameAddress(input.tokenOutAddress, tokenOutAddress)) {
    throw new PancakeSwapRebalanceError("The rebalance target does not match the configured PancakeSwap pair.");
  }
  if (sameAddress(tokenInAddress, tokenOutAddress)) {
    throw new PancakeSwapRebalanceError("The PancakeSwap rebalance pair must contain two different tokens.");
  }
  positiveAtomic(input.amountInAtomic, "The input amount");
  positiveAtomic(input.minimumAmountOutAtomic, "The minimum output amount");
  if (!Number.isInteger(input.tokenInDecimals) || input.tokenInDecimals < 0 || input.tokenInDecimals > 255) {
    throw new PancakeSwapRebalanceError("The input token precision is invalid.");
  }
  if (input.tokenInSymbol && input.permission && input.tokenInSymbol.toLowerCase() !== input.permission.currency.toLowerCase()) {
    throw new PancakeSwapRebalanceError("The input token does not match the permission currency.");
  }
  assertDeadline(input.deadline, input.now);

  assertPermissionAllows({
    permission: input.permission,
    action: "pancakeswap-rebalance",
    contractAddress: routerAddress,
    tokenAddress: tokenInAddress,
    amountAtomic: input.amountInAtomic,
    tokenDecimals: input.tokenInDecimals,
    currency: input.tokenInSymbol,
    spentAmountAtomic: BigInt(0),
  });
  assertPermissionAllows({
    permission: input.permission,
    action: "pancakeswap-rebalance",
    contractAddress: routerAddress,
    tokenAddress: tokenOutAddress,
    requireAmount: false,
  });
  return true;
}

export async function readPancakeSwapTokenInfo(publicClient: PublicClient, address: Address): Promise<PancakeSwapTokenInfo> {
  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({ address, abi: REBALANCE_ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address, abi: REBALANCE_ERC20_ABI, functionName: "symbol" }),
  ]);
  const numericDecimals = Number(decimals);
  if (!Number.isInteger(numericDecimals) || numericDecimals < 0 || numericDecimals > 255 || typeof symbol !== "string" || !symbol.trim()) {
    throw new PancakeSwapRebalanceError("The configured PancakeSwap token returned invalid metadata.");
  }
  return { address, symbol: symbol.trim(), decimals: numericDecimals };
}

async function assertDeployed(publicClient: PublicClient, addresses: readonly Address[]) {
  const code = await Promise.all(addresses.map((address) => publicClient.getCode({ address })));
  if (code.some((value) => !value || value === "0x")) {
    throw new PancakeSwapRebalanceError("The configured PancakeSwap router or token has no contract code on the selected BSC network.");
  }
}

async function quoteAtomic(input: {
  publicClient: PublicClient;
  permission?: SessionPermission;
  amountInAtomic: bigint;
  account: Address;
  config: PancakeSwapRebalanceConfig;
  now?: number;
}): Promise<PancakeSwapRebalanceQuote> {
  const routerAddress = configuredAddress(input.config.routerAddress, "PancakeSwap router");
  const tokenInAddress = configuredAddress(input.config.tokenInAddress, "PancakeSwap token in");
  const tokenOutAddress = configuredAddress(input.config.tokenOutAddress, "PancakeSwap token out");
  const chainId = Number(await input.publicClient.getChainId());
  if (chainId !== input.config.chainId) {
    throw new PancakeSwapRebalanceError(`The read client is on the wrong network. Use ${input.config.networkName} (chain ${input.config.chainId}).`);
  }
  await assertDeployed(input.publicClient, [routerAddress, tokenInAddress, tokenOutAddress]);
  const [tokenIn, tokenOut, balance] = await Promise.all([
    readPancakeSwapTokenInfo(input.publicClient, tokenInAddress),
    readPancakeSwapTokenInfo(input.publicClient, tokenOutAddress),
    input.publicClient.readContract({ address: tokenInAddress, abi: REBALANCE_ERC20_ABI, functionName: "balanceOf", args: [input.account] }),
  ]);
  if (!input.permission) throw new PancakeSwapRebalanceError("An active permission is required before quoting a rebalance.");
  if (tokenIn.symbol.toLowerCase() !== input.permission.currency.toLowerCase()) {
    throw new PancakeSwapRebalanceError("The configured input token symbol does not match the permission currency.");
  }
  positiveAtomic(input.amountInAtomic, "The input amount");
  if (balance < input.amountInAtomic) throw new PancakeSwapRebalanceError("The wallet does not have enough input tokens for this rebalance.");
  const amounts = await input.publicClient.readContract({
    address: routerAddress,
    abi: PANCAKESWAP_V2_ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [input.amountInAtomic, [tokenInAddress, tokenOutAddress]],
  });
  const quotedAmountOutAtomic = amounts[amounts.length - 1];
  if (amounts.length !== 2 || quotedAmountOutAtomic === undefined) {
    throw new PancakeSwapRebalanceError("PancakeSwap returned an invalid two token quote.");
  }
  positiveAtomic(quotedAmountOutAtomic, "The quoted output amount");
  const minimumAmountOutAtomic = quotedAmountOutAtomic * BigInt(10_000 - input.config.maxSlippageBps) / BigInt(10_000);
  positiveAtomic(minimumAmountOutAtomic, "The minimum output amount");
  const now = input.now ?? Date.now();
  const deadline = BigInt(Math.floor(now / 1000) + MAX_DEADLINE_SECONDS);
  assertPancakeSwapRebalancePolicy({
    permission: input.permission,
    config: input.config,
    routerAddress,
    tokenInAddress,
    tokenOutAddress,
    amountInAtomic: input.amountInAtomic,
    minimumAmountOutAtomic,
    tokenInDecimals: tokenIn.decimals,
    tokenInSymbol: tokenIn.symbol,
    deadline,
    now,
  });
  return {
    chainId: input.config.chainId,
    routerAddress,
    tokenIn,
    tokenOut,
    amountInAtomic: input.amountInAtomic,
    quotedAmountOutAtomic,
    minimumAmountOutAtomic,
    slippageBps: input.config.maxSlippageBps,
    deadline,
    quotedAt: new Date(now).toISOString(),
  };
}

export async function quotePancakeSwapRebalance(input: {
  publicClient: PublicClient;
  permission?: SessionPermission;
  amountIn: string;
  account: Address;
  config?: PancakeSwapRebalanceConfig;
  now?: number;
}) {
  const config = input.config ?? getPancakeSwapRebalanceConfig();
  if (!config.enabled) throw new PancakeSwapRebalanceError(config.reason ?? "PancakeSwap rebalance is disabled.");
  const tokenInAddress = configuredAddress(config.tokenInAddress, "PancakeSwap token in");
  const decimals = await readPancakeSwapTokenInfo(input.publicClient, tokenInAddress);
  const amountInAtomic = parseUnits(input.amountIn.trim(), decimals.decimals);
  if (amountInAtomic <= BigInt(0)) throw new PancakeSwapRebalanceError("Enter a positive input token amount.");
  return quoteAtomic({ ...input, permission: input.permission, amountInAtomic, config });
}

export async function quotePancakeSwapRebalanceAtomic(input: {
  publicClient: PublicClient;
  permission?: SessionPermission;
  amountInAtomic: bigint;
  account: Address;
  config?: PancakeSwapRebalanceConfig;
  now?: number;
}) {
  const config = input.config ?? getPancakeSwapRebalanceConfig();
  if (!config.enabled) throw new PancakeSwapRebalanceError(config.reason ?? "PancakeSwap rebalance is disabled.");
  positiveAtomic(input.amountInAtomic, "The input amount");
  const tokenInAddress = configuredAddress(config.tokenInAddress, "PancakeSwap token in");
  const balance = await input.publicClient.readContract({ address: tokenInAddress, abi: REBALANCE_ERC20_ABI, functionName: "balanceOf", args: [input.account] });
  if (balance < input.amountInAtomic) throw new PancakeSwapRebalanceError("The wallet does not have enough input tokens for this rebalance.");
  const chainId = Number(await input.publicClient.getChainId());
  if (chainId !== config.chainId) throw new PancakeSwapRebalanceError("The wallet read client is on the wrong BSC network.");
  const routerAddress = configuredAddress(config.routerAddress, "PancakeSwap router");
  const tokenOutAddress = configuredAddress(config.tokenOutAddress, "PancakeSwap token out");
  await assertDeployed(input.publicClient, [routerAddress, tokenInAddress, tokenOutAddress]);
  const tokenIn = await readPancakeSwapTokenInfo(input.publicClient, tokenInAddress);
  const tokenOut = await readPancakeSwapTokenInfo(input.publicClient, tokenOutAddress);
  if (!input.permission) throw new PancakeSwapRebalanceError("An active permission is required before quoting a rebalance.");
  if (tokenIn.symbol.toLowerCase() !== input.permission.currency.toLowerCase()) throw new PancakeSwapRebalanceError("The configured input token symbol does not match the permission currency.");
  const amounts = await input.publicClient.readContract({ address: routerAddress, abi: PANCAKESWAP_V2_ROUTER_ABI, functionName: "getAmountsOut", args: [input.amountInAtomic, [tokenInAddress, tokenOutAddress]] });
  const quotedAmountOutAtomic = amounts[amounts.length - 1];
  if (amounts.length !== 2 || quotedAmountOutAtomic === undefined) throw new PancakeSwapRebalanceError("PancakeSwap returned an invalid two token quote.");
  positiveAtomic(quotedAmountOutAtomic, "The quoted output amount");
  const minimumAmountOutAtomic = quotedAmountOutAtomic * BigInt(10_000 - config.maxSlippageBps) / BigInt(10_000);
  const now = input.now ?? Date.now();
  const deadline = BigInt(Math.floor(now / 1000) + MAX_DEADLINE_SECONDS);
  assertPancakeSwapRebalancePolicy({ permission: input.permission, config, routerAddress, tokenInAddress, tokenOutAddress, amountInAtomic: input.amountInAtomic, minimumAmountOutAtomic, tokenInDecimals: tokenIn.decimals, tokenInSymbol: tokenIn.symbol, deadline, now });
  return { chainId: config.chainId, routerAddress, tokenIn, tokenOut, amountInAtomic: input.amountInAtomic, quotedAmountOutAtomic, minimumAmountOutAtomic, slippageBps: config.maxSlippageBps, deadline, quotedAt: new Date(now).toISOString() } satisfies PancakeSwapRebalanceQuote;
}

function quoteChanged(left: PancakeSwapRebalanceQuote, right: PancakeSwapRebalanceQuote) {
  return !sameAddress(left.routerAddress, right.routerAddress)
    || !sameAddress(left.tokenIn.address, right.tokenIn.address)
    || !sameAddress(left.tokenOut.address, right.tokenOut.address)
    || left.amountInAtomic !== right.amountInAtomic
    || left.quotedAmountOutAtomic !== right.quotedAmountOutAtomic
    || left.minimumAmountOutAtomic !== right.minimumAmountOutAtomic
    || left.slippageBps !== right.slippageBps;
}

function quoteIsFresh(quote: PancakeSwapRebalanceQuote, now = Date.now()) {
  const quotedAt = Date.parse(quote.quotedAt);
  return Number.isFinite(quotedAt) && quotedAt <= now + 10_000 && now - quotedAt <= MAX_QUOTE_AGE_MS;
}

async function recordBroadcast(callback: (() => Promise<void>) | undefined, hash: Hex, stage: "approval" | "swap", message: string) {
  if (!callback) return;
  try {
    await callback();
  } catch {
    throw new PancakeSwapRebalanceError(message, { broadcastTransactionHash: hash, stage });
  }
}

export async function executePancakeSwapRebalance(input: {
  wallet: ConnectedBscWallet;
  permission?: SessionPermission;
  quote: PancakeSwapRebalanceQuote;
  config?: PancakeSwapRebalanceConfig;
  onApprovalSubmitted?: (hash: Hex) => Promise<void>;
  onSwapSubmitted?: (hash: Hex, approvalHash?: Hex) => Promise<void>;
}) {
  const config = input.config ?? getPancakeSwapRebalanceConfig();
  if (!config.enabled) throw new PancakeSwapRebalanceError(config.reason ?? "PancakeSwap rebalance is disabled.");
  if (input.wallet.chainId !== input.quote.chainId || input.wallet.chainId !== config.chainId) throw new PancakeSwapRebalanceError("The wallet changed to the wrong BSC network. Reconnect before approving.");
  if (!quoteIsFresh(input.quote)) throw new PancakeSwapRebalanceError("The quote expired. Refresh it before approving.");
  const freshQuote = await quotePancakeSwapRebalanceAtomic({ publicClient: input.wallet.publicClient, permission: input.permission, amountInAtomic: input.quote.amountInAtomic, account: input.wallet.account, config });
  if (quoteChanged(input.quote, freshQuote)) throw new PancakeSwapRebalanceError("The PancakeSwap quote changed. Refresh the quote before approving a wallet transaction.");

  let approvalTransactionHash: Hex | undefined;
  const allowance = await input.wallet.publicClient.readContract({ address: freshQuote.tokenIn.address, abi: REBALANCE_ERC20_ABI, functionName: "allowance", args: [input.wallet.account, freshQuote.routerAddress] });
  if (allowance < freshQuote.amountInAtomic) {
    assertPermissionAllows({ permission: input.permission, action: "token-approval", contractAddress: freshQuote.routerAddress, tokenAddress: freshQuote.tokenIn.address, amountAtomic: freshQuote.amountInAtomic, tokenDecimals: freshQuote.tokenIn.decimals, countAmount: false });
    try {
      approvalTransactionHash = await input.wallet.walletClient.writeContract({ address: freshQuote.tokenIn.address, abi: REBALANCE_ERC20_ABI, functionName: "approve", args: [freshQuote.routerAddress, freshQuote.amountInAtomic], account: input.wallet.account, chain: chainForId(input.wallet.chainId) });
    } catch (error) {
      throw new PancakeSwapRebalanceError(error instanceof Error ? error.message : "The exact token approval was rejected.", { stage: "approval" });
    }
    await recordBroadcast(() => input.onApprovalSubmitted?.(approvalTransactionHash as Hex) ?? Promise.resolve(), approvalTransactionHash, "approval", "The token approval was broadcast but its audit record could not be saved.");
    let approvalReceipt;
    try {
      approvalReceipt = await input.wallet.publicClient.waitForTransactionReceipt({ hash: approvalTransactionHash });
    } catch {
      throw new PancakeSwapRebalanceError("The token approval was broadcast, but its receipt could not be confirmed.", { broadcastTransactionHash: approvalTransactionHash, stage: "approval" });
    }
    if (approvalReceipt.status !== "success") throw new PancakeSwapRebalanceError("The exact token approval transaction reverted.", { broadcastTransactionHash: approvalTransactionHash, stage: "approval" });
    const refreshedAllowance = await input.wallet.publicClient.readContract({ address: freshQuote.tokenIn.address, abi: REBALANCE_ERC20_ABI, functionName: "allowance", args: [input.wallet.account, freshQuote.routerAddress] });
    if (refreshedAllowance < freshQuote.amountInAtomic) throw new PancakeSwapRebalanceError("The token approval receipt succeeded, but the router allowance is still too low.", { broadcastTransactionHash: approvalTransactionHash, stage: "approval" });
  }

  let transactionHash: Hex;
  try {
    transactionHash = await input.wallet.walletClient.writeContract({ address: freshQuote.routerAddress, abi: PANCAKESWAP_V2_ROUTER_ABI, functionName: "swapExactTokensForTokens", args: [freshQuote.amountInAtomic, freshQuote.minimumAmountOutAtomic, [freshQuote.tokenIn.address, freshQuote.tokenOut.address], input.wallet.account, freshQuote.deadline], account: input.wallet.account, chain: chainForId(input.wallet.chainId) });
  } catch (error) {
    throw new PancakeSwapRebalanceError(error instanceof Error ? error.message : "The PancakeSwap rebalance was rejected.", { stage: "swap" });
  }
  await recordBroadcast(() => input.onSwapSubmitted?.(transactionHash, approvalTransactionHash) ?? Promise.resolve(), transactionHash, "swap", "The swap was broadcast but its audit record could not be saved.");
  let receipt;
  try {
    receipt = await input.wallet.publicClient.waitForTransactionReceipt({ hash: transactionHash });
  } catch {
    throw new PancakeSwapRebalanceError("The swap was broadcast, but its receipt could not be confirmed.", { broadcastTransactionHash: transactionHash, stage: "swap" });
  }
  if (receipt.status !== "success") throw new PancakeSwapRebalanceError("The PancakeSwap rebalance transaction reverted.", { broadcastTransactionHash: transactionHash, stage: "swap" });
  return { transactionHash, approvalTransactionHash, quote: freshQuote } satisfies PancakeSwapRebalanceResult;
}
