import { createPublicClient, formatUnits, isAddress, parseAbi, type Address, type Hex } from "viem";
import { bsc } from "viem/chains";
import { createBscMainnetTransport } from "@/lib/chain/bsc-mainnet-rpc";
import { AGENT_CATEGORIES, type AgentCategory } from "./types";
import type { ProviderExecutionRequest, ProviderExecutionResponse } from "./provider-service";

const MAX_SUMMARY_LENGTH = 4_000;
const MAX_VAULTS = 8;
const DEFAULT_GRID_LEVELS = 5;
const DEFAULT_GRID_BAND_PERCENT = 5;

const PANCAKESWAP_V3_POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);

const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const ERC4626_VAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

const LENDING_POOL_ABI = parseAbi([
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

export interface BscChainSnapshot {
  chainId: 56;
  blockNumber: string;
  blockTimestamp: string;
  blockHash?: Hex;
}

export interface ProviderPoolSnapshot {
  address: Address;
  token0: Address;
  token1: Address;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  feeTier?: string;
  tick: number;
  liquidity: string;
  spotPriceToken1PerToken0: string;
}

export interface ProviderYieldVaultSnapshot {
  address: Address;
  name: string;
  asset: Address;
  assetSymbol: string;
  totalAssets: string;
  totalSupply: string;
  assetsPerShare: string;
}

export interface ProviderHealthFactorSnapshot {
  poolAddress: Address;
  account: Address;
  totalCollateralBase: string;
  totalDebtBase: string;
  currentLiquidationThreshold: string;
  healthFactor: string;
}

export interface ProviderTelemetryReader {
  readChainSnapshot(): Promise<BscChainSnapshot>;
  readPoolSnapshot(address: Address): Promise<ProviderPoolSnapshot>;
  readYieldVaultSnapshot(address: Address, name: string): Promise<ProviderYieldVaultSnapshot>;
  readHealthFactorSnapshot(poolAddress: Address, account: Address): Promise<ProviderHealthFactorSnapshot>;
}

export interface ProviderStrategyOptions {
  reader?: ProviderTelemetryReader;
  supportedCategories?: readonly AgentCategory[];
}

export class ProviderStrategyError extends Error {
  readonly status: 409 | 503;

  constructor(message: string, status: 409 | 503 = 503) {
    super(message);
    this.name = "ProviderStrategyError";
    this.status = status;
  }
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown telemetry error.";
  return message.replace(/\s+/g, " ").trim().slice(0, 220);
}

function safeSummary(value: string) {
  return value.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY_LENGTH);
}

function addressFromText(value: string | undefined, keywords: readonly string[]) {
  if (!value) return undefined;
  for (const keyword of keywords) {
    const pattern = new RegExp(`${keyword}[^0-9a-f]{0,80}(0x[a-fA-F0-9]{40})`, "i");
    const match = pattern.exec(value);
    if (match && isAddress(match[1])) return match[1] as Address;
  }
  return undefined;
}

function configuredAddress(name: string, taskSummary: string, keywords: readonly string[]) {
  const configured = envValue(name);
  if (configured) {
    if (!isAddress(configured)) throw new ProviderStrategyError(`${name} is not a valid EVM address.`, 409);
    return configured as Address;
  }
  return addressFromText(taskSummary, keywords);
}

function positiveNumber(value: string | undefined, fallback: number, maximum: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function numberAfterKeyword(text: string, keywords: readonly string[], fallback: number, maximum: number) {
  for (const keyword of keywords) {
    const pattern = new RegExp(`${keyword}\\s*(?:[:=]|is|of)?\\s*(\\d+(?:\\.\\d+)?)`, "i");
    const match = pattern.exec(text);
    if (match) return positiveNumber(match[1], fallback, maximum);
  }
  return fallback;
}

function parseRange(text: string) {
  const match = /(?:range|bounds?|between)\s*(?:is|are|of|:|=)?\s*(\d+(?:\.\d+)?)\s*(?:to|and|-)\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (!match) return undefined;
  const lower = Number(match[1]);
  const upper = Number(match[2]);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper <= lower) return undefined;
  return { lower, upper };
}

function parseAddressList(value: string | undefined) {
  if (!value) return [] as readonly { address: Address; name: string }[];

  let parsed: unknown = value.split(/[\s,]+/).filter(Boolean);
  try {
    const json = JSON.parse(value) as unknown;
    if (Array.isArray(json)) parsed = json;
  } catch {
    // A simple comma separated list is also supported.
  }

  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const result: Array<{ address: Address; name: string }> = [];
  for (const item of parsed) {
    const address = typeof item === "string"
      ? item
      : typeof item === "object" && item !== null && "address" in item && typeof item.address === "string"
        ? item.address
        : undefined;
    if (!address || !isAddress(address)) continue;
    const normalized = address.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const name = typeof item === "object" && item !== null && "name" in item && typeof item.name === "string" && item.name.trim()
      ? item.name.trim().slice(0, 64)
      : `Vault ${result.length + 1}`;
    result.push({ address: address as Address, name });
    if (result.length >= MAX_VAULTS) break;
  }
  return result;
}

function providerRpcUrl() {
  return envValue("BSC_RPC_URL") ?? envValue("NEXT_PUBLIC_BSC_RPC_URL");
}

function formatRatio(numerator: bigint, denominator: bigint, decimals: number) {
  if (denominator <= BigInt(0)) return "0";
  const scale = BigInt(10) ** BigInt(Math.max(0, Math.min(decimals, 18)));
  return formatUnits((numerator * scale) / denominator, Math.max(0, Math.min(decimals, 18)));
}

function formatPoolPrice(sqrtPriceX96: bigint, token0Decimals: number, token1Decimals: number) {
  if (sqrtPriceX96 <= BigInt(0)) return "0";
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const decimalDelta = token0Decimals - token1Decimals;
  const adjustedNumerator = decimalDelta >= 0
    ? numerator * (BigInt(10) ** BigInt(Math.min(decimalDelta, 36)))
    : numerator;
  const adjustedDenominator = decimalDelta < 0
    ? (BigInt(1) << BigInt(192)) * (BigInt(10) ** BigInt(Math.min(Math.abs(decimalDelta), 36)))
    : BigInt(1) << BigInt(192);
  return formatRatio(adjustedNumerator, adjustedDenominator, 8);
}

function createDefaultTelemetryReader(): ProviderTelemetryReader {
  const client = createPublicClient({
    chain: bsc,
    transport: createBscMainnetTransport(providerRpcUrl(), 10_000),
  });

  return {
    async readChainSnapshot() {
      const block = await client.getBlock();
      return {
        chainId: 56,
        blockNumber: block.number.toString(),
        blockTimestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
        ...(block.hash ? { blockHash: block.hash } : {}),
      };
    },
    async readPoolSnapshot(address) {
      const [slot0, liquidity, token0, token1, fee] = await Promise.all([
        client.readContract({ address, abi: PANCAKESWAP_V3_POOL_ABI, functionName: "slot0" }),
        client.readContract({ address, abi: PANCAKESWAP_V3_POOL_ABI, functionName: "liquidity" }),
        client.readContract({ address, abi: PANCAKESWAP_V3_POOL_ABI, functionName: "token0" }),
        client.readContract({ address, abi: PANCAKESWAP_V3_POOL_ABI, functionName: "token1" }),
        client.readContract({ address, abi: PANCAKESWAP_V3_POOL_ABI, functionName: "fee" }).catch(() => undefined),
      ]);
      const token0Address = token0 as Address;
      const token1Address = token1 as Address;
      const [token0Decimals, token0Symbol, token1Decimals, token1Symbol] = await Promise.all([
        client.readContract({ address: token0Address, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
        client.readContract({ address: token0Address, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
        client.readContract({ address: token1Address, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
        client.readContract({ address: token1Address, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
      ]);
      const slot = slot0 as readonly [bigint, number, number, number, number, number, boolean];
      return {
        address,
        token0: token0Address,
        token1: token1Address,
        token0Symbol: String(token0Symbol).slice(0, 24),
        token1Symbol: String(token1Symbol).slice(0, 24),
        token0Decimals: Number(token0Decimals),
        token1Decimals: Number(token1Decimals),
        ...(fee === undefined ? {} : { feeTier: `${Number(fee) / 10_000}%` }),
        tick: Number(slot[1]),
        liquidity: String(liquidity),
        spotPriceToken1PerToken0: formatPoolPrice(BigInt(slot[0]), Number(token0Decimals), Number(token1Decimals)),
      };
    },
    async readYieldVaultSnapshot(address, name) {
      const [asset, totalAssets, totalSupply, vaultDecimals] = await Promise.all([
        client.readContract({ address, abi: ERC4626_VAULT_ABI, functionName: "asset" }),
        client.readContract({ address, abi: ERC4626_VAULT_ABI, functionName: "totalAssets" }),
        client.readContract({ address, abi: ERC4626_VAULT_ABI, functionName: "totalSupply" }),
        client.readContract({ address, abi: ERC4626_VAULT_ABI, functionName: "decimals" }),
      ]);
      const assetAddress = asset as Address;
      const [assetSymbol, assetDecimals] = await Promise.all([
        client.readContract({ address: assetAddress, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
        client.readContract({ address: assetAddress, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
      ]);
      const shareUnit = BigInt(10) ** BigInt(Math.min(Math.max(Number(vaultDecimals), 0), 36));
      const assetsPerShare = totalSupply === BigInt(0)
        ? "0"
        : formatUnits(
            (await client.readContract({ address, abi: ERC4626_VAULT_ABI, functionName: "convertToAssets", args: [shareUnit] })) as bigint,
            Number(assetDecimals),
          );
      return {
        address,
        name,
        asset: assetAddress,
        assetSymbol: String(assetSymbol).slice(0, 24),
        totalAssets: formatUnits(totalAssets as bigint, Number(assetDecimals)),
        totalSupply: String(totalSupply),
        assetsPerShare,
      };
    },
    async readHealthFactorSnapshot(poolAddress, account) {
      const data = await client.readContract({ address: poolAddress, abi: LENDING_POOL_ABI, functionName: "getUserAccountData", args: [account] });
      const values = data as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
      return {
        poolAddress,
        account,
        totalCollateralBase: String(values[0]),
        totalDebtBase: String(values[1]),
        currentLiquidationThreshold: String(values[3]),
        healthFactor: formatUnits(values[5], 18),
      };
    },
  };
}

function staticCategorySummary(request: ProviderExecutionRequest) {
  const task = safeSummary(request.job.taskSummary);
  if (request.job.category === "rebalancing") return `Rebalancing strategy accepted: ${task}`;
  if (request.job.category === "grid-trading") return `Grid trading strategy accepted: ${task}`;
  if (request.job.category === "yield-optimisation") return `Yield optimisation strategy accepted: ${task}`;
  if (request.job.category === "health-factor-monitoring") return `Health factor monitoring strategy accepted: ${task}`;
  return `Strategy accepted: ${task}`;
}

export function buildStaticProviderExecutionResult(request: ProviderExecutionRequest): ProviderExecutionResponse {
  return {
    status: "completed",
    resultSummary: staticCategorySummary(request),
  };
}

async function readChainSnapshot(reader: ProviderTelemetryReader) {
  try {
    return await reader.readChainSnapshot();
  } catch (error) {
    throw new ProviderStrategyError(`Live BSC telemetry is unavailable. The provider result was not submitted. ${shortError(error)}`);
  }
}

async function readConfiguredPool(reader: ProviderTelemetryReader, request: ProviderExecutionRequest) {
  const address = configuredAddress(
    "PLOW_PROVIDER_POOL_ADDRESS",
    request.job.taskSummary,
    ["pool", "pair", "market"],
  );
  if (!address) return undefined;
  try {
    return await reader.readPoolSnapshot(address);
  } catch (error) {
    throw new ProviderStrategyError(`The configured PancakeSwap pool could not be read. ${shortError(error)}`);
  }
}

function poolDescription(pool: ProviderPoolSnapshot | undefined) {
  if (!pool) return "No PancakeSwap V3 pool address was configured, so no position range or spot price was asserted.";
  return `Pool ${pool.token0Symbol}/${pool.token1Symbol} at ${pool.address}; spot ${pool.spotPriceToken1PerToken0} ${pool.token1Symbol} per ${pool.token0Symbol}; tick ${pool.tick}; liquidity ${pool.liquidity}${pool.feeTier ? `; fee tier ${pool.feeTier}` : ""}.`;
}

async function buildRebalancingSummary(request: ProviderExecutionRequest, reader: ProviderTelemetryReader, chain: BscChainSnapshot) {
  const pool = await readConfiguredPool(reader, request);
  const range = parseRange(request.job.taskSummary);
  let recommendation = "Provide the current lower and upper position bounds before proposing a range change.";
  if (pool && range) {
    const spot = Number(pool.spotPriceToken1PerToken0);
    recommendation = !Number.isFinite(spot)
      ? "The spot price could not be compared with the requested range."
      : spot < range.lower
        ? `Spot is below the requested range ${range.lower} to ${range.upper}; review a lower or recentered range.`
        : spot > range.upper
          ? `Spot is above the requested range ${range.lower} to ${range.upper}; review a higher or recentered range.`
          : `Spot is inside the requested range ${range.lower} to ${range.upper}; no rebalance is recommended.`;
  }
  return `Rebalancing provider completed a read only BSC analysis at block ${chain.blockNumber} (${chain.blockTimestamp}). ${poolDescription(pool)} ${recommendation} No DeFi transaction was attempted.`;
}

async function buildGridSummary(request: ProviderExecutionRequest, reader: ProviderTelemetryReader, chain: BscChainSnapshot) {
  const pool = await readConfiguredPool(reader, request);
  const levels = Math.max(2, Math.round(numberAfterKeyword(request.job.taskSummary, ["grid levels", "levels"], DEFAULT_GRID_LEVELS, 20)));
  const bandPercent = numberAfterKeyword(request.job.taskSummary, ["band", "band percent", "grid band"], DEFAULT_GRID_BAND_PERCENT, 50);
  if (!pool) {
    return `Grid trading provider completed a read only BSC analysis at block ${chain.blockNumber} (${chain.blockTimestamp}). ${poolDescription(pool)} A ${levels} level grid across plus or minus ${bandPercent}% needs a configured pool before prices can be calculated. No order was placed.`;
  }
  const spot = Number(pool.spotPriceToken1PerToken0);
  if (!Number.isFinite(spot) || spot <= 0) {
    return `Grid trading provider completed a read only BSC analysis at block ${chain.blockNumber} (${chain.blockTimestamp}). ${poolDescription(pool)} The spot price is not usable for grid levels. No order was placed.`;
  }
  const lower = spot * (1 - bandPercent / 100);
  const upper = spot * (1 + bandPercent / 100);
  const step = (upper - lower) / (levels - 1);
  const middle = spot.toFixed(8);
  return `Grid trading provider completed a read only BSC analysis at block ${chain.blockNumber} (${chain.blockTimestamp}). ${poolDescription(pool)} Proposed ${levels} price levels from ${lower.toFixed(8)} to ${upper.toFixed(8)} with approximately ${step.toFixed(8)} spacing; current spot ${middle}. This is a plan only. No order was placed.`;
}

async function buildYieldSummary(request: ProviderExecutionRequest, reader: ProviderTelemetryReader, chain: BscChainSnapshot) {
  const configured = parseAddressList(envValue("PLOW_PROVIDER_YIELD_VAULTS") ?? envValue("PLOW_PROVIDER_YIELD_VAULT_ADDRESSES"));
  if (configured.length === 0) {
    return `Yield optimisation provider completed a read only BSC analysis at block ${chain.blockNumber} (${chain.blockTimestamp}). No ERC 4626 vault list is configured, so no APY or route was asserted. Configure PLOW_PROVIDER_YIELD_VAULTS for onchain vault comparisons. No deposit was attempted.`;
  }
  const snapshots: ProviderYieldVaultSnapshot[] = [];
  for (const vault of configured) {
    try {
      snapshots.push(await reader.readYieldVaultSnapshot(vault.address, vault.name));
    } catch (error) {
      throw new ProviderStrategyError(`Configured yield vault ${vault.address} could not be read. ${shortError(error)}`);
    }
  }
  const ranked = [...snapshots].sort((left, right) => Number(right.assetsPerShare) - Number(left.assetsPerShare));
  const routes = ranked.map((vault, index) => `${index + 1}. ${vault.name} ${vault.assetsPerShare} ${vault.assetSymbol} per share, assets ${vault.totalAssets} ${vault.assetSymbol}`).join("; ");
  return `Yield optimisation provider completed a read only BSC analysis at block ${chain.blockNumber} (${chain.blockTimestamp}). Ranked configured ERC 4626 vaults by current assets per share: ${routes}. This is not an APY calculation and does not predict returns. No deposit or withdrawal was attempted.`;
}

async function buildHealthSummary(request: ProviderExecutionRequest, reader: ProviderTelemetryReader, chain: BscChainSnapshot) {
  const poolAddress = configuredAddress(
    "PLOW_PROVIDER_LENDING_POOL_ADDRESS",
    request.job.taskSummary,
    ["lending pool", "protocol pool"],
  );
  if (!poolAddress) {
    return `Health factor provider completed a read only BSC analysis at block ${chain.blockNumber} (${chain.blockTimestamp}). No lending pool is configured, so no health factor was asserted. Configure PLOW_PROVIDER_LENDING_POOL_ADDRESS for account data. No liquidation or repayment was attempted.`;
  }
  if (!isAddress(request.job.clientAddress)) {
    throw new ProviderStrategyError("The job client address is not valid for a health factor read.", 409);
  }
  let snapshot: ProviderHealthFactorSnapshot;
  try {
    snapshot = await reader.readHealthFactorSnapshot(poolAddress, request.job.clientAddress as Address);
  } catch (error) {
    throw new ProviderStrategyError(`The configured lending pool could not return account data. ${shortError(error)}`);
  }
  const threshold = numberAfterKeyword(request.job.taskSummary, ["alert below", "threshold"], 1.2, 10);
  const healthFactor = Number(snapshot.healthFactor);
  const alert = Number.isFinite(healthFactor) && healthFactor < threshold
    ? `Alert: health factor ${snapshot.healthFactor} is below ${threshold}.`
    : `No alert: health factor ${snapshot.healthFactor} is at or above ${threshold}.`;
  return `Health factor monitoring provider completed a read only BSC analysis at block ${chain.blockNumber} (${chain.blockTimestamp}). Lending pool ${snapshot.poolAddress}; account ${snapshot.account}; collateral base ${snapshot.totalCollateralBase}; debt base ${snapshot.totalDebtBase}; liquidation threshold ${snapshot.currentLiquidationThreshold}; health factor ${snapshot.healthFactor}. ${alert} No liquidation or repayment was attempted.`;
}

export async function buildLiveProviderExecutionResult(
  request: ProviderExecutionRequest,
  options: ProviderStrategyOptions = {},
): Promise<ProviderExecutionResponse> {
  const category = request.job.category as AgentCategory;
  const supportedCategories = options.supportedCategories ?? AGENT_CATEGORIES;
  if (!AGENT_CATEGORIES.includes(category) || !supportedCategories.includes(category)) {
    throw new ProviderStrategyError(`This provider does not support the ${request.job.category} category.`, 409);
  }
  const reader = options.reader ?? createDefaultTelemetryReader();
  const chain = await readChainSnapshot(reader);
  const resultSummary = category === "rebalancing"
    ? await buildRebalancingSummary(request, reader, chain)
    : category === "grid-trading"
      ? await buildGridSummary(request, reader, chain)
      : category === "yield-optimisation"
        ? await buildYieldSummary(request, reader, chain)
        : await buildHealthSummary(request, reader, chain);
  return {
    status: "completed",
    resultSummary: safeSummary(resultSummary),
  };
}
