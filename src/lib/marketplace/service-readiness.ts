import { AGENT_CATEGORIES, type AgentCategory, type AgentPricing, type AgentReadinessCheck, type AgentServiceReadiness } from "./types";
import { normalisePaymentCurrency, paymentCurrencyMatches } from "./payment-currency";

export const AGENT_EXECUTION_PROTOCOL = "plow-agent-execution-v1" as const;
export const MAX_HEARTBEAT_AGE_SECONDS = 15 * 60;
export const MAX_EXECUTION_EVIDENCE_AGE_SECONDS = 30 * 24 * 60 * 60;

type JsonRecord = Record<string, unknown>;

export interface ParsedAgentServiceMetadata {
  executionEndpoint?: string;
  healthEndpoint?: string;
  x402Supported: boolean;
  pricing?: AgentPricing;
  declaredHeartbeatAt?: string;
  listingMode?: "shared" | "independent";
  supportedCategories?: readonly AgentCategory[];
}

export interface ServiceEndpointAssessment {
  url?: string;
  verified: boolean;
  detail?: string;
}

export interface HeartbeatAssessment {
  verified: boolean;
  heartbeatAt?: string;
  detail?: string;
}

export interface ExecutionEvidenceAssessment {
  jobId: string;
  completedAt: string;
  resultSummary: string;
  submissionTransactionHash?: string;
}

