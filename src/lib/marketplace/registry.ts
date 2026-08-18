import { CATEGORY_DEFINITIONS } from "./categories";
import { classifyAgentCategory } from "./category-classifier";
import { curatedCategoryForLiveAgent } from "./curated-category-mapping";
import { AGENTS as DEMO_AND_STATIC_AGENTS } from "./agents";
import {
  discoverERC8004Agents,
  ERC8004_IDENTITY_REGISTRY_ADDRESS,
  getERC8004ExplorerUrl,
  type ERC8004DiscoveryResult,
  type ERC8004RegistrationMetadata,
  type ERC8004ScanSummary,
} from "@/lib/chain/erc8004-adapter";
import type { Agent, Evidence, MetricValue, RegistryCategory } from "./types";

export type LiveRegistryStatus = ERC8004DiscoveryResult["status"] | "stale";

export interface MarketplaceRegistryResult {
  agents: readonly Agent[];
  liveAgents: readonly Agent[];
  demoAgents: readonly Agent[];
  liveStatus: LiveRegistryStatus;
  fetchedAt: string;
  scan: ERC8004ScanSummary;
  lastSuccessfulFetchAt?: string;
  error?: string;
}

const REGISTRY_CACHE_MS = 60_000;
let cachedResult: MarketplaceRegistryResult | undefined;
let cachedAt = 0;
let pendingResult: Promise<MarketplaceRegistryResult> | undefined;

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function flattenText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(flattenText);
  return [];
}

