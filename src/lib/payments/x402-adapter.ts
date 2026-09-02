import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme, PERMIT2_ADDRESS, toClientEvmSigner } from "@x402/evm";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { Address, PublicClient } from "viem";
import { isAddress } from "viem";
import { getERC8183Config, ensureERC20Allowance, type ConnectedBscWallet, type ERC8183Network } from "@/lib/chain/erc8183-adapter";
import { assertPermissionAllows } from "@/lib/marketplace/permission-policy";
import type { SessionPermission } from "@/lib/marketplace/types";
import { x402PaymentBindingMessage } from "@/lib/payments/x402-binding";

export interface X402Config {
  resourceUrl?: string;
  facilitatorUrl?: string;
  network: ERC8183Network;
  networkName: "BSC Mainnet" | "BSC Testnet";
  facilitatorConfigured: boolean;
  enabled: boolean;
  reason?: string;
}

export interface X402ExpectedPayment {
  jobId: string;
  agentId: string;
  amount: string;
  network: ERC8183Network;
  asset?: Address;
  recipient?: Address;
  resource?: string;
  knownReceiptIds?: readonly string[];
}

export interface X402ChallengeResult {
  status: "challenge" | "unavailable";
  paymentRequired?: PaymentRequired;
  reason?: string;
  resourceUrl?: string;
}

export interface X402VerificationResult {
  valid: boolean;
  requirement?: PaymentRequirements;
  challengeId?: string;
  reason?: string;
}

