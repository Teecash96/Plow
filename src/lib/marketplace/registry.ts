import { CATEGORY_DEFINITIONS } from "./categories";
import { classifyAgentCategory } from "./category-classifier";
import { curatedCategoryForLiveAgent } from "./curated-category-mapping";
import { AGENTS as DEMO_AND_STATIC_AGENTS } from "./agents";
import { extractERC8004AgentId, findMarketplaceAgentById } from "./agent-lookup";
import { probeAgentService, validateAgentServiceUri } from "./agent-execution";
import { getLatestVerifiedAgentExecutionEvidence } from "./job-database";
import { getProviderProfileForAgent, getProviderServiceConfig, providerEndpointMatches } from "./provider-service";
import { getProviderSignerStatus } from "./provider-submission";
import { BSC_ERC8183_PAYMENT_CURRENCY } from "./payment-currency";
import {
  assessAgentServiceReadiness,
  parseAgentHeartbeatResponse,
  parseAgentServiceMetadata,
} from "./service-readiness";
import {
  discoverERC8004Agents,
  getERC8004AgentById,
  ERC8004_IDENTITY_REGISTRY_ADDRESS,
  getERC8004ExplorerUrl,
  type ERC8004DiscoveryResult,
  type ERC8004RegistrationMetadata,
  type ERC8004ScanSummary,
} from "@/lib/chain/erc8004-adapter";
import type { Agent, AgentServiceReadiness, Evidence, MetricValue, RegistryCategory } from "./types";

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
const DIRECT_AGENT_CACHE_MS = 60_000;
let cachedResult: MarketplaceRegistryResult | undefined;
let cachedAt = 0;
let pendingResult: Promise<MarketplaceRegistryResult> | undefined;
const directAgentCache = new Map<string, { agent: Agent; expiresAt: number }>();
const pendingDirectAgentLookups = new Map<string, Promise<Agent | undefined>>();

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataText(metadata: ERC8004RegistrationMetadata | undefined, keys: readonly string[]) {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = textValue(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function getServiceUri(metadata: ERC8004RegistrationMetadata | undefined) {
  return parseAgentServiceMetadata(metadata).executionEndpoint;
}

function initialServiceReadiness(metadata: ERC8004RegistrationMetadata | undefined, checkedAt: string) {
  const parsed = parseAgentServiceMetadata(metadata);
  return assessAgentServiceReadiness({
    checkedAt,
    now: checkedAt,
    endpoint: {
      url: parsed.executionEndpoint,
      verified: false,
      detail: parsed.executionEndpoint
        ? "The Plow execution endpoint is published but has not passed a server side probe."
        : "No explicit Plow execution endpoint is published in the registration metadata.",
    },
    x402Supported: parsed.x402Supported,
    pricing: parsed.pricing,
    heartbeat: {
      verified: false,
      detail: parsed.declaredHeartbeatAt
        ? "A heartbeat is declared, but a live health check is required."
        : "No provider heartbeat is published.",
    },
    expectedPaymentCurrency: BSC_ERC8183_PAYMENT_CURRENCY,
  });
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

function mapLiveRecord(
  record: ERC8004DiscoveryResult["records"][number],
  fetchedAt: string,
  verifiedServiceReadiness?: AgentServiceReadiness,
): Agent {
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
  const serviceMetadata = parseAgentServiceMetadata(record.metadata);
  const serviceUri = getServiceUri(record.metadata);
  const serviceReadiness = verifiedServiceReadiness ?? initialServiceReadiness(record.metadata, fetchedAt);
  const identityVerified = record.identityVerified === true;
  const identityEvidenceSource = identityVerified ? "onchain" as const : "indexer" as const;
  const metadataEvidenceSource = record.metadata ? "onchain" as const : record.source === "indexer" ? "indexer" as const : "onchain" as const;
  const registeredEvidence = record.registeredBlock
    ? `Registration event was found on BSC Mainnet in block ${record.registeredBlock}.`
    : identityVerified
      ? "The ERC 8004 registry token URI was read from BSC Mainnet."
      : "The indexer returned this registry candidate.";
  const serviceEndpointStatus = serviceReadiness.endpointVerified
    ? "verified" as const
    : serviceMetadata.executionEndpoint
      ? "pending" as const
      : "unavailable" as const;
  const pricingStatus = serviceReadiness.pricingVerified ? "verified" as const : "unavailable" as const;
  const heartbeatStatus = serviceReadiness.heartbeatVerified
    ? "verified" as const
    : serviceReadiness.heartbeatAt
      ? "stale" as const
      : "unavailable" as const;
  const executionEvidenceStatus = serviceReadiness.executionEvidenceVerified
    ? "verified" as const
    : serviceReadiness.bootstrapEligible
      ? "pending" as const
      : "unavailable" as const;
  const freshnessSeconds = serviceReadiness.heartbeatAt
    ? Math.max(0, Math.floor((Date.parse(fetchedAt) - Date.parse(serviceReadiness.heartbeatAt)) / 1_000))
    : 0;
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
      id: `erc8004-${record.agentId}-service-endpoint`,
      kind: "execution" as const,
      label: "Plow service endpoint",
      status: serviceEndpointStatus,
      source: metadataEvidenceSource,
      capturedAt: fetchedAt,
      sampleSize: 0,
      detail: serviceReadiness.endpoint.detail,
      explorerUrl: record.metadataUriResolved ?? undefined,
    },
    {
      id: `erc8004-${record.agentId}-pricing`,
      kind: "payment" as const,
      label: "x402 price",
      status: pricingStatus,
      source: metadataEvidenceSource,
      capturedAt: fetchedAt,
      sampleSize: 0,
      detail: serviceReadiness.pricing.detail,
      explorerUrl: record.metadataUriResolved ?? undefined,
    },
    {
      id: `erc8004-${record.agentId}-freshness`,
      kind: "execution" as const,
      label: "Provider heartbeat",
      status: heartbeatStatus,
      source: serviceReadiness.heartbeatVerified ? "agent" as const : metadataEvidenceSource,
      capturedAt: serviceReadiness.heartbeatAt ?? fetchedAt,
      sampleSize: 0,
      detail: serviceReadiness.heartbeat.detail,
    },
    {
      id: `erc8004-${record.agentId}-execution-evidence`,
      kind: "execution" as const,
      label: "Completed execution evidence",
      status: executionEvidenceStatus,
      source: serviceReadiness.executionEvidenceVerified ? "agent" as const : "operator" as const,
      capturedAt: serviceReadiness.lastExecutionAt ?? fetchedAt,
      sampleSize: serviceReadiness.executionEvidenceVerified ? 1 : 0,
      detail: serviceReadiness.executionEvidence.detail,
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
    ...(serviceMetadata.listingMode ? { listingMode: serviceMetadata.listingMode } : {}),
    supportedCategories: serviceMetadata.supportedCategories
      ?? (category.category !== "uncategorised" ? [category.category] : undefined),
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
      availability: identityVerified
        ? serviceReadiness.available
          ? "live"
          : serviceReadiness.heartbeatAt
            ? "stale"
            : "offline"
        : "unverified",
      freshnessState: serviceReadiness.heartbeatVerified ? "fresh" : serviceReadiness.heartbeatAt ? "stale" : "unknown",
      heartbeatAt: serviceReadiness.heartbeatAt ?? "Not available",
      lastExecutionAt: serviceReadiness.lastExecutionAt ?? "Not available",
      freshnessSeconds,
    },
    pricing: serviceMetadata.pricing ?? { protocol: "x402", amount: "Not available", currency: BSC_ERC8183_PAYMENT_CURRENCY, unit: "per task" },
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
      freshnessVerified: serviceReadiness.freshnessVerified,
      available: serviceReadiness.available,
      service: serviceReadiness,
      reason: identityVerified
        ? serviceReadiness.reason
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
  const directAgentId = extractERC8004AgentId(agentId);
  if (directAgentId) {
    const directAgent = await getDirectMarketplaceAgentById(directAgentId);
    if (directAgent) return directAgent;
  }

  const registry = await getMarketplaceRegistry();
  return findMarketplaceAgentById(agentId, registry.agents, getDirectMarketplaceAgentById);
}

async function verifyLiveServiceReadiness(
  record: ERC8004DiscoveryResult["records"][number],
  marketplaceAgentId: string,
  checkedAt: string,
) {
  const metadata = parseAgentServiceMetadata(record.metadata);
  let endpointVerified = false;
  let endpointDetail: string | undefined;
  if (!metadata.executionEndpoint) {
    endpointDetail = "No explicit Plow execution endpoint is published in the registration metadata.";
  } else {
    try {
      await validateAgentServiceUri(metadata.executionEndpoint);
      endpointVerified = true;
      endpointDetail = "The Plow execution endpoint resolves to a public HTTPS service.";
    } catch (error) {
      endpointDetail = error instanceof Error ? error.message : "The Plow execution endpoint could not be verified.";
    }
  }

  let heartbeatVerified = false;
  let heartbeatAt: string | undefined;
  let heartbeatDetail: string | undefined;
  if (!metadata.healthEndpoint) {
    heartbeatDetail = "No provider health endpoint is published in the registration metadata.";
  } else {
    try {
      const probe = await probeAgentService(metadata.healthEndpoint);
      heartbeatAt = parseAgentHeartbeatResponse(probe.body, record.agentId);
      heartbeatVerified = Boolean(heartbeatAt);
      heartbeatDetail = heartbeatVerified
        ? "The provider health endpoint returned a fresh heartbeat."
        : "The provider health endpoint did not return a matching heartbeat timestamp.";
    } catch (error) {
      heartbeatDetail = error instanceof Error ? error.message : "The provider health endpoint could not be verified.";
    }
  }

  const executionEvidence = await getLatestVerifiedAgentExecutionEvidence(record.agentId, marketplaceAgentId);
  const providerConfig = getProviderServiceConfig();
  const providerProfile = getProviderProfileForAgent(record.agentId, providerConfig);
  const providerSigner = getProviderSignerStatus(record.agentId);
  const bootstrapEligible = Boolean(
    providerConfig.ready
    && providerProfile
    && providerSigner.configured
    && metadata.executionEndpoint
    && providerEndpointMatches(metadata.executionEndpoint, providerConfig, record.agentId)
    && providerSigner.address
    && record.owner
    && record.owner.toLowerCase() === providerSigner.address.toLowerCase(),
  );
  return assessAgentServiceReadiness({
    checkedAt,
    endpoint: { url: metadata.executionEndpoint, verified: endpointVerified, detail: endpointDetail },
    x402Supported: metadata.x402Supported,
    pricing: metadata.pricing,
    heartbeat: { verified: heartbeatVerified, heartbeatAt, detail: heartbeatDetail },
    executionEvidence,
    bootstrapEligible,
    expectedPaymentCurrency: BSC_ERC8183_PAYMENT_CURRENCY,
  });
}

function getDirectMarketplaceAgentById(agentId: string): Promise<Agent | undefined> {
  const cached = directAgentCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.agent);

  const pending = pendingDirectAgentLookups.get(agentId);
  if (pending) return pending;

  const lookup = getERC8004AgentById(agentId)
    .then(async (record) => {
      if (!record) return undefined;
      const checkedAt = new Date().toISOString();
      const marketplaceAgentId = `erc8004-bsc-${record.agentId}`;
      const serviceReadiness = await verifyLiveServiceReadiness(record, marketplaceAgentId, checkedAt);
      const agent = mapLiveRecord(record, checkedAt, serviceReadiness);
      directAgentCache.set(agentId, { agent, expiresAt: Date.now() + DIRECT_AGENT_CACHE_MS });
      return agent;
    })
    .catch(() => undefined)
    .finally(() => {
      pendingDirectAgentLookups.delete(agentId);
    });

  pendingDirectAgentLookups.set(agentId, lookup);
  return lookup;
}
