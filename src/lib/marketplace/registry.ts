import { CATEGORY_DEFINITIONS } from "./categories";
import { classifyAgentCategory } from "./category-classifier";
import { curatedCategoryForLiveAgent } from "./curated-category-mapping";
import { AGENTS as DEMO_AND_STATIC_AGENTS } from "./agents";
import { extractERC8004AgentId, findMarketplaceAgentById } from "./agent-lookup";
import { probeAgentService, validateAgentServiceUri } from "./agent-execution";
import { getLatestVerifiedAgentExecutionEvidence, type StoredAgentExecutionEvidence } from "./job-database";
import {
  getProviderProfileExecutionUrl,
  getProviderProfileForAgent,
  getProviderServiceConfig,
  getProviderServiceListingId,
  providerEndpointMatches,
  type ProviderProfileConfig,
} from "./provider-service";
import { getProviderSignerStatus } from "./provider-submission";
import { BSC_ERC8183_PAYMENT_CURRENCY } from "./payment-currency";
import { PROVIDER_AGENT_BRANDING } from "./agent-branding";
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
import type { Agent, AgentCategory, AgentServiceReadiness, Evidence, MetricValue, RegistryCategory } from "./types";

export type LiveRegistryStatus = ERC8004DiscoveryResult["status"] | "stale";

