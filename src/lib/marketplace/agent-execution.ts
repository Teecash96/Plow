import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { Hex } from "viem";
import { assertPermissionAllows, PermissionPolicyError } from "./permission-policy";
import {
  getProviderServiceConfig,
  providerEndpointMatches,
  signedProviderRequestHeaders,
} from "./provider-service";
import type { Agent, Job } from "./types";

export const AGENT_EXECUTION_PROTOCOL = "plow-agent-execution-v1" as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SUMMARY_LENGTH = 4_000;
const MAX_RESULT_URI_LENGTH = 2_048;

export type AgentExecutionErrorCode =
  | "agent_unavailable"
  | "invalid_endpoint"
  | "request_failed"
  | "timeout"
  | "invalid_result"
  | "permission_denied";

export class AgentExecutionError extends Error {
  readonly code: AgentExecutionErrorCode;

  constructor(message: string, code: AgentExecutionErrorCode) {
    super(message);
    this.name = "AgentExecutionError";
    this.code = code;
  }
}

export interface AgentExecutionResult {
  resultSummary: string;
  resultUri?: string;
  deliverableHash?: Hex;
  submissionTransactionHash?: Hex;
}

export interface AgentExecutionOptions {
  fetchImpl?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface AgentServiceProbeOptions {
  fetchImpl?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface AgentServiceProbeResult {
  endpoint: string;
  status: number;
  body: string;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bytes32(value: unknown, label: string) {
  const parsed = nonEmptyString(value);
  if (!parsed) return undefined;
  if (!/^0x[a-fA-F0-9]{64}$/.test(parsed)) {
    throw new AgentExecutionError(`The agent ${label} must be a 32 byte hex value.`, "invalid_result");
  }
  return parsed as Hex;
}

function transactionHash(value: unknown) {
  const parsed = nonEmptyString(value);
  if (!parsed) return undefined;
  if (!/^0x[a-fA-F0-9]{64}$/.test(parsed)) {
    throw new AgentExecutionError("The agent submission transaction must be a 32 byte hex value.", "invalid_result");
  }
  return parsed as Hex;
}

function isPrivateIpv4(value: string) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function isPrivateIpv6(value: string) {
  const normalized = value.toLowerCase().split("%", 1)[0];
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return false;
}

function isPublicAddress(value: string) {
  const addressType = isIP(value);
  if (addressType === 4) return !isPrivateIpv4(value);
  if (addressType === 6) return !isPrivateIpv6(value);
  return false;
}

async function resolvePublicHostname(hostname: string) {
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch {
    throw new AgentExecutionError("The agent service hostname could not be resolved.", "invalid_endpoint");
  }
}

interface ResolvedAgentServiceUri {
  endpoint: string;
  address: string;
}

export function agentServiceUri(agent: Agent) {
  return nonEmptyString(agent.identity.serviceUri);
}

async function resolveValidatedAgentServiceUri(
  value: string,
  resolveHostname: (hostname: string) => Promise<readonly string[]> = resolvePublicHostname,
): Promise<ResolvedAgentServiceUri> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentExecutionError("The agent service URL is invalid.", "invalid_endpoint");
  }

  const hostname = url.hostname.toLowerCase();
  const lookupHostname = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (url.protocol !== "https:") {
    throw new AgentExecutionError("The agent service must use HTTPS.", "invalid_endpoint");
  }
  if (!lookupHostname || url.username || url.password || lookupHostname === "localhost" || lookupHostname.endsWith(".localhost") || lookupHostname.endsWith(".local") || lookupHostname.endsWith(".internal")) {
    throw new AgentExecutionError("The agent service must use a public service hostname.", "invalid_endpoint");
  }
  if (isIP(lookupHostname)) {
    throw new AgentExecutionError("The agent service must use a public service hostname.", "invalid_endpoint");
  }

  const addresses = await resolveHostname(lookupHostname);
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new AgentExecutionError("The agent service must resolve to a public service.", "invalid_endpoint");
  }

  return { endpoint: url.toString(), address: addresses[0] };
}

export async function validateAgentServiceUri(
  value: string,
  resolveHostname: (hostname: string) => Promise<readonly string[]> = resolvePublicHostname,
) {
  return (await resolveValidatedAgentServiceUri(value, resolveHostname)).endpoint;
}

