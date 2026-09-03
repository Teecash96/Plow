import { createHmac, timingSafeEqual } from "node:crypto";
import type { Address, Hex } from "viem";
import { ERC8004_AGENT_REGISTRY } from "@/lib/chain/erc8004-contract";
import { AGENT_EXECUTION_PROTOCOL, sameDecimal } from "./service-readiness";
import { getCategoryDefinition } from "./categories";
import { BSC_ERC8183_PAYMENT_CURRENCY } from "./payment-currency";
import { PROVIDER_EXECUTION_PATH, PROVIDER_HEALTH_PATH, PROVIDER_METADATA_PATH } from "./provider-paths";
import { buildStaticProviderExecutionResult } from "./provider-strategies";
import { AGENT_CATEGORIES, type AgentCategory } from "./types";

export { AGENT_EXECUTION_PROTOCOL };
export { PROVIDER_EXECUTION_PATH, PROVIDER_HEALTH_PATH, PROVIDER_METADATA_PATH } from "./provider-paths";

const MAX_AGENT_ID_LENGTH = 128;
const MAX_JOB_ID_LENGTH = 256;
const MAX_TASK_LENGTH = 4_000;
const MAX_CATEGORY_LENGTH = 128;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_PROFILE_CONFIG_BYTES = 64 * 1024;
const MAX_PROVIDER_PROFILES = 16;
const MAX_PROFILE_NAME_LENGTH = 160;
const MAX_PROFILE_DESCRIPTION_LENGTH = 2_000;
const REQUEST_TIMESTAMP_SKEW_MS = 5 * 60 * 1_000;

const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRICE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const CURRENCY_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const PRIVATE_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export interface ProviderProfileConfig {
  agentId: string;
  price: string;
  currency: string;
  name: string;
  description: string;
  supportedCategories: readonly AgentCategory[];
  /** Optional profile-specific public endpoints. Defaults are scoped below. */
  executionUrl?: string;
  healthUrl?: string;
  /** Server-only signer material. Never include a provider config in a response. */
  privateKey?: string;
}

export interface ProviderServiceConfig {
  enabled: boolean;
  ready: boolean;
  profileMode: boolean;
  profiles: readonly ProviderProfileConfig[];
  agentId?: string;
  price?: string;
  currency?: string;
  requestSecret?: string;
  publicBaseUrl?: string;
  executionUrl?: string;
  healthUrl?: string;
  name: string;
  description: string;
  supportedCategories: readonly AgentCategory[];
  missing: readonly string[];
  reason: string;
}

interface ProviderPayment {
  status: "paid";
  amount: string;
  currency: string;
  transactionHash: string;
}

export interface ProviderExecutionJob {
  id: string;
  agentId: string;
  agentIdentityId: string;
  marketplaceAgentId: string;
  status: "active";
  taskSummary: string;
  category: string;
  clientAddress: Address;
  onchainNetwork: "BSC Mainnet" | "BSC Testnet";
  onchainChainId: 56 | 97;
  termsHash: string;
  price: string;
  currency: string;
  onchainJobId: string;
  payment: ProviderPayment;
}

export interface ProviderExecutionRequest {
  protocol: typeof AGENT_EXECUTION_PROTOCOL;
  job: ProviderExecutionJob;
}

export interface ProviderExecutionResponse {
  status: "completed";
  resultSummary: string;
  deliverableHash?: Hex;
  submissionTransactionHash?: Hex;
}

export interface ProviderRequestVerification {
  valid: boolean;
  reason?: string;
}

export class ProviderServiceRequestError extends Error {
  readonly status: 400 | 409 | 413;

  constructor(message: string, status: 400 | 409 | 413 = 400) {
    super(message);
    this.name = "ProviderServiceRequestError";
    this.status = status;
  }
}

export async function readProviderRequestBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        throw new ProviderServiceRequestError("The provider request is too large.", 413);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function validAgentId(value: string | undefined) {
  return value && value.length <= MAX_AGENT_ID_LENGTH && AGENT_ID_PATTERN.test(value) ? value : undefined;
}