export interface MarketplaceRegistryResult {
  agents: readonly Agent[];
  liveAgents: readonly Agent[];
  demoAgents: readonly Agent[];
  verifiedLiveAgentsCount: number;
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
  verifiedExecutionEvidence?: StoredAgentExecutionEvidence,
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
    reputation: verifiedExecutionEvidence
      ? {
          completedJobs: verifiedExecutionEvidence.completedJobs,
          ...(verifiedExecutionEvidence.rating !== undefined ? { rating: verifiedExecutionEvidence.rating } : {}),
          reviewCount: verifiedExecutionEvidence.reviewCount,
          ...(verifiedExecutionEvidence.positivePercent !== undefined ? { positivePercent: verifiedExecutionEvidence.positivePercent } : {}),
          latestJobId: verifiedExecutionEvidence.jobId,
          capturedAt: verifiedExecutionEvidence.completedAt,
          source: "verified-execution" as const,
        }
      : {
          completedJobs: 0,
          reviewCount: 0,
          capturedAt: fetchedAt,
          source: "unavailable" as const,
        },
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

function serviceCategoryEvidence(category: AgentCategory) {
  const definition = CATEGORY_DEFINITIONS.find((candidate) => candidate.id === category);
  return {
    matchedKeywords: [category, definition?.label ?? category],
    matchedFields: ["plow.listings", "plow.strategies"],
    score: 1,
    confidence: "high" as const,
    reason: "This category is declared as a separate service listing by the provider registration metadata.",
  };
}

function reputationFromExecutionEvidence(executionEvidence: StoredAgentExecutionEvidence | undefined, capturedAt: string): Agent["reputation"] {
  return executionEvidence
    ? {
        completedJobs: executionEvidence.completedJobs,
        ...(executionEvidence.rating !== undefined ? { rating: executionEvidence.rating } : {}),
        reviewCount: executionEvidence.reviewCount,
        ...(executionEvidence.positivePercent !== undefined ? { positivePercent: executionEvidence.positivePercent } : {}),
        latestJobId: executionEvidence.jobId,
        capturedAt: executionEvidence.completedAt,
        source: "verified-execution" as const,
      }
    : {
        completedJobs: 0,
        reviewCount: 0,
        capturedAt,
        source: "unavailable" as const,
      };
}

function listingServiceReadiness(
  parent: Agent,
  profile: ProviderProfileConfig,
  executionEndpoint: string | undefined,
  executionEvidence: StoredAgentExecutionEvidence | undefined,
  config: ReturnType<typeof getProviderServiceConfig>,
) {
  const parentService = parent.hiring.service;
  if (!parentService) return undefined;
  const parentEndpoint = parent.identity.serviceUri;
  const endpointVerified = parentService.endpointVerified && (!executionEndpoint || !parentEndpoint || executionEndpoint === parentEndpoint);
  const providerSigner = getProviderSignerStatus(profile.agentId);
  const providerCanBootstrap = Boolean(
    config.ready
    && providerSigner.configured
    && providerSigner.address
    && parent.identity.ownerAddress
    && parent.identity.ownerAddress.toLowerCase() === providerSigner.address.toLowerCase(),
  );
  const pricing = {
    protocol: "x402" as const,
    amount: profile.price,
    currency: profile.currency,
    unit: "per task",
  };
  return assessAgentServiceReadiness({
    checkedAt: parentService.endpoint.checkedAt,
    now: new Date().toISOString(),
    endpoint: {
      url: executionEndpoint ?? parentEndpoint,
      verified: endpointVerified,
      detail: endpointVerified
        ? "The category service uses the provider endpoint verified from the ERC 8004 registration."
        : "The category service endpoint has not passed a matching provider check.",
    },
    x402Supported: parentService.pricingVerified,
    pricing,
    heartbeat: {
      verified: parentService.heartbeatVerified,
      heartbeatAt: parentService.heartbeatAt,
      detail: parentService.heartbeat.detail,
    },
    ...(executionEvidence ? {
      executionEvidence: {
        jobId: executionEvidence.jobId,
        completedAt: executionEvidence.completedAt,
        resultSummary: executionEvidence.resultSummary,
        ...(executionEvidence.submissionTransactionHash ? { submissionTransactionHash: executionEvidence.submissionTransactionHash } : {}),
      },
    } : {}),
    bootstrapEligible: parentService.bootstrapEligible === true || providerCanBootstrap,
    expectedPaymentCurrency: profile.currency,
  });
}

export async function buildProviderServiceListing(
  parent: Agent,
  profile: ProviderProfileConfig,
  category: AgentCategory,
  config = getProviderServiceConfig(),
): Promise<Agent> {
  const listingId = getProviderServiceListingId(profile.agentId, category);
  const checkedAt = new Date().toISOString();
  const executionEvidence = await getLatestVerifiedAgentExecutionEvidence(profile.agentId, listingId);
  const executionEndpoint = getProviderProfileExecutionUrl(config, profile) ?? parent.identity.serviceUri;
  const service = listingServiceReadiness(parent, profile, executionEndpoint, executionEvidence, config);
  const definition = CATEGORY_DEFINITIONS.find((candidate) => candidate.id === category);
  const identityVerified = parent.hiring.identityVerified && parent.verified;
  const evidence = parent.evidence.map((item) => ({
    ...item,
    id: `${listingId}-${item.id}`,
  }));
  evidence.push({
    id: `${listingId}-service-declaration`,
    kind: "execution" as const,
    label: "Category service declaration",
    status: parent.identity.metadataStatus === "verified" ? "verified" as const : "pending" as const,
    source: parent.identity.metadataStatus === "verified" ? "onchain" as const : "operator" as const,
    capturedAt: parent.identity.verifiedAt,
    detail: `${definition?.label ?? category} is published as listing ${listingId} under ERC 8004 identity ${profile.agentId}.`,
    ...(parent.identity.metadataUri ? { explorerUrl: parent.identity.metadataUri } : {}),
  });
  const deploymentAvailability = identityVerified
    ? service?.available
      ? "live" as const
      : service?.heartbeatAt
        ? "stale" as const
        : "offline" as const
    : "unverified" as const;
  const deployment = {
    ...parent.deployment,
    availability: deploymentAvailability,
    freshnessState: service?.heartbeatVerified ? "fresh" as const : service?.heartbeatAt ? "stale" as const : "unknown" as const,
    heartbeatAt: service?.heartbeatAt ?? "Not available",
    lastExecutionAt: executionEvidence?.completedAt ?? "Not available",
    freshnessSeconds: service?.heartbeatAt
      ? Math.max(0, Math.floor((Date.parse(checkedAt) - Date.parse(service.heartbeatAt)) / 1_000))
      : 0,
  };
  const identityEndpoints = [...new Set([
    ...(parent.identity.endpoints ?? []),
    ...(executionEndpoint ? [executionEndpoint] : []),
  ])];
  const branding = PROVIDER_AGENT_BRANDING[category];

  return {
    ...parent,
    id: listingId,
    slug: listingId,
    listingId,
    providerName: profile.name,
    parentAgentId: parent.id,
    avatar: branding.avatar,
    name: branding.name,
    tagline: branding.tagline,
    listingMode: config.profileMode ? "independent" as const : "shared" as const,
    category,
    supportedCategories: [category],
    categorySource: "metadata" as const,
    categoryEvidence: serviceCategoryEvidence(category),
    description: `${branding.description} This is a dedicated Plow service listing operated by ${profile.name} under ERC 8004 identity ${profile.agentId}. It accepts a paid ERC 8183 job and returns a bounded result from the published provider endpoint.`,
    identity: {
      ...parent.identity,
      serviceUri: executionEndpoint,
      endpoints: identityEndpoints,
    },
    deployment,
    pricing: {
      protocol: "x402",
      amount: profile.price,
      currency: profile.currency,
      unit: "per task",
    },
    categoryMetrics: metricSet(category, checkedAt),
    reputation: reputationFromExecutionEvidence(executionEvidence, checkedAt),
    evidence,
    hiring: {
      identityVerified,
      mainnetVerified: parent.hiring.mainnetVerified && identityVerified,
      freshnessVerified: service?.freshnessVerified ?? false,
      available: service?.available ?? false,
      ...(service ? { service } : {}),
      reason: identityVerified
        ? service?.reason
        : "This service listing is waiting for on chain ERC 8004 identity verification.",
    },
  };
}

function mergeAgents(liveAgents: readonly Agent[], demoAgents: readonly Agent[]) {
  const merged = new Map<string, Agent>();
  for (const agent of [...liveAgents, ...demoAgents]) {
    const listingKey = agent.listingId ?? agent.id;
    if (!merged.has(listingKey) || agent.mode === "live") merged.set(listingKey, agent);
  }
  return [...merged.values()];
}

async function loadConfiguredProviderAgents() {
  const config = getProviderServiceConfig();
  const profiles = config.profiles.filter((profile) => /^\d+$/.test(profile.agentId));
  const results = await Promise.all(profiles.map(async (profile) => {
    try {
      return { profile, agent: await getDirectMarketplaceAgentById(profile.agentId) };
    } catch {
      return { profile, agent: undefined };
    }
  }));
  const listings = await Promise.all(results.flatMap(({ profile, agent }) => agent
    ? profile.supportedCategories.map((category) => buildProviderServiceListing(agent, profile, category, config))
    : []));
  return {
    agents: listings,
    identityIds: profiles.map((profile) => profile.agentId),
  };
}

async function loadMarketplaceRegistry(): Promise<MarketplaceRegistryResult> {
  const [discovery, configuredProviderAgents] = await Promise.all([
    discoverERC8004Agents(),
    loadConfiguredProviderAgents(),
  ]);
  const configuredIdentityIds = new Set(configuredProviderAgents.identityIds);
  const discoveredLiveAgents = discovery.records
    .filter((record) => !configuredIdentityIds.has(record.agentId))
    .map((record) => mapLiveRecord(record, discovery.fetchedAt));
  const staticLiveAgents = DEMO_AND_STATIC_AGENTS.filter((agent) => agent.mode === "live");
  const liveAgents = [...configuredProviderAgents.agents, ...discoveredLiveAgents, ...staticLiveAgents];
  const demoAgents = DEMO_AND_STATIC_AGENTS.filter((agent) => agent.mode === "demo");
  const agents = mergeAgents(liveAgents, demoAgents);

  return {
    agents,
    liveAgents,
    demoAgents,
    verifiedLiveAgentsCount: liveAgents.filter((agent) => agent.verified).length,
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
      verifiedLiveAgentsCount: previous.verifiedLiveAgentsCount,
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
  const readiness = assessAgentServiceReadiness({
    checkedAt,
    endpoint: { url: metadata.executionEndpoint, verified: endpointVerified, detail: endpointDetail },
    x402Supported: metadata.x402Supported,
    pricing: metadata.pricing,
    heartbeat: { verified: heartbeatVerified, heartbeatAt, detail: heartbeatDetail },
    executionEvidence,
    bootstrapEligible,
    expectedPaymentCurrency: BSC_ERC8183_PAYMENT_CURRENCY,
  });
  return { readiness, executionEvidence };
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
      const verification = await verifyLiveServiceReadiness(record, marketplaceAgentId, checkedAt);
      const agent = mapLiveRecord(record, checkedAt, verification.readiness, verification.executionEvidence);
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