export interface X402SettlementResult {
  status: "paid" | "rejected";
  paymentPayload?: PaymentPayload;
  receiptId?: string;
  transactionHash?: string;
  serverRecorded?: boolean;
  reason?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

function readEnvValue(key: string) {
  switch (key) {
    case "NEXT_PUBLIC_X402_RESOURCE_URL": return process.env.NEXT_PUBLIC_X402_RESOURCE_URL;
    case "X402_RESOURCE_URL": return process.env.X402_RESOURCE_URL;
    case "NEXT_PUBLIC_X402_RESOURCE": return process.env.NEXT_PUBLIC_X402_RESOURCE;
    case "X402_RESOURCE": return process.env.X402_RESOURCE;
    case "NEXT_PUBLIC_X402_FACILITATOR_URL": return process.env.NEXT_PUBLIC_X402_FACILITATOR_URL;
    case "X402_FACILITATOR_URL": return process.env.X402_FACILITATOR_URL;
    case "NEXT_PUBLIC_X402_FACILITATOR": return process.env.NEXT_PUBLIC_X402_FACILITATOR;
    case "X402_FACILITATOR": return process.env.X402_FACILITATOR;
    default: return undefined;
  }
}

function readEnv(...keys: string[]) {
  for (const key of keys) {
    const value = readEnvValue(key)?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getX402Config(): X402Config {
  const ercConfig = getERC8183Config();
  const resourceUrl = readEnv(
    "NEXT_PUBLIC_X402_RESOURCE_URL",
    "X402_RESOURCE_URL",
    "NEXT_PUBLIC_X402_RESOURCE",
    "X402_RESOURCE",
  );
  const facilitatorUrl = readEnv(
    "NEXT_PUBLIC_X402_FACILITATOR_URL",
    "X402_FACILITATOR_URL",
    "NEXT_PUBLIC_X402_FACILITATOR",
    "X402_FACILITATOR",
  );
  const facilitatorConfigured = Boolean(facilitatorUrl);
  if (!ercConfig.networkConfigured) {
    return {
      resourceUrl,
      facilitatorUrl,
      network: ercConfig.network,
      networkName: ercConfig.networkName,
      facilitatorConfigured,
      enabled: false,
      reason: ercConfig.reason ?? "The BSC network is not configured.",
    };
  }
  if (!resourceUrl) {
    return {
      resourceUrl,
      facilitatorUrl,
      network: ercConfig.network,
      networkName: ercConfig.networkName,
      facilitatorConfigured,
      enabled: false,
      reason: "NEXT_PUBLIC_X402_RESOURCE_URL or NEXT_PUBLIC_X402_RESOURCE is not configured. No x402 challenge will be requested.",
    };
  }
  return {
    resourceUrl,
    facilitatorUrl,
    network: ercConfig.network,
    networkName: ercConfig.networkName,
    facilitatorConfigured,
    enabled: true,
  };
}

function decodeBase64Json(value: string): unknown {
  try {
    const decoded = typeof globalThis.atob === "function"
      ? globalThis.atob(value)
      : undefined;
    return decoded ? JSON.parse(decoded) as unknown : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function hasPaymentRequiredShape(value: unknown): value is PaymentRequired {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.x402Version === "number"
    && typeof record.resource === "object"
    && Array.isArray(record.accepts),
  );
}

function decodePaymentRequiredHeader(value: string | null) {
  if (!value) return undefined;
  const decoded = decodeBase64Json(value);
  return hasPaymentRequiredShape(decoded) ? decoded : undefined;
}

async function parseBody(response: Response) {
  try {
    const body = await response.clone().json() as unknown;
    return hasPaymentRequiredShape(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

export async function parseX402ChallengeResponse(response: Response): Promise<PaymentRequired | undefined> {
  const header = decodePaymentRequiredHeader(
    response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("X-PAYMENT-REQUIRED"),
  );
  if (header) return header;

  const body = await parseBody(response);
  if (body) return body;

  try {
    const httpClient = new x402HTTPClient(new x402Client());
    const fallback = httpClient.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      await response.clone().json().catch(() => undefined),
    );
    return fallback;
  } catch {
    return undefined;
  }
}

function resourceForJob(resourceUrl: string, expected: X402ExpectedPayment) {
  const url = new URL(resourceUrl, typeof window !== "undefined" && window.location.origin ? window.location.origin : "http://localhost:3000");
  url.searchParams.set("jobId", expected.jobId);
  url.searchParams.set("agentId", expected.agentId);
  return url.toString();
}

export async function requestX402Challenge(expected: X402ExpectedPayment): Promise<X402ChallengeResult> {
  const config = getX402Config();
  if (!config.resourceUrl) return { status: "unavailable", reason: config.reason };
  const resourceUrl = resourceForJob(config.resourceUrl, expected);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(resourceUrl, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "x-agent-job-id": expected.jobId,
        "x-agent-id": expected.agentId,
      },
      cache: "no-store",
    });
    if (response.status !== 402) {
      return {
        status: "unavailable",
        resourceUrl,
        reason: response.ok
          ? "The resource did not issue an x402 payment challenge."
          : `The x402 resource returned HTTP ${response.status}.`,
      };
    }
    const paymentRequired = await parseX402ChallengeResponse(response);
    if (!paymentRequired) return { status: "unavailable", resourceUrl, reason: "The x402 challenge was missing or malformed." };
    return { status: "challenge", paymentRequired, resourceUrl };
  } catch (error) {
    return {
      status: "unavailable",
      resourceUrl,
      reason: error instanceof Error ? error.message : "The x402 challenge request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function requirementValue(requirement: PaymentRequirements) {
  const candidate = requirement as PaymentRequirements & { maxAmountRequired?: string };
  const record = candidate as unknown as Record<string, unknown>;
  const value = record.value;
  return candidate.amount ?? candidate.maxAmountRequired ?? (typeof value === "string" ? value : undefined);
}

function requirementRecipient(requirement: PaymentRequirements) {
  const candidate = requirement as PaymentRequirements & { payTo?: string };
  return candidate.payTo;
}

function requirementResource(requirement: PaymentRequirements) {
  const candidate = requirement as PaymentRequirements & { resource?: string };
  return candidate.resource;
}

function requirementChallengeId(requirement: PaymentRequirements) {
  const record = requirement as PaymentRequirements & { nonce?: string; extra?: Record<string, unknown> };
  const extra = record.extra;
  const extraId = extra && ["nonce", "challengeId", "paymentId"].map((key) => extra[key]).find((value) => typeof value === "string");
  return record.nonce ?? (typeof extraId === "string" ? extraId : undefined);
}

export function verifyX402Challenge(
  paymentRequired: PaymentRequired,
  expected: X402ExpectedPayment,
): X402VerificationResult {
  const expectedResource = expected.resource;
  const matching = paymentRequired.accepts.find((requirement) => {
    if (requirement.network !== expected.network) return false;
    if (requirement.scheme !== "exact") return false;
    if (requirementValue(requirement) !== expected.amount) return false;
    if (expected.asset && requirement.asset.toLowerCase() !== expected.asset.toLowerCase()) return false;
    const recipient = requirementRecipient(requirement);
    if (!recipient || !isAddress(recipient)) return false;
    const isInternalResource = expectedResource === "/api/x402/resource" || Boolean(expectedResource?.startsWith("/api/x402"));
    if (!isInternalResource && expected.recipient && recipient.toLowerCase() !== expected.recipient.toLowerCase()) return false;
    const resource = requirementResource(requirement) ?? paymentRequired.resource?.url;
    if (!resource || !resource.includes(expected.jobId) || !resource.includes(expected.agentId)) return false;
    if (expectedResource) {
      const expectedPath = expectedResource.replace(/^https?:\/\/[^/]+/, "");
      if (!resource.includes(expectedPath) && !resource.startsWith(expectedResource)) return false;
    }
    const challengeId = requirementChallengeId(requirement);
    return !challengeId || !expected.knownReceiptIds?.includes(challengeId);
  });

  if (!matching) {
    return {
      valid: false,
      reason: "The x402 challenge did not match the job amount, agent, BSC network, asset, recipient, or resource.",
    };
  }
  const challengeId = requirementChallengeId(matching) ?? `${matching.asset.toLowerCase()}-${requirementsTime()}`;
  return { valid: true, requirement: matching, challengeId };

  function requirementsTime() {
    return Date.now().toString(36);
  }
}

function createX402Client(wallet: ConnectedBscWallet, publicClient: PublicClient) {
  const signer = toClientEvmSigner({
    address: wallet.account,
    signTypedData: async (message) => wallet.walletClient.signTypedData({
      account: wallet.account,
      domain: message.domain,
      types: message.types,
      primaryType: message.primaryType,
      message: message.message,
    }),
  }, {
    readContract: publicClient.readContract.bind(publicClient),
    getTransactionCount: async ({ address }) => Number(await publicClient.getTransactionCount({ address })),
    estimateFeesPerGas: () => publicClient.estimateFeesPerGas(),
  });
  const config = getERC8183Config();
  const scheme = new ExactEvmScheme(signer, {
    rpcUrl: config.rpcUrl,
  });
  return new x402Client().register(config.network, scheme);
}

export async function settleX402Payment(input: {
  wallet: ConnectedBscWallet;
  publicClient: PublicClient;
  paymentRequired: PaymentRequired;
  verification: X402VerificationResult;
  expected: X402ExpectedPayment;
  permission: SessionPermission;
  tokenDecimals: number;
  currency: string;
  spentAmountAtomic: bigint;
  approvalAmount?: bigint;
}): Promise<X402SettlementResult> {
  if (!input.verification.valid || !input.verification.requirement) {
    return { status: "rejected", reason: input.verification.reason ?? "The x402 challenge was not verified." };
  }
  try {
    // The $U token does not implement EIP-3009, so the challenge uses the
    // permit2 asset transfer method. Permit2 spends need a one-time ERC-20
    // approval from the buyer to the Permit2 contract before settling.
    const requirement = input.verification.requirement;
    const asset = requirement.asset;
    const permit2Amount = requirement.amount ? BigInt(requirement.amount) : undefined;
    if (!asset || !isAddress(asset) || !permit2Amount || requirement.extra?.assetTransferMethod !== "permit2") {
      return { status: "rejected", reason: "The x402 payment method is not supported by the permission policy." };
    }
    assertPermissionAllows({
      permission: input.permission,
      action: "x402-payment",
      contractAddress: PERMIT2_ADDRESS,
      tokenAddress: asset,
      amountAtomic: permit2Amount,
      tokenDecimals: input.tokenDecimals,
      currency: input.currency,
      spentAmountAtomic: input.spentAmountAtomic,
    });
    if (permit2Amount) {
      await ensureERC20Allowance({
        walletClient: input.wallet.walletClient,
        publicClient: input.publicClient,
        account: input.wallet.account,
        spender: PERMIT2_ADDRESS,
        amount: permit2Amount,
        approvalAmount: input.approvalAmount,
        tokenAddress: asset,
        permission: input.permission,
        tokenDecimals: input.tokenDecimals,
      });
    }
    const client = createX402Client(input.wallet, input.publicClient);
    const payload = await client.createPaymentPayload(input.paymentRequired);
    const httpClient = new x402HTTPClient(client);
    const headers = httpClient.encodePaymentSignatureHeader(payload);
    const config = getX402Config();
    if (!config.resourceUrl) return { status: "rejected", reason: config.reason };
    const resourceUrl = resourceForJob(config.resourceUrl, input.expected);
    const bindingSignature = await input.wallet.walletClient.signMessage({
      account: input.wallet.account,
      message: x402PaymentBindingMessage({
        jobId: input.expected.jobId,
        agentId: input.expected.agentId,
        resourceUrl,
        amount: requirement.amount,
        asset: requirement.asset,
        recipient: requirement.payTo,
        network: requirement.network,
      }),
    });
    const response = await fetch(resourceUrl, {
      headers: {
        ...headers,
        "X-PLOW-X402-BINDING": bindingSignature,
        accept: "application/json",
        "x-agent-job-id": input.expected.jobId,
        "x-agent-id": input.expected.agentId,
      },
    });
    if (!response.ok) {
      let reason = `The x402 payment was rejected with HTTP ${response.status}.`;
      try {
        const body = await response.clone().json() as unknown;
        const message = asRecord(body)?.error;
        if (typeof message === "string" && message.trim()) reason = message;
      } catch {
        // Keep the HTTP status when the resource does not return JSON.
      }
      return { status: "rejected", paymentPayload: payload, reason };
    }
    const responseId = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
    if (!responseId) {
      return { status: "rejected", paymentPayload: payload, reason: "The x402 resource did not return a payment receipt." };
    }
    let receiptId = responseId;
    let transactionHash: string | undefined;
    let serverRecorded = false;
    try {
      const decoded = decodePaymentResponseHeader(responseId) as Record<string, unknown>;
      const candidate = decoded.transaction ?? decoded.txHash ?? decoded.tx_hash ?? decoded.transactionHash;
      if (typeof candidate === "string" && /^0x[a-fA-F0-9]{64}$/.test(candidate)) transactionHash = candidate;
      const decodedReceipt = decoded.id ?? decoded.receiptId;
      if (typeof decodedReceipt === "string") receiptId = decodedReceipt;
      serverRecorded = decoded.paymentRecorded === true;
    } catch {
      return { status: "rejected", paymentPayload: payload, reason: "The x402 payment receipt was malformed." };
    }
    if (!transactionHash) {
      return { status: "rejected", paymentPayload: payload, reason: "The x402 payment receipt did not include a transaction hash." };
    }
    try {
      const chainReceipt = await input.publicClient.waitForTransactionReceipt({ hash: transactionHash as `0x${string}` });
      if (chainReceipt.status !== "success") {
        return { status: "rejected", paymentPayload: payload, reason: "The x402 transaction receipt was not successful." };
      }
    } catch {
      return { status: "rejected", paymentPayload: payload, reason: "The x402 transaction hash could not be confirmed on the selected BSC network." };
    }
    return { status: "paid", paymentPayload: payload, receiptId, transactionHash, serverRecorded };
  } catch (error) {
    return { status: "rejected", reason: error instanceof Error ? error.message : "The x402 payment failed." };
  }
}