function validPrice(value: string | undefined) {
  if (!value || !PRICE_PATTERN.test(value)) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? value : undefined;
}

function validCurrency(value: string | undefined) {
  const upper = value?.toUpperCase();
  return upper && CURRENCY_PATTERN.test(upper) ? upper : undefined;
}

function publicUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !hostname) return undefined;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return undefined;
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function endpointFromBase(baseUrl: string | undefined, path: string) {
  return baseUrl ? `${baseUrl}${path}` : undefined;
}

function normalisedEndpoint(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function configuredCategories() {
  const configured = envValue("PLOW_PROVIDER_SUPPORTED_CATEGORIES");
  if (!configured) return AGENT_CATEGORIES;

  const categories = [...new Set(configured.split(",").map((value) => value.trim()).filter((value): value is AgentCategory => AGENT_CATEGORIES.includes(value as AgentCategory)))];
  return categories.length > 0 ? categories : AGENT_CATEGORIES;
}

function configuredProfileCategories(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  if (values.length === 0 || values.some((entry) => typeof entry !== "string")) return undefined;
  const normalised = values.map((entry) => entry.trim());
  if (normalised.some((entry) => !AGENT_CATEGORIES.includes(entry as AgentCategory))) return undefined;
  const categories = [...new Set(normalised)] as AgentCategory[];
  return categories.length > 0 ? categories : undefined;
}

function configuredProfileText(value: unknown, fallback: string, maxLength: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
}

function configuredProfileUrl(value: unknown) {
  if (value === undefined) return { value: undefined, invalid: false };
  if (typeof value !== "string" || !value.trim()) return { value: undefined, invalid: true };
  const url = publicUrl(value.trim());
  return { value: url, invalid: !url };
}

interface ConfiguredProfilesResult {
  profileMode: boolean;
  profiles: readonly ProviderProfileConfig[];
  error?: string;
}

function configuredProfiles(defaults: {
  agentId?: string;
  price?: string;
  currency?: string;
  name: string;
  description: string;
  supportedCategories: readonly AgentCategory[];
  privateKey?: string;
}): ConfiguredProfilesResult {
  const rawProfiles = envValue("PLOW_PROVIDER_PROFILES");
  if (!rawProfiles) {
    if (!defaults.agentId || !defaults.price || !defaults.currency) {
      return { profileMode: false, profiles: [] };
    }
    return {
      profileMode: false,
      profiles: [{
        agentId: defaults.agentId,
        price: defaults.price,
        currency: defaults.currency,
        name: defaults.name,
        description: defaults.description,
        supportedCategories: defaults.supportedCategories,
        privateKey: defaults.privateKey,
      }],
    };
  }
  if (rawProfiles.length > MAX_PROFILE_CONFIG_BYTES) {
    return { profileMode: true, profiles: [], error: "PLOW_PROVIDER_PROFILES (configuration is too large)" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawProfiles) as unknown;
  } catch {
    return { profileMode: true, profiles: [], error: "PLOW_PROVIDER_PROFILES (must be a JSON array)" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_PROVIDER_PROFILES) {
    return { profileMode: true, profiles: [], error: "PLOW_PROVIDER_PROFILES (use one to sixteen profiles)" };
  }

  const profiles: ProviderProfileConfig[] = [];
  for (const [index, value] of parsed.entries()) {
    if (!isRecord(value)) {
      return { profileMode: true, profiles: [], error: `PLOW_PROVIDER_PROFILES (profile ${index + 1} is invalid)` };
    }
    const agentId = validAgentId(typeof value.agentId === "string" ? value.agentId.trim() : undefined);
    const rawPrice = value.price === undefined
      ? defaults.price
      : typeof value.price === "string"
        ? value.price.trim()
        : undefined;
    const rawCurrency = value.currency === undefined
      ? defaults.currency
      : typeof value.currency === "string"
        ? value.currency.trim()
        : undefined;
    const price = validPrice(rawPrice);
    const currency = validCurrency(rawCurrency);
    const categoryValue = value.categories ?? value.supportedCategories ?? value.category;
    const supportedCategories = configuredProfileCategories(categoryValue);
    const name = configuredProfileText(value.name, defaults.name, MAX_PROFILE_NAME_LENGTH);
    const description = configuredProfileText(value.description, defaults.description, MAX_PROFILE_DESCRIPTION_LENGTH);
    const executionUrl = configuredProfileUrl(value.executionUrl);
    const healthUrl = configuredProfileUrl(value.healthUrl);
    const privateKey = value.privateKey === undefined
      ? undefined
      : typeof value.privateKey === "string" && value.privateKey.trim()
        ? value.privateKey.trim()
        : undefined;

    if (
      !agentId
      || !price
      || !currency
      || !supportedCategories
      || !name
      || !description
      || executionUrl.invalid
      || healthUrl.invalid
      || (privateKey !== undefined && !PRIVATE_KEY_PATTERN.test(privateKey))
    ) {
      return { profileMode: true, profiles: [], error: `PLOW_PROVIDER_PROFILES (profile ${index + 1} is invalid)` };
    }
    if (profiles.some((profile) => profile.agentId === agentId)) {
      return { profileMode: true, profiles: [], error: "PLOW_PROVIDER_PROFILES (agent IDs must be unique)" };
    }
    profiles.push({
      agentId,
      price,
      currency,
      name,
      description,
      supportedCategories,
      ...(executionUrl.value ? { executionUrl: executionUrl.value } : {}),
      ...(healthUrl.value ? { healthUrl: healthUrl.value } : {}),
      privateKey,
    });
  }

  return { profileMode: true, profiles };
}

export function getProviderServiceConfig(): ProviderServiceConfig {
  const enabled = process.env.PLOW_PROVIDER_ENABLED?.trim().toLowerCase() === "true";
  const agentId = validAgentId(envValue("PLOW_PROVIDER_AGENT_ID"));
  const price = validPrice(envValue("PLOW_PROVIDER_PRICE"));
  const currency = validCurrency(envValue("PLOW_PROVIDER_CURRENCY") ?? BSC_ERC8183_PAYMENT_CURRENCY);
  const requestSecret = envValue("PLOW_PROVIDER_REQUEST_SECRET");
  const publicBaseUrl = publicUrl(envValue("PLOW_PROVIDER_PUBLIC_URL"));
  const configuredExecutionUrl = publicUrl(envValue("PLOW_PROVIDER_EXECUTION_URL"));
  const executionUrl = configuredExecutionUrl ?? endpointFromBase(publicBaseUrl, PROVIDER_EXECUTION_PATH);
  const healthUrl = endpointFromBase(publicBaseUrl, PROVIDER_HEALTH_PATH);
  const supportedCategories = configuredCategories();
  const name = envValue("PLOW_PROVIDER_NAME") ?? "Plow Test Provider";
  const description = envValue("PLOW_PROVIDER_DESCRIPTION") ?? "A controlled Plow provider with four read only BSC strategy services.";
  const profileResult = configuredProfiles({
    agentId,
    price,
    currency,
    name,
    description,
    supportedCategories,
    privateKey: envValue("PLOW_PROVIDER_PRIVATE_KEY"),
  });
  const primaryProfile = profileResult.profiles[0];
  const missing = [
    profileResult.error,
    !profileResult.profileMode && !agentId ? "PLOW_PROVIDER_AGENT_ID" : undefined,
    !profileResult.profileMode && !price ? "PLOW_PROVIDER_PRICE" : undefined,
    !profileResult.profileMode && !currency ? "PLOW_PROVIDER_CURRENCY" : undefined,
    !requestSecret || requestSecret.length < 32 ? "PLOW_PROVIDER_REQUEST_SECRET (minimum 32 characters)" : undefined,
  ].filter((value): value is string => Boolean(value));
  const ready = enabled && missing.length === 0;
  const reason = !enabled
    ? "The provider service is disabled. Set PLOW_PROVIDER_ENABLED=true to enable it."
    : missing.length > 0
      ? `The provider service is not fully configured. Add ${missing.join(", ")}.`
      : "The provider service is ready.";

  return {
    enabled,
    ready,
    profileMode: profileResult.profileMode,
    profiles: profileResult.profiles,
    agentId: primaryProfile?.agentId,
    price: primaryProfile?.price,
    currency: primaryProfile?.currency,
    requestSecret,
    publicBaseUrl,
    executionUrl,
    healthUrl,
    name: primaryProfile?.name ?? name,
    description: primaryProfile?.description ?? description,
    supportedCategories: primaryProfile?.supportedCategories ?? supportedCategories,
    missing,
    reason,
  };
}

export function getProviderProfileForAgent(agentId: string, config = getProviderServiceConfig()) {
  return config.profiles.find((profile) => profile.agentId === agentId);
}

function scopedProfileEndpoint(endpoint: string | undefined, profile: ProviderProfileConfig, config: ProviderServiceConfig) {
  if (!endpoint) return undefined;
  if (!config.profileMode) return endpoint;
  try {
    const url = new URL(endpoint);
    url.searchParams.set("agentId", profile.agentId);
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function getProviderProfileExecutionUrl(config: ProviderServiceConfig, profile: ProviderProfileConfig) {
  return profile.executionUrl ?? scopedProfileEndpoint(config.executionUrl, profile, config);
}

export function getProviderProfileHealthUrl(config: ProviderServiceConfig, profile: ProviderProfileConfig) {
  return profile.healthUrl ?? scopedProfileEndpoint(config.healthUrl, profile, config);
}

export function getProviderProfileMetadataUrl(config: ProviderServiceConfig, profile: ProviderProfileConfig) {
  return scopedProfileEndpoint(endpointFromBase(config.publicBaseUrl, PROVIDER_METADATA_PATH), profile, config);
}

export function providerEndpointMatches(value: string, config = getProviderServiceConfig(), agentId?: string) {
  const candidate = normalisedEndpoint(value);
  if (!candidate) return false;
  const profile = agentId ? getProviderProfileForAgent(agentId, config) : undefined;
  const expected = profile ? getProviderProfileExecutionUrl(config, profile) : config.executionUrl;
  if (expected && candidate === normalisedEndpoint(expected)) return true;

  // Accept metadata published before profile-scoped endpoints were added. This
  // keeps a rolling deployment safe while still requiring the selected profile
  // when a profile-specific endpoint is configured.
  return Boolean(profile && !profile.executionUrl && config.executionUrl && candidate === normalisedEndpoint(config.executionUrl));
}

export function createProviderRequestSignature(body: string, timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function signedProviderRequestHeaders(body: string, secret: string, now = Date.now()) {
  const timestamp = String(now);
  return {
    "x-plow-request-timestamp": timestamp,
    "x-plow-request-signature": createProviderRequestSignature(body, timestamp, secret),
  };
}

function timestampMilliseconds(value: string) {
  if (!/^\d{10,13}$/.test(value)) return undefined;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return undefined;
  return value.length === 10 ? numeric * 1_000 : numeric;
}

export function verifyProviderRequest(
  body: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
): ProviderRequestVerification {
  const timestamp = headers.get("x-plow-request-timestamp")?.trim();
  const signature = headers.get("x-plow-request-signature")?.trim().toLowerCase();
  if (!timestamp || !signature) return { valid: false, reason: "The provider request signature is missing." };

  const timestampMs = timestampMilliseconds(timestamp);
  if (timestampMs === undefined || Math.abs(now - timestampMs) > REQUEST_TIMESTAMP_SKEW_MS) {
    return { valid: false, reason: "The provider request signature has expired." };
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) return { valid: false, reason: "The provider request signature is invalid." };

  const expected = createProviderRequestSignature(body, timestamp, secret);
  const expectedBytes = Buffer.from(expected, "hex");
  const receivedBytes = Buffer.from(signature, "hex");
  if (expectedBytes.length !== receivedBytes.length || !timingSafeEqual(expectedBytes, receivedBytes)) {
    return { valid: false, reason: "The provider request signature is invalid." };
  }
  return { valid: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new ProviderServiceRequestError(`The provider request field ${field} is invalid.`);
  }
  return value.trim();
}

function requiredJobId(value: unknown, field: string) {
  const result = requiredString(value, field, MAX_JOB_ID_LENGTH);
  if (!JOB_ID_PATTERN.test(result)) throw new ProviderServiceRequestError(`The provider request field ${field} is invalid.`);
  return result;
}

function requiredTransactionHash(value: unknown) {
  const result = requiredString(value, "job.payment.transactionHash", 66);
  if (!HASH_PATTERN.test(result)) throw new ProviderServiceRequestError("The paid job transaction hash is invalid.");
  return result;
}

function requiredAddress(value: unknown, field: string) {
  const result = requiredString(value, field, 42);
  if (!/^0x[a-fA-F0-9]{40}$/.test(result)) {
    throw new ProviderServiceRequestError(`The provider request field ${field} is invalid.`);
  }
  return result as Address;
}

function requiredChainId(value: unknown) {
  if (value !== 56 && value !== 97) throw new ProviderServiceRequestError("The provider request chain ID is invalid.");
  return value as 56 | 97;
}

export function parseProviderExecutionRequest(body: string, config = getProviderServiceConfig()): ProviderExecutionRequest {
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    throw new ProviderServiceRequestError("The provider request is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new ProviderServiceRequestError("The provider request must be valid JSON.");
  }
  if (!isRecord(parsed) || parsed.protocol !== AGENT_EXECUTION_PROTOCOL || !isRecord(parsed.job)) {
    throw new ProviderServiceRequestError("The provider request must use the plow-agent-execution-v1 contract.");
  }

  const rawJob = parsed.job;
  const agentId = requiredString(rawJob.agentId, "job.agentId", MAX_AGENT_ID_LENGTH);
  const agentIdentityId = requiredString(rawJob.agentIdentityId, "job.agentIdentityId", MAX_AGENT_ID_LENGTH);
  const marketplaceAgentId = requiredString(rawJob.marketplaceAgentId, "job.marketplaceAgentId", MAX_JOB_ID_LENGTH);
  const id = requiredJobId(rawJob.id, "job.id");
  const status = requiredString(rawJob.status, "job.status", 32);
  const taskSummary = requiredString(rawJob.taskSummary, "job.taskSummary", MAX_TASK_LENGTH);
  const category = requiredString(rawJob.category, "job.category", MAX_CATEGORY_LENGTH);
  const clientAddress = requiredAddress(rawJob.clientAddress, "job.clientAddress");
  const onchainNetwork = requiredString(rawJob.onchainNetwork, "job.onchainNetwork", 32) as "BSC Mainnet" | "BSC Testnet";
  const onchainChainId = requiredChainId(rawJob.onchainChainId);
  const termsHash = requiredString(rawJob.termsHash, "job.termsHash", 128);
  const price = requiredString(rawJob.price, "job.price", 64);
  const currency = requiredString(rawJob.currency, "job.currency", 32).toUpperCase();
  const onchainJobId = requiredString(rawJob.onchainJobId, "job.onchainJobId", 128);
  const payment = rawJob.payment;

  const profile = getProviderProfileForAgent(agentId, config);
  if (!profile || agentIdentityId !== profile.agentId) {
    throw new ProviderServiceRequestError("The provider request is for a different agent.", 409);
  }
  if (!(["BSC Mainnet", "BSC Testnet"] as const).includes(onchainNetwork)) {
    throw new ProviderServiceRequestError("The provider request network is invalid.");
  }
  if ((onchainNetwork === "BSC Mainnet" ? 56 : 97) !== onchainChainId) {
    throw new ProviderServiceRequestError("The provider request network and chain ID do not match.");
  }
  if (status !== "active") throw new ProviderServiceRequestError("Only active jobs can be executed.", 409);
  if (!/^[0-9]+$/.test(onchainJobId)) throw new ProviderServiceRequestError("The on chain job ID is invalid.");
  if (!sameDecimal(price, profile.price) || currency !== profile.currency) {
    throw new ProviderServiceRequestError("The job price does not match the provider price.", 409);
  }
  if (!AGENT_CATEGORIES.includes(category as AgentCategory) || !profile.supportedCategories.includes(category as AgentCategory)) {
    throw new ProviderServiceRequestError("The provider does not support this job category.", 409);
  }
  if (!isRecord(payment) || payment.status !== "paid") {
    throw new ProviderServiceRequestError("The provider accepts paid jobs only.", 409);
  }

  const paymentAmount = requiredString(payment.amount, "job.payment.amount", 64);
  const paymentCurrency = requiredString(payment.currency, "job.payment.currency", 32).toUpperCase();
  if (!sameDecimal(paymentAmount, price) || paymentCurrency !== currency) {
    throw new ProviderServiceRequestError("The payment does not match the job price.", 409);
  }

  const result: ProviderExecutionRequest = {
    protocol: AGENT_EXECUTION_PROTOCOL,
    job: {
      id,
      agentId,
      agentIdentityId,
      marketplaceAgentId,
      status: "active",
      taskSummary,
      category,
      clientAddress,
      onchainNetwork,
      onchainChainId,
      termsHash,
      price,
      currency,
      onchainJobId,
      payment: {
        status: "paid",
        amount: paymentAmount,
        currency: paymentCurrency,
        transactionHash: requiredTransactionHash(payment.transactionHash),
      },
    },
  };
  return result;
}

export function validateProviderExecutionHeaders(headers: Headers, request: ProviderExecutionRequest) {
  const agentId = headers.get("x-plow-agent-id")?.trim();
  const jobId = headers.get("x-plow-job-id")?.trim();
  if (agentId !== request.job.agentId || jobId !== request.job.id) {
    throw new ProviderServiceRequestError("The provider request headers do not match the job.", 409);
  }
}

function safeTaskSummary(value: string) {
  return value.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

export function buildProviderExecutionResult(request: ProviderExecutionRequest): ProviderExecutionResponse {
  return buildStaticProviderExecutionResult({
    ...request,
    job: {
      ...request.job,
      taskSummary: safeTaskSummary(request.job.taskSummary),
    },
  });
}

export function buildProviderRegistrationMetadata(
  config = getProviderServiceConfig(),
  profile = config.profiles[0],
) {
  if (!config.ready || !config.publicBaseUrl || !profile) return undefined;
  const executionEndpoint = getProviderProfileExecutionUrl(config, profile)
    ?? endpointFromBase(config.publicBaseUrl, PROVIDER_EXECUTION_PATH);
  const healthEndpoint = getProviderProfileHealthUrl(config, profile)
    ?? endpointFromBase(config.publicBaseUrl, PROVIDER_HEALTH_PATH);
  if (!executionEndpoint || !healthEndpoint) return undefined;

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    schemaVersion: "plow-agent-registration-v1",
    agentId: profile.agentId,
    name: profile.name,
    description: profile.description,
    registrations: [
      {
        agentRegistry: ERC8004_AGENT_REGISTRY,
        agentId: profile.agentId,
      },
    ],
    services: [
      {
        name: "Plow execution",
        protocol: AGENT_EXECUTION_PROTOCOL,
        endpoint: executionEndpoint,
      },
    ],
    plow: {
      profile: {
        mode: config.profileMode ? "independent" : "shared",
        agentId: profile.agentId,
        category: profile.supportedCategories.length === 1 ? profile.supportedCategories[0] : undefined,
      },
      health: { endpoint: healthEndpoint },
      x402: {
        supported: true,
        amount: profile.price,
        currency: profile.currency,
        unit: "per task",
      },
      strategyProtocol: "plow-provider-strategies-v1",
      supportedCategories: profile.supportedCategories,
      strategies: profile.supportedCategories.map((category) => ({
        id: category,
        name: getCategoryDefinition(category)?.label ?? category,
        mode: "read-only analysis",
        dataSource: "BSC Mainnet RPC",
      })),
    },
  };
}

export { MAX_REQUEST_BYTES as PROVIDER_MAX_REQUEST_BYTES };