function metadataText(metadata: ERC8004RegistrationMetadata | undefined, keys: readonly string[]) {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = textValue(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function getServiceUri(metadata: ERC8004RegistrationMetadata | undefined, endpoints: readonly string[] = []) {
  const firstEndpoint = endpoints.find(Boolean);
  if (firstEndpoint) return firstEndpoint;
  if (!metadata) return undefined;
  const candidates = [metadata.endpoint, metadata.service, metadata.serviceUri, metadata.services, metadata.endpoints, metadata.url, metadata.uri];
  for (const candidate of candidates) {
    const values = flattenText(candidate);
    const uri = values.find((value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^did:/i.test(value));
    if (uri) return uri;
  }
  return undefined;
}

function metricSet(category: RegistryCategory, capturedAt: string): readonly MetricValue[] {
  const labels = CATEGORY_DEFINITIONS.find((definition) => definition.id === category)?.metricLabels ?? [
    "Primary metric",
    "Risk context",
    "Execution evidence",
  ];
  return labels.map((label, index) => ({
    key: `${category}-metric-${index + 1}`,
    label,
    sampleSize: 0,
    capturedAt,
    source: "onchain" as const,
  }));
}

function mapLiveRecord(record: ERC8004DiscoveryResult["records"][number], fetchedAt: string): Agent {
  const signals = {
    endpoints: record.endpoints ?? [],
    capabilities: record.capabilities ?? [],
    tags: record.tags ?? [],
  };
  const name = metadataText(record.metadata, ["name", "title"]) ?? record.indexerName ?? `ERC 8004 Agent #${record.agentId}`;
  const description = metadataText(record.metadata, ["description", "summary"]) ?? record.indexerDescription ?? "No description was published in the agent registration metadata.";
  const categoryInput = {
    metadata: record.metadata,
    name,
    description,
    endpoints: signals.endpoints,
    capabilities: signals.capabilities,
    tags: signals.tags,
  };
  const category = curatedCategoryForLiveAgent(record.agentId, categoryInput) ?? classifyAgentCategory(categoryInput);
  const serviceUri = getServiceUri(record.metadata, signals.endpoints);
  const identityVerified = record.identityVerified === true;
  const identityEvidenceSource = identityVerified ? "onchain" as const : "indexer" as const;
  const metadataEvidenceSource = record.metadata ? "onchain" as const : record.source === "indexer" ? "indexer" as const : "onchain" as const;
  const registeredEvidence = record.registeredBlock
    ? `Registration event was found on BSC Mainnet in block ${record.registeredBlock}.`
    : identityVerified
      ? "The ERC 8004 registry token URI was read from BSC Mainnet."
      : "The indexer returned this registry candidate.";
  const evidence: Evidence[] = [
    {
      id: `erc8004-${record.agentId}-identity`,
      kind: "identity" as const,
      label: "ERC 8004 identity",
      status: identityVerified ? "verified" as const : "pending" as const,
      source: identityEvidenceSource,
      capturedAt: fetchedAt,
      detail: identityVerified ? registeredEvidence : "The indexer returned this candidate, but the BSC registry token URI could not be verified yet.",
      explorerUrl: getERC8004ExplorerUrl(record.agentId),
    },
    {
      id: `erc8004-${record.agentId}-metadata`,
      kind: "identity" as const,
      label: "Registration metadata",
      status: record.metadataStatus === "verified" ? "verified" as const : record.metadataStatus === "unavailable" ? "pending" as const : "unavailable" as const,
      source: metadataEvidenceSource,
      capturedAt: fetchedAt,
      detail: record.metadata ? "Metadata was fetched from the URI published by the registry." : record.metadataError ?? "Metadata was not available.",
      explorerUrl: record.metadataUriResolved ?? (record.agentURI.startsWith("http") ? record.agentURI : undefined),
    },
    {
      id: `erc8004-${record.agentId}-freshness`,
      kind: "execution" as const,
      label: "Heartbeat and execution freshness",
      status: "unavailable" as const,
      source: "onchain" as const,
      capturedAt: fetchedAt,
      sampleSize: 0,
      detail: "ERC 8004 identity does not publish a heartbeat. A live execution feed is still required.",
    },
  ];
  if (record.registeredAt) {
    evidence.push({
      id: `erc8004-${record.agentId}-indexer-freshness`,
      kind: "execution" as const,
      label: "Indexer last updated",
      status: "pending" as const,
      source: "indexer" as const,
      capturedAt: fetchedAt,
      detail: `${record.registeredAt}. This is an indexer timestamp, not an execution heartbeat.`,
    });
  }

  return {
    id: `erc8004-bsc-${record.agentId}`,
    slug: `erc8004-${record.agentId}`,
    name,
    tagline: identityVerified
      ? serviceUri ? "Verified BSC identity with a published service endpoint." : "Verified BSC identity with no service endpoint published."
      : "Registry candidate awaiting on chain identity verification.",
    mode: "live",
    verified: identityVerified,
    category: category.category,
    categorySource: category.source,
    categoryEvidence: category.evidence,
    description,
    identity: {
      standard: "ERC-8004",
      agentId: record.agentId,
      registryAddress: ERC8004_IDENTITY_REGISTRY_ADDRESS,
      explorerUrl: getERC8004ExplorerUrl(record.agentId),
      verifiedAt: fetchedAt,
      ownerAddress: record.owner,
      metadataUri: record.agentURI || undefined,
      serviceUri,
      metadataStatus: record.metadataStatus,
      endpoints: signals.endpoints,
      capabilities: signals.capabilities,
      tags: signals.tags,
    },
    deployment: {
      network: "BSC Mainnet",
      chainId: 56,
      availability: identityVerified ? "live" : "unverified",
      freshnessState: "unknown",
      heartbeatAt: "Not available",
      lastExecutionAt: "Not available",
      freshnessSeconds: 0,
    },
    pricing: {
      protocol: "x402",
      amount: "Not available",
      currency: "USDC",
      unit: "per task",
    },
    performance: [
      { window: "7 day", sampleSize: 0, capturedAt: fetchedAt, source: "onchain" as const },
      { window: "30 day", sampleSize: 0, capturedAt: fetchedAt, source: "onchain" as const },
    ],
    categoryMetrics: metricSet(category.category, fetchedAt),
    riskBand: "unknown",
    evidence,
    integrations: {},
    hiring: {
      identityVerified,
      mainnetVerified: identityVerified,
      freshnessVerified: false,
      available: false,
      reason: identityVerified
        ? "Identity is registered on BSC. Freshness, pricing, and execution checks are still required."
        : "This candidate was found by an indexer. On chain identity verification is required before hiring.",
    },
  };
}

function mergeAgents(liveAgents: readonly Agent[], demoAgents: readonly Agent[]) {
  const merged = new Map<string, Agent>();
  for (const agent of [...liveAgents, ...demoAgents]) {
    const identityKey = `${agent.identity.registryAddress.toLowerCase()}:${agent.identity.agentId}`;
    if (!merged.has(identityKey) || agent.mode === "live") merged.set(identityKey, agent);
  }
  return [...merged.values()];
}

async function loadMarketplaceRegistry(): Promise<MarketplaceRegistryResult> {
  const discovery = await discoverERC8004Agents();
  const discoveredLiveAgents = discovery.records.map((record) => mapLiveRecord(record, discovery.fetchedAt));
  const staticLiveAgents = DEMO_AND_STATIC_AGENTS.filter((agent) => agent.mode === "live");
  const liveAgents = [...discoveredLiveAgents, ...staticLiveAgents];
  const demoAgents = DEMO_AND_STATIC_AGENTS.filter((agent) => agent.mode === "demo");
  const agents = mergeAgents(liveAgents, demoAgents);

  return {
    agents,
    liveAgents,
    demoAgents,
    liveStatus: discovery.status,
    fetchedAt: discovery.fetchedAt,
    scan: discovery.scan,
    lastSuccessfulFetchAt: discovery.status === "ok" ? discovery.fetchedAt : undefined,
    error: discovery.error,
  };
}

async function refreshMarketplaceRegistry(previous?: MarketplaceRegistryResult) {
  const fresh = await loadMarketplaceRegistry();
  if (fresh.liveStatus !== "ok" && previous?.liveAgents.length) {
    const warning = [
      fresh.scan.warning,
      "Showing previously cached live identities while the registry refresh is unavailable.",
    ].filter(Boolean).join(" ");
    return {
      ...fresh,
      agents: mergeAgents(previous.liveAgents, fresh.demoAgents),
      liveAgents: previous.liveAgents,
      liveStatus: "stale" as const,
      lastSuccessfulFetchAt: previous.lastSuccessfulFetchAt ?? previous.fetchedAt,
      scan: { ...fresh.scan, limited: true, warning },
      error: fresh.error ?? "Live registry refresh did not return a complete result.",
    };
  }
  return fresh;
}

function startRegistryRefresh(previous?: MarketplaceRegistryResult) {
  if (!pendingResult) {
    pendingResult = refreshMarketplaceRegistry(previous).then((result) => {
      cachedResult = result;
      cachedAt = Date.now();
      return result;
    }).finally(() => {
      pendingResult = undefined;
    });
  }
  return pendingResult;
}

export async function getMarketplaceRegistry(): Promise<MarketplaceRegistryResult> {
  const now = Date.now();
  if (cachedResult && now - cachedAt < REGISTRY_CACHE_MS) return cachedResult;
  if (cachedResult) {
    void startRegistryRefresh(cachedResult);
    return {
      ...cachedResult,
      liveStatus: "stale",
      scan: {
        ...cachedResult.scan,
        limited: true,
        warning: "Showing cached live identities while the registry refresh runs.",
      },
    };
  }
  return startRegistryRefresh();
}

export async function getMarketplaceAgentById(agentId: string) {
  const registry = await getMarketplaceRegistry();
  return registry.agents.find((agent) => agent.id === agentId || agent.slug === agentId);
}
