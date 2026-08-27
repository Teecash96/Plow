import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { bsc } from "viem/chains";

export const BSC_MAINNET_CHAIN_ID = 56;
export const ERC8004_IDENTITY_REGISTRY_ADDRESS = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address;
export const ERC8004_REGISTRY_EXPLORER_URL = `https://bscscan.com/address/${ERC8004_IDENTITY_REGISTRY_ADDRESS}`;

const DEFAULT_BSC_RPC_URL = "https://bsc.publicnode.com";
// Public BSC RPC endpoints commonly limit historical log queries. The default
// asks for a wider window, then falls back to a bounded recent window when the
// endpoint does not support archive logs. Operators can set ERC8004_SCAN_BLOCKS
// or ERC8004_FROM_BLOCK when using an archive capable RPC.
const DEFAULT_SCAN_BLOCKS = BigInt(100_000);
const DEFAULT_RECENT_FALLBACK_BLOCKS = BigInt(4_000);
const DEFAULT_MAX_AGENTS = 100;
const DEFAULT_LOG_CHUNK = BigInt(4_000);
const DEFAULT_MAX_SCAN_MS = 8_000;
const REQUEST_TIMEOUT_MS = 4_000;
const DEFAULT_INDEXER_URL = "https://8004scan.io/api/v1/agents/latest";
const MAX_SCAN_BLOCKS = BigInt(5_000_000);
const MAX_LOG_CHUNK = BigInt(10_000);

const IDENTITY_REGISTRY_ABI = parseAbi([
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

const REGISTERED_EVENT = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);

export interface ERC8004RegistrationMetadata {
  readonly [key: string]: unknown;
}

export interface ERC8004RegistrationRecord {
  agentId: string;
  agentURI: string;
  owner?: Address;
  metadata?: ERC8004RegistrationMetadata;
  metadataError?: string;
  metadataStatus?: "verified" | "missing" | "malformed" | "unsupported" | "unavailable";
  metadataUriResolved?: string;
  endpoints?: readonly string[];
  capabilities?: readonly string[];
  tags?: readonly string[];
  source?: "rpc" | "indexer";
  identityVerified?: boolean;
  indexerName?: string;
  indexerDescription?: string;
  indexerTags?: readonly string[];
  indexerCapabilities?: readonly string[];
  registeredAt?: string;
  registeredBlock?: string;
}

export interface ERC8004ScanSummary {
  requestedBlocks: string;
  scannedBlocks: string;
  fromBlock?: string;
  toBlock?: string;
  registrationEvents: number;
  returnedAgents: number;
  maxAgents: number;
  limited: boolean;
  warning?: string;
  indexer?: {
    used: boolean;
    returned: number;
    total?: number;
    source: string;
    warning?: string;
  };
}

export interface ERC8004DiscoveryResult {
  status: "ok" | "empty" | "unavailable";
  records: readonly ERC8004RegistrationRecord[];
  fetchedAt: string;
  scan: ERC8004ScanSummary;
  fromBlock?: string;
  toBlock?: string;
  error?: string;
}

export interface ERC8004DiscoveryConfig {
  rpcUrl: string;
  rpcSource: "environment" | "default";
  scanBlocks: bigint;
  fromBlock?: bigint;
  maxAgents: number;
  logChunk: bigint;
  maxScanMs: number;
  indexerUrl?: string;
}

interface RegisteredLog {
  args: {
    agentId?: bigint;
    agentURI?: string;
    owner?: Address;
  };
  blockNumber?: bigint;
}

interface RegistrationCandidate {
  agentId: string;
  agentURI: string;
  owner?: Address;
  blockNumber?: bigint;
  source: "rpc" | "indexer";
  indexerName?: string;
  indexerDescription?: string;
  indexerTags?: readonly string[];
  indexerCapabilities?: readonly string[];
  registeredAt?: string;
}

function configuredRpcUrl() {
  // ERC-8004 lives on BSC Mainnet — never point it at the testnet chain.
  // BSC_RPC_URL / NEXT_PUBLIC_BSC_RPC_URL belong to the hire escrow stack (chain 97).
  return process.env.ERC8004_RPC_URL?.trim() || process.env.NEXT_PUBLIC_ERC8004_RPC_URL?.trim() || DEFAULT_BSC_RPC_URL;
}

function configuredScanBlocks() {
  const value = process.env.ERC8004_SCAN_BLOCKS?.trim();
  if (!value) return DEFAULT_SCAN_BLOCKS;
  try {
    const parsed = BigInt(value);
    if (parsed <= BigInt(0)) return DEFAULT_SCAN_BLOCKS;
    if (parsed > MAX_SCAN_BLOCKS) {
      console.warn(`[erc8004] ERC8004_SCAN_BLOCKS is above the ${MAX_SCAN_BLOCKS} block safety cap. Using the cap.`);
      return MAX_SCAN_BLOCKS;
    }
    return parsed;
  } catch {
    console.warn("[erc8004] ERC8004_SCAN_BLOCKS is invalid. Using the default scan range.");
    return DEFAULT_SCAN_BLOCKS;
  }
}

function configuredFromBlock() {
  const value = process.env.ERC8004_FROM_BLOCK?.trim();
  if (!value) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= BigInt(0) ? parsed : undefined;
  } catch {
    console.warn("[erc8004] ERC8004_FROM_BLOCK is invalid. Ignoring the configured starting block.");
    return undefined;
  }
}

