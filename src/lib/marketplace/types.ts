export const AGENT_CATEGORIES = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor-monitoring",
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];
export type RegistryCategory = AgentCategory | "uncategorised";

export type AgentAvailability = "live" | "stale" | "offline" | "unverified";
export type AgentMode = "demo" | "live";
export type FreshnessState = "fresh" | "stale" | "unknown";

export type EvidenceKind =
  | "identity"
  | "performance"
  | "risk"
  | "execution"
  | "pancakeswap"
  | "benchmark"
  | "payment";

export type EvidenceStatus = "verified" | "pending" | "stale" | "unavailable";
export type PartnerDataStatus = "live" | "demo" | "pending" | "unavailable";

export interface CategoryDefinition {
  id: AgentCategory;
  label: string;
  description: string;
  plainLanguage: string;
  metricLabels: readonly string[];
}

export interface CategoryEvidence {
  matchedKeywords: readonly string[];
  matchedFields: readonly string[];
  score: number;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface AgentIdentity {
  standard: "ERC-8004";
  agentId: string;
  registryAddress: string;
  explorerUrl: string;
  verifiedAt: string;
  ownerAddress?: string;
  metadataUri?: string;
  serviceUri?: string;
  metadataStatus?: "verified" | "missing" | "malformed" | "unsupported" | "unavailable";
  endpoints?: readonly string[];
  capabilities?: readonly string[];
  tags?: readonly string[];
}

export interface AgentDeployment {
  network: "BSC Mainnet";
  chainId: 56;
  availability: AgentAvailability;
  freshnessState: FreshnessState;
  heartbeatAt: string;
  lastExecutionAt: string;
  freshnessSeconds: number;
  uptimePercent?: number;
}

export interface AgentPricing {
  protocol: "x402";
  amount: string;
  currency: string;
  unit: string;
}

export interface MetricValue {
  key: string;
  label: string;
  value?: string;
  unit?: string;
  sampleSize: number;
  capturedAt: string;
  source: "onchain" | "agent" | "benchmark" | "demo";
}

export interface PerformanceWindow {
  window: "7 day" | "30 day";
  value?: string;
  sampleSize: number;
  capturedAt: string;
  source: "onchain" | "agent" | "benchmark" | "demo";
}

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  label: string;
  status: EvidenceStatus;
  source: "onchain" | "indexer" | "agent" | "benchmark" | "operator" | "demo";
  capturedAt: string;
  sampleSize?: number;
  detail?: string;
  transactionHash?: string;
  explorerUrl?: string;
}

export interface AltanaPermissionTemplate {
  status: "not_configured" | "draft" | "active" | "revoked";
  templateId: string;
  spendCap: string;
  currency: string;
  allowlistedContracts: readonly string[];
  allowlistedTokens: readonly string[];
  expiresAt: string;
  revokeSupported: boolean;
  lastUpdatedAt: string;
  source: "operator" | "demo" | "job";
}

export interface TermiXAdvantageReport {
  reportId: string;
  status: PartnerDataStatus;
  taskDefinition: string;
  category: AgentCategory;
  human: {
    time: string;
    cost: string;
    outputQuality: string;
  };
  agent: {
    time: string;
    cost: string;
    outputQuality: string;
  };
  sampleSize: number;
  capturedAt: string;
  source: "termiX" | "demo" | "benchmark";
  reportUrl?: string;
  notes?: string;
}

export interface PancakeSwapEvidenceItem {
  status: PartnerDataStatus;
  value?: string;
  capturedAt: string;
  transactionHash?: string;
  explorerUrl?: string;
  note?: string;
}

export interface PancakeSwapEvidence {
  status: PartnerDataStatus;
  poolAddress: string;
  poolUrl?: string;
  pair: string;
  feeTier?: string;
  rangeUpdates: readonly PancakeSwapEvidenceItem[];
  feeCapture: PancakeSwapEvidenceItem;
  benefitStatement: string;
  source: "pancakeswap" | "demo" | "operator";
}

export interface AgentIntegrations {
  pancakeSwap?: {
    poolAddress: string;
    poolUrl: string;
    pair: string;
    lastRangeUpdateAt?: string;
    evidence?: PancakeSwapEvidence;
  };
  termiX?: {
    reportId: string;
    reportUrl: string;
    taskName: string;
    reports?: readonly TermiXAdvantageReport[];
  };
  altana?: {
    sessionKeySupported: boolean;
    permissionTemplateId: string;
    permissionTemplate?: AltanaPermissionTemplate;
  };
}

export interface AgentHiringReadiness {
  identityVerified: boolean;
  mainnetVerified: boolean;
  freshnessVerified: boolean;
  available: boolean;
  reason?: string;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  mode: AgentMode;
  verified: boolean;
  category: RegistryCategory;
  categorySource?: "metadata" | "manual" | "demo" | "uncategorised";
  categoryEvidence?: CategoryEvidence;
  description: string;
  identity: AgentIdentity;
  deployment: AgentDeployment;
  pricing: AgentPricing;
  performance: readonly PerformanceWindow[];
  categoryMetrics: readonly MetricValue[];
  riskBand?: "low" | "medium" | "high" | "unknown";
  maxDrawdown?: string;
  evidence: readonly Evidence[];
  integrations: AgentIntegrations;
  hiring: AgentHiringReadiness;
}

export type JobStatus =
  | "draft"
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobStatusChange {
  status: JobStatus;
  changedAt: string;
  note?: string;
}

export interface JobTerms {
  protocol: "ERC-8183";
  termsHash?: string;
  taskSummary: string;
  category: RegistryCategory;
  expiresAt: string;
}

export interface SessionPermission {
  provider: "Altana";
  spendCap: string;
  currency: string;
  allowlistedContracts: readonly string[];
  allowlistedTokens?: readonly string[];
  expiresAt: string;
  status?: "not_configured" | "draft" | "active" | "revoked";
  templateId?: string;
  revokeSupported?: boolean;
  lastUpdatedAt?: string;
  source?: "operator" | "demo" | "job";
  revokedAt?: string;
  revokeTransactionHash?: string;
}

export interface PaymentReceipt {
  protocol: "x402";
  status: "preview" | "pending" | "paid" | "unavailable";
  amount: string;
  currency: string;
  receiptId?: string;
  transactionHash?: string;
  paidAt?: string;
}

export interface Job {
  id: string;
  agentId: string;
  agentName?: string;
  category: RegistryCategory;
  clientAddress: string;
  taskSummary: string;
  status: JobStatus;
  price: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  terms: JobTerms;
  statusHistory: readonly JobStatusChange[];
  permission?: SessionPermission;
  payment?: PaymentReceipt;
  onchainJobId?: string;
  onchainNetwork?: "BSC Mainnet" | "BSC Testnet";
  onchainChainId?: 56 | 97;
  jobContractAddress?: string;
  termsHash?: string;
  resultUri?: string;
  resultSummary?: string;
}

export const AGENT_REQUIRED_FIELDS = [
  "id",
  "slug",
  "name",
  "tagline",
  "mode",
  "verified",
  "category",
  "description",
  "identity",
  "deployment",
  "pricing",
  "performance",
  "categoryMetrics",
  "evidence",
  "integrations",
  "hiring",
] as const satisfies readonly (keyof Agent)[];