export async function probeAgentService(value: string, options: AgentServiceProbeOptions = {}): Promise<AgentServiceProbeResult> {
  const endpoint = await resolveValidatedAgentServiceUri(value, options.resolveHostname);
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxResponseBytes = options.maxResponseBytes ?? 16 * 1024;
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new AgentExecutionError("The agent health check timed out.", "timeout"));
    }, timeoutMs);
  });

  try {
    const requestInit: RequestInit = {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      redirect: "error",
    };
    const request = options.fetchImpl
      ? options.fetchImpl(endpoint.endpoint, requestInit)
      : pinnedAgentFetch(endpoint, requestInit);
    const response = await Promise.race([request, timeout]).catch((error: unknown) => {
      if (error instanceof AgentExecutionError) throw error;
      if (timedOut) throw new AgentExecutionError("The agent health check timed out.", "timeout");
      throw new AgentExecutionError("The agent health check could not be reached.", "request_failed");
    });
    if (!response.ok) throw new AgentExecutionError(`The agent health check returned HTTP ${response.status}.`, "request_failed");
    return { endpoint: endpoint.endpoint, status: response.status, body: await readBoundedBody(response, maxResponseBytes) };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function executionPayload(job: Job, agent: Agent) {
  return {
    protocol: AGENT_EXECUTION_PROTOCOL,
    job: {
      id: job.id,
      agentId: agent.identity.agentId,
      marketplaceAgentId: job.agentId,
      agentIdentityId: job.agentIdentityId,
      status: job.status,
      agentName: job.agentName,
      taskSummary: job.taskSummary,
      category: job.category,
      price: job.price,
      currency: job.currency,
      clientAddress: job.clientAddress,
      terms: job.terms,
      onchainJobId: job.onchainJobId,
      onchainNetwork: job.onchainNetwork,
      onchainChainId: job.onchainChainId,
      termsHash: job.termsHash ?? job.terms.termsHash,
      permission: job.permission,
      payment: job.payment
        ? {
            status: job.payment.status,
            amount: job.payment.amount,
            currency: job.payment.currency,
            transactionHash: job.payment.transactionHash,
          }
        : undefined,
    },
  };
}

async function readBoundedBody(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AgentExecutionError("The agent result is too large.", "invalid_result");
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new AgentExecutionError("The agent result is too large.", "invalid_result");
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) throw new AgentExecutionError("The agent result is too large.", "invalid_result");
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function responseErrorMessage(response: Response) {
  const fallback = `The agent service returned HTTP ${response.status}.`;
  try {
    const body = await response.clone().json() as unknown;
    const message = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).error
      : undefined;
    return typeof message === "string" && message.trim()
      ? message.trim().slice(0, 500)
      : fallback;
  } catch {
    return fallback;
  }
}

function resultUri(value: unknown) {
  const uri = nonEmptyString(value);
  if (!uri) return undefined;
  if (uri.length > MAX_RESULT_URI_LENGTH) throw new AgentExecutionError("The agent result URI is too long.", "invalid_result");

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new AgentExecutionError("The agent result URI is invalid.", "invalid_result");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new AgentExecutionError("The agent result URI must use HTTPS.", "invalid_result");
  }
  return url.toString();
}

function pinnedAgentFetch(endpoint: ResolvedAgentServiceUri, init: RequestInit) {
  const url = new URL(endpoint.endpoint);
  const headers = new Headers(init.headers);

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest({
      hostname: endpoint.address,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: init.method ?? "GET",
      headers: {
        ...Object.fromEntries(headers.entries()),
        host: url.host,
      },
      servername: url.hostname.replace(/^\[|\]$/g, ""),
      family: isIP(endpoint.address) === 6 ? 6 : 4,
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (typeof value === "string") responseHeaders.set(name, value);
        else if (Array.isArray(value)) responseHeaders.set(name, value.join(", "));
      }

      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
        status: response.statusCode ?? 502,
        headers: responseHeaders,
      }));
    });

    const abort = () => request.destroy(new Error("The agent execution request was aborted."));
    request.once("error", reject);
    if (init.signal?.aborted) {
      abort();
      return;
    }
    init.signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => init.signal?.removeEventListener("abort", abort));

    if (typeof init.body === "string") request.write(init.body);
    request.end();
  });
}