function configuredMaxAgents() {
  const raw = process.env.ERC8004_MAX_AGENTS?.trim();
  if (!raw) return DEFAULT_MAX_AGENTS;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    console.warn("[erc8004] ERC8004_MAX_AGENTS is invalid. Using the default agent limit.");
    return DEFAULT_MAX_AGENTS;
  }
  if (value > 500) console.warn("[erc8004] ERC8004_MAX_AGENTS is above the 500 agent safety cap. Using the cap.");
  return Math.min(value, 500);
}

function configuredLogChunk() {
  const value = process.env.ERC8004_LOG_CHUNK?.trim();
  if (!value) return DEFAULT_LOG_CHUNK;
  try {
    const parsed = BigInt(value);
    if (parsed <= BigInt(0)) return DEFAULT_LOG_CHUNK;
    if (parsed > MAX_LOG_CHUNK) {
      console.warn(`[erc8004] ERC8004_LOG_CHUNK is above the ${MAX_LOG_CHUNK} block safety cap. Using the cap.`);
      return MAX_LOG_CHUNK;
    }
    return parsed;
  } catch {
    console.warn("[erc8004] ERC8004_LOG_CHUNK is invalid. Using the default log chunk.");
    return DEFAULT_LOG_CHUNK;
  }
}

function configuredMaxScanMs() {
  const value = Number.parseInt(process.env.ERC8004_MAX_SCAN_MS ?? "", 10);
  return Number.isSafeInteger(value) && value >= 1_000 ? Math.min(value, 30_000) : DEFAULT_MAX_SCAN_MS;
}

function configuredIndexerUrl() {
  const value = process.env.ERC8004_INDEXER_URL?.trim();
  if (value?.toLowerCase() === "off" || value?.toLowerCase() === "none") return undefined;
  return value || DEFAULT_INDEXER_URL;
}

export function getERC8004Config(): ERC8004DiscoveryConfig {
  const rpcUrl = configuredRpcUrl();
  const envRpc = process.env.ERC8004_RPC_URL?.trim() || process.env.NEXT_PUBLIC_ERC8004_RPC_URL?.trim();
  return {
    rpcUrl,
    rpcSource: envRpc ? "environment" : "default",
    scanBlocks: configuredScanBlocks(),
    fromBlock: configuredFromBlock(),
    maxAgents: configuredMaxAgents(),
    logChunk: configuredLogChunk(),
    maxScanMs: configuredMaxScanMs(),
    indexerUrl: configuredIndexerUrl(),
  };
}

export function createBscPublicClient(rpcUrl = configuredRpcUrl()): PublicClient {
  return createPublicClient({
    chain: bsc,
    transport: http(rpcUrl, { timeout: REQUEST_TIMEOUT_MS }),
  });
}