export interface AgentServiceReadinessInput {
  checkedAt: string;
  now?: string | number | Date;
  endpoint: ServiceEndpointAssessment;
  x402Supported: boolean;
  pricing?: AgentPricing;
  heartbeat: HeartbeatAssessment;
  executionEvidence?: ExecutionEvidenceAssessment;
  bootstrapEligible?: boolean;
  expectedPaymentCurrency?: string;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(record: JsonRecord | undefined, key: string) {
  return record ? record[key] : undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const parsed = nonEmptyString(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function timestamp(value: unknown) {
  const parsed = nonEmptyString(value);
  if (!parsed) return undefined;
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const parsed = asRecord(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function positiveDecimal(value: unknown) {
  const parsed = nonEmptyString(typeof value === "number" ? String(value) : value);
  if (!parsed || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(parsed)) return undefined;
  const numeric = Number(parsed);
  return Number.isFinite(numeric) && numeric > 0 ? parsed : undefined;
}

export function sameDecimal(left: string | undefined, right: string | undefined) {
  const normalise = (value: string | undefined) => {
    const parsed = nonEmptyString(value);
    if (!parsed || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(parsed)) return undefined;
    const [whole, fraction = ""] = parsed.split(".");
    const trimmedFraction = fraction.replace(/0+$/, "");
    return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  };
  const normalisedLeft = normalise(left);
  const normalisedRight = normalise(right);
  return Boolean(normalisedLeft && normalisedRight && normalisedLeft === normalisedRight);
}

function servicePrice(value: unknown): AgentPricing | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const amount = positiveDecimal(record.amount ?? record.price ?? record.value);
  const currency = firstString(record.currency, record.asset, record.token)?.toUpperCase();
  if (!amount || !currency || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(currency)) return undefined;
  return {
    protocol: "x402",
    amount,
    currency,
    unit: firstString(record.unit, record.unitOfWork, record.per) ?? "per task",
  };
}

function isExplicitExecutionService(value: unknown) {
  const record = asRecord(value);
  return record?.protocol === AGENT_EXECUTION_PROTOCOL && Boolean(firstString(record.endpoint, record.url, record.serviceUri));
}

function explicitExecutionEndpoint(metadata: JsonRecord, services: readonly unknown[]) {
  const plow = asRecord(metadata.plow);
  const execution = firstRecord(
    recordValue(plow, "execution"),
    metadata.execution,
  );
  const direct = firstString(execution?.endpoint, execution?.url, execution?.serviceUri);
  if (direct) return direct;

  const service = services.map(asRecord).find(isExplicitExecutionService);
  return service ? firstString(service.endpoint, service.url, service.serviceUri) : undefined;
}

function explicitHealthEndpoint(metadata: JsonRecord, services: readonly unknown[]) {
  const plow = asRecord(metadata.plow);
  const heartbeat = firstRecord(
    recordValue(plow, "heartbeat"),
    metadata.heartbeat,
  );
  const health = firstRecord(
    recordValue(plow, "health"),
    metadata.health,
  );
  const direct = firstString(
    health?.endpoint,
    health?.url,
    heartbeat?.endpoint,
    heartbeat?.url,
    metadata.healthEndpoint,
    metadata.heartbeatEndpoint,
  );
  if (direct) return direct;

  const service = services.map(asRecord).find((value) => {
    const name = firstString(value?.name, value?.type)?.toLowerCase();
    return Boolean(name && (name.includes("health") || name.includes("heartbeat")) && firstString(value?.endpoint, value?.url));
  });
  return service ? firstString(service.endpoint, service.url) : undefined;
}

function readX402Support(metadata: JsonRecord) {
  const x402 = asRecord(metadata.x402);
  const plow = asRecord(metadata.plow);
  const plowX402 = asRecord(plow?.x402);
  return metadata.x402Support === true
    || x402?.supported === true
    || x402?.enabled === true
    || plowX402?.supported === true
    || plowX402?.enabled === true;
}

function readPricing(metadata: JsonRecord) {
  const x402 = asRecord(metadata.x402);
  const plow = asRecord(metadata.plow);
  const plowX402 = asRecord(plow?.x402);
  return servicePrice(
    plowX402?.pricing
    ?? plowX402
    ?? plow?.pricing
    ?? x402?.pricing
    ?? x402
    ?? metadata.pricing,
  );
}

function readSupportedCategories(metadata: JsonRecord) {
  const plow = asRecord(metadata.plow);
  const direct = plow?.supportedCategories ?? metadata.supportedCategories;
  const directValues = Array.isArray(direct) ? direct : [];
  const strategyValues = Array.isArray(plow?.strategies)
    ? plow.strategies.map((value) => asRecord(value)?.id)
    : [];
  const categories = [...new Set([...directValues, ...strategyValues].filter(
    (value): value is AgentCategory => typeof value === "string" && AGENT_CATEGORIES.includes(value as AgentCategory),
  ))];
  return categories.length > 0 ? categories : undefined;
}

function readListingMode(metadata: JsonRecord) {
  const plow = asRecord(metadata.plow);
  const profile = asRecord(plow?.profile);
  const mode = firstString(profile?.mode, plow?.listingMode, metadata.listingMode);
  return mode === "shared" || mode === "independent" ? mode : undefined;
}

export function parseAgentServiceMetadata(metadata: JsonRecord | undefined): ParsedAgentServiceMetadata {
  if (!metadata) return { x402Supported: false };
  const services = Array.isArray(metadata.services) ? metadata.services : [];
  const plow = asRecord(metadata.plow);
  const heartbeat = firstRecord(plow?.heartbeat, metadata.heartbeat);
  const listingMode = readListingMode(metadata);
  return {
    executionEndpoint: explicitExecutionEndpoint(metadata, services),
    healthEndpoint: explicitHealthEndpoint(metadata, services),
    x402Supported: readX402Support(metadata),
    pricing: readPricing(metadata),
    ...(listingMode ? { listingMode } : {}),
    supportedCategories: readSupportedCategories(metadata),
    declaredHeartbeatAt: timestamp(
      heartbeat?.heartbeatAt
      ?? heartbeat?.timestamp
      ?? metadata.heartbeatAt
      ?? metadata.lastHeartbeatAt,
    ),
  };
}

export function parseAgentHeartbeatResponse(body: string, expectedAgentId?: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  const record = asRecord(parsed);
  if (!record) return undefined;
  const status = nonEmptyString(record.status)?.toLowerCase();
  if (status && ["offline", "unhealthy", "error", "failed"].includes(status)) return undefined;
  const responseAgentId = firstString(record.agentId, record.agent_id);
  if (expectedAgentId && responseAgentId && responseAgentId !== expectedAgentId) return undefined;
  return timestamp(
    record.heartbeatAt
    ?? record.lastHeartbeatAt
    ?? record.timestamp
    ?? record.updatedAt,
  );
}

export function isPublicHttpsUrlShape(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && Boolean(hostname)
      && hostname !== "localhost"
      && !hostname.endsWith(".localhost")
      && !hostname.endsWith(".local")
      && !hostname.endsWith(".internal");
  } catch {
    return false;
  }
}

function nowMilliseconds(value: string | number | Date | undefined, fallback: string) {
  const candidate = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value ?? fallback);
  return Number.isFinite(candidate) ? candidate : Date.parse(fallback);
}

function check(verified: boolean, detail: string, checkedAt: string): AgentReadinessCheck {
  return { verified, detail, checkedAt };
}

export function assessAgentServiceReadiness(input: AgentServiceReadinessInput): AgentServiceReadiness {
  const checkedAt = timestamp(input.checkedAt) ?? input.checkedAt;
  const now = nowMilliseconds(input.now, checkedAt);
  const endpointShapeValid = isPublicHttpsUrlShape(input.endpoint.url);
  const endpointVerified = endpointShapeValid && input.endpoint.verified;
  const parsedPricing = servicePrice(input.pricing);
  const expectedPaymentCurrency = normalisePaymentCurrency(input.expectedPaymentCurrency);
  const pricingCurrencyMatches = !expectedPaymentCurrency || paymentCurrencyMatches(parsedPricing?.currency, expectedPaymentCurrency);
  const pricingVerified = input.x402Supported && Boolean(parsedPricing) && pricingCurrencyMatches;
  const heartbeatAt = timestamp(input.heartbeat.heartbeatAt);
  const heartbeatAge = heartbeatAt ? (now - Date.parse(heartbeatAt)) / 1_000 : Number.POSITIVE_INFINITY;
  const heartbeatFresh = Number.isFinite(heartbeatAge)
    && heartbeatAge >= -60
    && heartbeatAge <= MAX_HEARTBEAT_AGE_SECONDS;
  const heartbeatVerified = input.heartbeat.verified && heartbeatFresh;
  const evidenceCompletedAt = timestamp(input.executionEvidence?.completedAt);
  const evidenceAge = evidenceCompletedAt ? (now - Date.parse(evidenceCompletedAt)) / 1_000 : Number.POSITIVE_INFINITY;
  const executionEvidenceVerified = Boolean(
    input.executionEvidence
    && nonEmptyString(input.executionEvidence.jobId)
    && nonEmptyString(input.executionEvidence.resultSummary)
    && evidenceCompletedAt
    && evidenceAge >= -60
    && evidenceAge <= MAX_EXECUTION_EVIDENCE_AGE_SECONDS,
  );
  const bootstrapEligible = Boolean(
    input.bootstrapEligible
    && !executionEvidenceVerified
    && endpointVerified
    && pricingVerified
    && heartbeatVerified,
  );
  const executionReady = executionEvidenceVerified || bootstrapEligible;

  const endpointDetail = endpointVerified
    ? input.endpoint.detail ?? "The Plow execution endpoint resolves to a public HTTPS service."
    : input.endpoint.detail ?? "A Plow execution endpoint must use HTTPS and resolve to a public service.";
  const pricingDetail = pricingVerified
    ? "The x402 price and currency are published in the agent service contract."
    : !input.x402Supported
      ? "The agent has not declared x402 support."
      : parsedPricing && expectedPaymentCurrency && !pricingCurrencyMatches
        ? `The provider x402 currency ${parsedPricing.currency} does not match the configured payment token ${expectedPaymentCurrency}.`
      : "A positive x402 amount, currency, and unit are required.";
  const heartbeatDetail = heartbeatVerified
    ? input.heartbeat.detail ?? "The provider health endpoint returned a fresh heartbeat."
    : input.heartbeat.detail ?? `The provider heartbeat must be no more than ${MAX_HEARTBEAT_AGE_SECONDS / 60} minutes old.`;
  const executionDetail = executionEvidenceVerified
    ? `A completed Plow execution is recorded for job ${input.executionEvidence?.jobId}.`
    : bootstrapEligible
      ? "This controlled provider is eligible for its first paid execution. The successful result will become execution evidence."
      : "A recent completed execution recorded by Plow is required.";
  const failures = [
    endpointVerified ? undefined : "The agent service endpoint is not verified.",
    pricingVerified ? undefined : "The agent x402 price is not verified.",
    heartbeatVerified ? undefined : "The agent heartbeat is missing or stale.",
    executionReady ? undefined : "The agent has no recent execution evidence.",
  ].filter((value): value is string => Boolean(value));
  const available = endpointVerified && pricingVerified && heartbeatVerified && executionReady;

  return {
    endpointVerified,
    pricingVerified,
    heartbeatVerified,
    executionEvidenceVerified,
    ...(bootstrapEligible ? { bootstrapEligible: true } : {}),
    freshnessVerified: heartbeatVerified && executionReady,
    available,
    endpoint: check(endpointVerified, endpointDetail, checkedAt),
    pricing: check(pricingVerified, pricingDetail, checkedAt),
    heartbeat: check(heartbeatVerified, heartbeatDetail, checkedAt),
    executionEvidence: check(executionEvidenceVerified, executionDetail, checkedAt),
    ...(input.heartbeat.verified && heartbeatAt ? { heartbeatAt } : {}),
    ...(executionEvidenceVerified && evidenceCompletedAt ? { lastExecutionAt: evidenceCompletedAt } : {}),
    reason: failures[0] ?? "All four agent service readiness checks passed.",
  };
}