export function parseAgentExecutionResult(body: string): AgentExecutionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new AgentExecutionError("The agent result was not valid JSON.", "invalid_result");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AgentExecutionError("The agent result must be a JSON object.", "invalid_result");
  }
  const record = parsed as Record<string, unknown>;
  if (record.status !== undefined && record.status !== "completed") {
    throw new AgentExecutionError("The agent did not return a completed result.", "invalid_result");
  }

  const summary = nonEmptyString(record.resultSummary);
  if (!summary) throw new AgentExecutionError("The agent resultSummary is missing.", "invalid_result");
  if (summary.length > MAX_SUMMARY_LENGTH) throw new AgentExecutionError("The agent resultSummary is too long.", "invalid_result");

  const result = typeof record.result === "object" && record.result !== null && !Array.isArray(record.result)
    ? record.result as Record<string, unknown>
    : undefined;
  const uri = resultUri(record.resultUri ?? result?.resultUri);
  const submission = typeof record.submission === "object" && record.submission !== null && !Array.isArray(record.submission)
    ? record.submission as Record<string, unknown>
    : undefined;
  const deliverableHash = bytes32(record.deliverableHash ?? submission?.deliverableHash, "deliverableHash");
  const submissionTransactionHash = transactionHash(record.submissionTransactionHash ?? submission?.transactionHash);
  if (Boolean(deliverableHash) !== Boolean(submissionTransactionHash)) {
    throw new AgentExecutionError("The agent submission must include both a deliverable hash and a submission transaction.", "invalid_result");
  }
  return {
    resultSummary: summary,
    ...(uri ? { resultUri: uri } : {}),
    ...(deliverableHash ? { deliverableHash } : {}),
    ...(submissionTransactionHash ? { submissionTransactionHash } : {}),
  };
}

export async function executeAgentJob(job: Job, agent: Agent, options: AgentExecutionOptions = {}) {
  try {
    assertPermissionAllows({ permission: job.permission, action: "agent-execution" });
  } catch (error) {
    if (error instanceof PermissionPolicyError) {
      throw new AgentExecutionError(error.message, "permission_denied");
    }
    throw error;
  }
  if (agent.mode !== "live" || !agent.verified || !agent.identity.ownerAddress) {
    throw new AgentExecutionError("Live agents only. This agent is not eligible for execution.", "agent_unavailable");
  }

  const serviceUri = agentServiceUri(agent);
  if (!serviceUri) throw new AgentExecutionError("The agent has no published service endpoint.", "agent_unavailable");
  const resolvedEndpoint = await resolveValidatedAgentServiceUri(serviceUri, options.resolveHostname);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const body = JSON.stringify(executionPayload(job, agent));
  const providerConfig = getProviderServiceConfig();
  const signedHeaders = providerConfig.ready && providerConfig.requestSecret && providerEndpointMatches(resolvedEndpoint.endpoint, providerConfig, agent.identity.agentId)
    ? signedProviderRequestHeaders(body, providerConfig.requestSecret)
    : {};

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new AgentExecutionError("The agent execution timed out.", "timeout"));
    }, timeoutMs);
  });

  try {
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-plow-agent-id": agent.identity.agentId,
        "x-plow-job-id": job.id,
        ...signedHeaders,
      },
      body,
      signal: controller.signal,
      redirect: "error",
    };
    const request = options.fetchImpl
      ? options.fetchImpl(resolvedEndpoint.endpoint, requestInit)
      : pinnedAgentFetch(resolvedEndpoint, requestInit);
    const response = await Promise.race([
      request,
      timeout,
    ]).catch((error: unknown) => {
      if (error instanceof AgentExecutionError) throw error;
      if (timedOut) throw new AgentExecutionError("The agent execution timed out.", "timeout");
      throw new AgentExecutionError("The agent service could not be reached.", "request_failed");
    });

    if (!response.ok) throw new AgentExecutionError(await responseErrorMessage(response), "request_failed");
    return parseAgentExecutionResult(await readBoundedBody(response, maxResponseBytes));
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