function resolveMetadataUri(uri: string) {
  const trimmed = uri.trim();
  if (trimmed.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${trimmed.slice("ipfs://".length)}`;
  }
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  return undefined;
}

function decodeDataUri(uri: string) {
  const commaIndex = uri.indexOf(",");
  if (commaIndex === -1) return undefined;
  const header = uri.slice(0, commaIndex).toLowerCase();
  const payload = uri.slice(commaIndex + 1);
  if (!header.includes("application/json")) return undefined;

  try {
    if (header.includes(";base64")) return Buffer.from(payload, "base64").toString("utf8");
    return decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

interface MetadataFetchResult {
  metadata?: ERC8004RegistrationMetadata;
  error?: string;
  status: "verified" | "missing" | "malformed" | "unsupported" | "unavailable";
  resolvedUri?: string;
  endpoints: readonly string[];
  capabilities: readonly string[];
  tags: readonly string[];
}

function uniqueStrings(values: readonly string[], limit = 40) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function isUri(value: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^did:/i.test(value);
}

function metadataSignals(metadata: ERC8004RegistrationMetadata | undefined) {
  if (!metadata) return { endpoints: [], capabilities: [], tags: [] };
  const endpoints: string[] = [];
  const capabilities: string[] = [];
  const tags: string[] = [];
  const visit = (value: unknown, key = "", depth = 0) => {
    if (depth > 5) return;
    const normalizedKey = key.toLowerCase();
    if (typeof value === "string") {
      if ((normalizedKey.includes("endpoint") || normalizedKey.includes("service") || normalizedKey.includes("url")) && isUri(value) && !normalizedKey.includes("image")) endpoints.push(value);
      if (normalizedKey.includes("capabil") || normalizedKey.includes("skill") || normalizedKey.includes("tool") || normalizedKey.includes("feature")) capabilities.push(value);
      if (normalizedKey.includes("tag") || normalizedKey.includes("categor") || normalizedKey.includes("strateg")) tags.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key, depth + 1));
      return;
    }
    if (typeof value === "object" && value !== null) {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey, depth + 1));
    }
  };
  visit(metadata);
  return {
    endpoints: uniqueStrings(endpoints),
    capabilities: uniqueStrings(capabilities),
    tags: uniqueStrings(tags),
  };
}

function metadataResult(metadata: ERC8004RegistrationMetadata, resolvedUri?: string): MetadataFetchResult {
  const signals = metadataSignals(metadata);
  return { metadata, status: "verified", resolvedUri, ...signals };
}

async function fetchMetadata(uri: string): Promise<MetadataFetchResult> {
  if (!uri.trim()) return { status: "missing", error: "No agent URI is set.", endpoints: [], capabilities: [], tags: [] };
  const dataUri = decodeDataUri(uri);
  if (dataUri) {
    try {
      const parsed: unknown = JSON.parse(dataUri);
      return isRecord(parsed) ? metadataResult(parsed, uri) : { status: "malformed", error: "Metadata JSON is not an object.", endpoints: [], capabilities: [], tags: [] };
    } catch {
      return { status: "malformed", error: "Metadata data URI is not valid JSON.", endpoints: [], capabilities: [], tags: [] };
    }
  }

  const resolved = resolveMetadataUri(uri);
  if (!resolved) return { status: "unsupported", error: "Metadata URI scheme is not supported by this adapter.", endpoints: [], capabilities: [], tags: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(resolved, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return { status: "unavailable", error: `Metadata request returned HTTP ${response.status}.`, endpoints: [], capabilities: [], tags: [] };
    const body = await response.text();
    if (body.length > 1_000_000) return { status: "malformed", error: "Metadata response is larger than 1 MB.", endpoints: [], capabilities: [], tags: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { status: "malformed", error: "Metadata response is not valid JSON.", endpoints: [], capabilities: [], tags: [] };
    }
    return isRecord(parsed) ? metadataResult(parsed, resolved) : { status: "malformed", error: "Metadata JSON is not an object.", endpoints: [], capabilities: [], tags: [] };
  } catch (error) {
    return { status: "unavailable", error: error instanceof Error ? error.message : "Metadata request failed.", endpoints: [], capabilities: [], tags: [] };
  } finally {
    clearTimeout(timeout);
  }
}

interface IndexerDiscoveryResult {
  candidates: readonly RegistrationCandidate[];
  total?: number;
  warning?: string;
}

async function fetchIndexerCandidates(indexerUrl: string | undefined, maxAgents: number): Promise<IndexerDiscoveryResult> {
  if (!indexerUrl || maxAgents <= 0) return { candidates: [] };
  const pageSize = 100;
  const requested = Math.min(maxAgents, 500);
  const pageCount = Math.ceil(requested / pageSize);
  type IndexerPage = { items: readonly Record<string, unknown>[]; total?: number; warning?: string };
  const fetchPage = async (offset: number): Promise<IndexerPage> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = new URL(indexerUrl);
      url.searchParams.set("chain_id", String(BSC_MAINNET_CHAIN_ID));
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return { items: [], warning: `Indexer returned HTTP ${response.status} at offset ${offset}.` };
      const body = await response.text();
      if (body.length > 3_000_000) return { items: [], warning: `Indexer response exceeded 3 MB at offset ${offset}.` };
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { items?: unknown }).items)) {
        return { items: [], warning: `Indexer response did not contain an items list at offset ${offset}.` };
      }
      const payload = parsed as { items: readonly Record<string, unknown>[]; total?: unknown };
      return { items: payload.items, total: typeof payload.total === "number" ? payload.total : undefined };
    } catch (error) {
      return { items: [], warning: error instanceof Error ? error.message : `Indexer request failed at offset ${offset}.` };
    } finally {
      clearTimeout(timeout);
    }
  };

  const pages = await Promise.all(Array.from({ length: pageCount }, (_, page) => fetchPage(page * pageSize)));
  const candidates: RegistrationCandidate[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const item of page.items) {
      const chainId = Number(item.chain_id);
      const contractAddress = typeof item.contract_address === "string" ? item.contract_address : "";
      const tokenId = typeof item.token_id === "string" || typeof item.token_id === "number" ? String(item.token_id) : "";
      if (chainId !== BSC_MAINNET_CHAIN_ID || item.is_testnet === true || contractAddress.toLowerCase() !== ERC8004_IDENTITY_REGISTRY_ADDRESS.toLowerCase() || !tokenId || seen.has(tokenId)) continue;
      seen.add(tokenId);
      const protocols = Array.isArray(item.supported_protocols) ? item.supported_protocols.filter((value): value is string => typeof value === "string") : [];
      const tags = [...protocols, item.x402_supported === true ? "x402" : ""].filter(Boolean);
      candidates.push({
        agentId: tokenId,
        agentURI: "",
        owner: typeof item.owner_address === "string" && /^0x[a-fA-F0-9]{40}$/.test(item.owner_address) ? item.owner_address as Address : undefined,
        source: "indexer",
        indexerName: typeof item.name === "string" ? item.name : undefined,
        indexerDescription: typeof item.description === "string" ? item.description : undefined,
        indexerTags: tags,
        indexerCapabilities: protocols,
        registeredAt: typeof item.updated_at === "string" ? item.updated_at : typeof item.created_at === "string" ? item.created_at : undefined,
      });
      if (candidates.length >= requested) break;
    }
    if (candidates.length >= requested) break;
  }
  return {
    candidates,
    total: pages.find((page) => page.total !== undefined)?.total,
    warning: pages.map((page) => page.warning).filter(Boolean).join(" ") || undefined,
  };
}

function isRecord(value: unknown): value is ERC8004RegistrationMetadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getRegisteredLogsInRange(client: PublicClient, fromBlock: bigint, toBlock: bigint): Promise<readonly RegisteredLog[]> {
  try {
    return await client.getLogs({
      address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
      event: REGISTERED_EVENT,
      fromBlock,
      toBlock,
    });
  } catch (error) {
    if (isArchiveError(error)) {
      throw error;
    }
    const span = toBlock - fromBlock;
    if (span <= BigInt(100)) throw error;
    const midpoint = fromBlock + span / BigInt(2);
    const [left, right] = await Promise.all([
      getRegisteredLogsInRange(client, fromBlock, midpoint),
      getRegisteredLogsInRange(client, midpoint + BigInt(1), toBlock),
    ]);
    return [...left, ...right];
  }
}

function isArchiveError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("archive request") || message.includes("personal token") || message.includes("archive capable");
}

interface LogScanResult {
  logs: readonly RegisteredLog[];
  complete: boolean;
  warning?: string;
}

async function getRegisteredLogs(client: PublicClient, fromBlock: bigint, toBlock: bigint, maxScanMs: number): Promise<LogScanResult> {
  const chunkSize = configuredLogChunk();
  const deadline = Date.now() + maxScanMs;
  const ranges: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    ranges.push([start, start + chunkSize - BigInt(1) > toBlock ? toBlock : start + chunkSize - BigInt(1)]);
  }

  const logs: RegisteredLog[] = [];
  for (let index = 0; index < ranges.length; index += 4) {
    if (Date.now() >= deadline) {
      return { logs, complete: false, warning: "Scan time limit reached before the requested block range completed." };
    }
    const batch = ranges.slice(index, index + 4);
    try {
      const result = await Promise.all(batch.map(([start, end]) => getRegisteredLogsInRange(client, start, end)));
      logs.push(...result.flat());
    } catch (error) {
      if (logs.length > 0 && !isArchiveError(error)) {
        return { logs, complete: false, warning: "The RPC limited the scan after a partial result." };
      }
      throw error;
    }
  }
  return { logs, complete: true };
}

async function readCurrentUris(client: PublicClient, registrations: readonly RegistrationCandidate[]) {
  try {
    const results = await client.multicall({
      contracts: registrations.map((registration) => ({
        address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "tokenURI" as const,
        args: [BigInt(registration.agentId)] as const,
      })),
      allowFailure: true,
    });
    return registrations.map((registration, index) => {
      const result = results[index];
      return {
        registration,
        currentUri: result?.status === "success" && typeof result.result === "string" ? result.result : undefined,
      };
    });
  } catch {
    // Some RPC providers do not expose multicall. Fall back to individual reads.
    const results = [];
    for (const registration of registrations) {
      try {
        const currentUri = await client.readContract({
          address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "tokenURI",
          args: [BigInt(registration.agentId)],
        });
        results.push({ registration, currentUri });
      } catch {
        results.push({ registration, currentUri: undefined });
      }
    }
    return results;
  }
}

export async function discoverERC8004Agents(options: {
  client?: PublicClient;
  fromBlock?: bigint;
  toBlock?: bigint;
  maxAgents?: number;
} = {}): Promise<ERC8004DiscoveryResult> {
  const fetchedAt = new Date().toISOString();
  const config = getERC8004Config();
  const client = options.client ?? createBscPublicClient();
  const maxAgents = options.maxAgents ?? config.maxAgents;

  try {
    const latestBlock = options.toBlock ?? await client.getBlockNumber();
    const requestedFromBlock = options.fromBlock ?? config.fromBlock;
    const fromBlockWasClamped = requestedFromBlock !== undefined && requestedFromBlock > latestBlock;
    const initialFromBlock = requestedFromBlock !== undefined
      ? requestedFromBlock > latestBlock ? latestBlock : requestedFromBlock
      : latestBlock > config.scanBlocks ? latestBlock - config.scanBlocks + BigInt(1) : BigInt(0);
    let fromBlock = initialFromBlock;
    let logScan: LogScanResult;
    let fallbackWarning: string | undefined;
    try {
      logScan = await getRegisteredLogs(client, fromBlock, latestBlock, config.maxScanMs);
    } catch (error) {
      if (requestedFromBlock !== undefined || initialFromBlock === BigInt(0) || !isArchiveError(error)) throw error;
      fromBlock = latestBlock > DEFAULT_RECENT_FALLBACK_BLOCKS ? latestBlock - DEFAULT_RECENT_FALLBACK_BLOCKS + BigInt(1) : BigInt(0);
      logScan = await getRegisteredLogs(client, fromBlock, latestBlock, config.maxScanMs);
      fallbackWarning = `The RPC does not expose the requested historical range. Showing the recent ${latestBlock - fromBlock + BigInt(1)} block window instead.`;
    }

    const seen = new Set<string>();
    const registrations: RegistrationCandidate[] = [];
    for (const log of logScan.logs) {
      const agentId = log.args.agentId?.toString();
      if (!agentId || seen.has(agentId)) continue;
      seen.add(agentId);
      registrations.push({
        agentId,
        agentURI: log.args.agentURI ?? "",
        owner: log.args.owner,
        blockNumber: log.blockNumber,
        source: "rpc",
      });
      if (registrations.length >= maxAgents) break;
    }

    const shouldUseIndexer = Boolean(config.indexerUrl && (logScan.warning || fromBlock !== initialFromBlock || registrations.length < maxAgents));
    const indexerResult: IndexerDiscoveryResult = shouldUseIndexer
      ? await fetchIndexerCandidates(config.indexerUrl, maxAgents)
      : { candidates: [] };
    const indexerSeen = new Set<string>();
    const candidates = [
      ...registrations,
      ...indexerResult.candidates.filter((candidate) => {
        if (seen.has(candidate.agentId) || indexerSeen.has(candidate.agentId)) return false;
        indexerSeen.add(candidate.agentId);
        return true;
      }),
    ].slice(0, maxAgents);

    const resolveRegistration = async ({ registration, currentUri }: Awaited<ReturnType<typeof readCurrentUris>>[number]): Promise<ERC8004RegistrationRecord | undefined> => {
      if (!currentUri && registration.source === "rpc") return undefined;
      const { owner } = registration;
      const metadataResult = currentUri
        ? await fetchMetadata(currentUri)
        : {
          status: "unavailable" as const,
          error: "Metadata URI was not returned by the identity registry. On chain identity verification is pending.",
          endpoints: [] as readonly string[],
          capabilities: registration.indexerCapabilities ?? [],
          tags: registration.indexerTags ?? [],
        };
      return {
        agentId: registration.agentId,
        agentURI: currentUri ?? registration.agentURI,
        owner,
        metadata: metadataResult.metadata,
        metadataError: metadataResult.error,
        metadataStatus: metadataResult.status,
        metadataUriResolved: metadataResult.resolvedUri,
        endpoints: metadataResult.endpoints,
        capabilities: metadataResult.capabilities.length ? metadataResult.capabilities : registration.indexerCapabilities ?? [],
        tags: metadataResult.tags.length ? metadataResult.tags : registration.indexerTags ?? [],
        source: registration.source,
        identityVerified: Boolean(currentUri),
        indexerName: registration.indexerName,
        indexerDescription: registration.indexerDescription,
        indexerTags: registration.indexerTags,
        indexerCapabilities: registration.indexerCapabilities,
        registeredAt: registration.registeredAt,
        registeredBlock: registration.blockNumber?.toString(),
      } satisfies ERC8004RegistrationRecord;
    };

    const records: ERC8004RegistrationRecord[] = [];
    const currentUris = await readCurrentUris(client, candidates);
    const resolved = await Promise.all(currentUris.map(resolveRegistration));
    for (const record of resolved) {
      if (record) records.push(record);
    }

    const scannedBlocks = latestBlock - fromBlock + BigInt(1);
    const cappedByMaxAgents = registrations.length >= maxAgents;
    const warnings = [
      fallbackWarning,
      fromBlockWasClamped ? `Configured ERC8004_FROM_BLOCK is ahead of the latest BSC block. Starting at block ${latestBlock}.` : undefined,
      logScan.warning,
      indexerResult.warning,
      cappedByMaxAgents ? `Maximum agent limit reached at ${maxAgents}.` : undefined,
    ].filter(Boolean);
    const scan: ERC8004ScanSummary = {
      requestedBlocks: (latestBlock - initialFromBlock + BigInt(1)).toString(),
      scannedBlocks: scannedBlocks.toString(),
      fromBlock: fromBlock.toString(),
      toBlock: latestBlock.toString(),
      registrationEvents: logScan.logs.length,
      returnedAgents: records.length,
      maxAgents,
      limited: Boolean(fallbackWarning || fromBlockWasClamped || logScan.warning || indexerResult.warning || cappedByMaxAgents || fromBlock !== initialFromBlock),
      warning: warnings.join(" ") || undefined,
      indexer: {
        used: shouldUseIndexer,
        returned: indexerResult.candidates.length,
        total: indexerResult.total,
        source: config.indexerUrl ?? "disabled",
        warning: indexerResult.warning,
      },
    };
    if (scan.warning) console.warn(`[erc8004] ${scan.warning}`);

    return {
      status: records.length > 0 ? "ok" : "empty",
      records,
      fetchedAt,
      scan,
      fromBlock: fromBlock.toString(),
      toBlock: latestBlock.toString(),
    };
  } catch (error) {
    return {
      status: "unavailable",
      records: [],
      fetchedAt,
      scan: {
        requestedBlocks: config.fromBlock ? "0" : config.scanBlocks.toString(),
        scannedBlocks: "0",
        registrationEvents: 0,
        returnedAgents: 0,
        maxAgents,
        limited: true,
        warning: "The BSC RPC or ERC 8004 registry could not be read.",
      },
      error: error instanceof Error ? error.message : "ERC 8004 registry request failed.",
    };
  }
}

export function getERC8004ExplorerUrl(agentId: string) {
  return `https://bscscan.com/token/${ERC8004_IDENTITY_REGISTRY_ADDRESS}?a=${encodeURIComponent(agentId)}`;
}

export function isERC8004RegistryAddress(address: string) {
  return address.toLowerCase() === ERC8004_IDENTITY_REGISTRY_ADDRESS.toLowerCase() && address !== zeroAddress;
}
