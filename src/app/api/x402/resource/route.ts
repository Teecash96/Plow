import { NextRequest, NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import {
  createBscPublicClient,
  ERC8183_STATUS,
  getERC8183Config,
  parseERC20Amount,
  readPaymentToken,
} from "@/lib/chain/erc8183-adapter";
import { PERMIT2_ADDRESS } from "@x402/evm";
import {
  buildPaymentRequirements,
  getX402ResourceStatus,
  settleFromPaymentHeader,
} from "@/lib/payments/x402-resource";
import { assertPermissionAllows, PermissionPolicyError } from "@/lib/marketplace/permission-policy";
import {
  getStoredJob,
  isJobPersistenceConfigured,
  JobPersistenceError,
  settleStoredJobPayment,
} from "@/lib/marketplace/job-database";
import { JobExecutionVerificationError, verifyStoredJobForLifecycle } from "@/lib/marketplace/job-execution-verification";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";
import { sameDecimal } from "@/lib/marketplace/service-readiness";
import { isAgentHireable, type Job, type SessionPermission } from "@/lib/marketplace/types";

export const dynamic = "force-dynamic";

const OWNER_COOKIE = "plow_job_owner";

function resourceUrlFrom(request: NextRequest, jobId: string, agentId: string) {
  const url = new URL(`${request.nextUrl.protocol}//${request.nextUrl.host}${request.nextUrl.pathname}`);
  url.searchParams.set("jobId", jobId);
  url.searchParams.set("agentId", agentId);
  return url.toString();
}

function ownerTokenFromRequest(request: NextRequest) {
  const value = request.cookies.get(OWNER_COOKIE)?.value;
  if (!value || value.length > 256 || /\s/.test(value)) return undefined;
  return value;
}

type PaymentContext = {
  job: Job;
  ownerToken: string;
  permission: SessionPermission;
  recipient: Address;
  tokenDecimals: number;
  currency: string;
  amountAtomic: string;
};

type PaymentContextResult =
  | { context: PaymentContext }
  | { response: NextResponse };

async function loadPaymentContext(
  request: NextRequest,
  jobId: string,
  agentId: string,
): Promise<PaymentContextResult> {
  if (!isJobPersistenceConfigured()) {
    return {
      response: NextResponse.json(
        { error: "Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql." },
        { status: 503 },
      ),
    };
  }

  const ownerToken = ownerTokenFromRequest(request);
  if (!ownerToken) {
    return { response: NextResponse.json({ error: "Payment resource not found." }, { status: 404 }) };
  }

  let job: Job | undefined;
  try {
    job = await getStoredJob(jobId, ownerToken);
  } catch (error) {
    const message = error instanceof JobPersistenceError
      ? error.message
      : "Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.";
    return { response: NextResponse.json({ error: message }, { status: 503 }) };
  }

  if (!job || job.agentIdentityId !== agentId) {
    return { response: NextResponse.json({ error: "Payment resource not found." }, { status: 404 }) };
  }
  let agent: Awaited<ReturnType<typeof getMarketplaceAgentById>>;
  try {
    agent = await getMarketplaceAgentById(job.agentId);
  } catch {
    return { response: NextResponse.json({ error: "The agent registry could not be reached." }, { status: 503 }) };
  }
  if (!agent || agent.identity.agentId !== agentId || !isAgentHireable(agent) || !agent.identity.ownerAddress || !isAddress(agent.identity.ownerAddress)) {
    return { response: NextResponse.json({ error: "The selected agent is not eligible for payment." }, { status: 422 }) };
  }
  if (!sameDecimal(agent.pricing.amount, job.price) || agent.pricing.currency.toLowerCase() !== job.currency.toLowerCase()) {
    return { response: NextResponse.json({ error: "The job price does not match the agent's verified x402 price." }, { status: 409 }) };
  }
  if (!isAddress(job.clientAddress)) {
    return { response: NextResponse.json({ error: "The job client address is invalid." }, { status: 409 }) };
  }
  const payment = job.payment;
  if (payment?.status === "paid") {
    return { response: NextResponse.json({ error: "This job payment has already been settled." }, { status: 409 }) };
  }
  if (job.status !== "pending" || !job.onchainJobId || payment?.status !== "pending") {
    return { response: NextResponse.json({ error: "This job is not ready for x402 settlement." }, { status: 409 }) };
  }
  if (!job.permission) {
    return { response: NextResponse.json({ error: "This job has no active payment permission." }, { status: 409 }) };
  }

  const erc = getERC8183Config();
  if (!erc.paymentTokenAddress) {
    return { response: NextResponse.json({ error: "The payment token is not configured." }, { status: 503 }) };
  }

  try {
    const verified = await verifyStoredJobForLifecycle(job, agent);
    if (verified.onchainJob.status !== ERC8183_STATUS.open) {
      return { response: NextResponse.json({ error: "The on chain job is not open for x402 settlement." }, { status: 409 }) };
    }
  } catch (error) {
    const message = error instanceof JobExecutionVerificationError
      ? error.message
      : "The on chain job could not be verified.";
    const responseStatus = error instanceof JobExecutionVerificationError && (error.code === "unavailable" || error.code === "not-configured") ? 503 : 409;
    return { response: NextResponse.json({ error: message }, { status: responseStatus }) };
  }

  let token: Awaited<ReturnType<typeof readPaymentToken>>;
  try {
    token = await readPaymentToken(createBscPublicClient(erc.rpcUrl), erc.paymentTokenAddress);
  } catch {
    return { response: NextResponse.json({ error: "The payment token could not be verified on the selected BSC network." }, { status: 503 }) };
  }
  if (payment.currency.toLowerCase() !== token.symbol.toLowerCase() || job.currency.toLowerCase() !== token.symbol.toLowerCase()) {
    return { response: NextResponse.json({ error: "The job payment currency does not match the configured payment token." }, { status: 409 }) };
  }

  let amountAtomic: bigint;
  try {
    amountAtomic = parseERC20Amount(payment.amount, token.decimals);
  } catch {
    return { response: NextResponse.json({ error: "The job payment amount is invalid." }, { status: 409 }) };
  }

  try {
    assertPermissionAllows({
      permission: job.permission,
      action: "x402-payment",
      contractAddress: PERMIT2_ADDRESS,
      tokenAddress: token.address,
      amountAtomic,
      tokenDecimals: token.decimals,
      currency: token.symbol,
      spentAmountAtomic: BigInt(0),
    });
  } catch (error) {
    const message = error instanceof PermissionPolicyError
      ? error.message
      : "The payment permission could not be verified.";
    return { response: NextResponse.json({ error: message }, { status: 409 }) };
  }

  return {
    context: {
      job,
      ownerToken,
      permission: job.permission,
      recipient: agent.identity.ownerAddress,
      tokenDecimals: token.decimals,
      currency: token.symbol,
      amountAtomic: amountAtomic.toString(),
    },
  };
}

type SettlementAttempt =
  | { settlement: { status: "paid" | "rejected"; transactionHash?: string; payer?: string; errorReason?: string } }
  | { response: NextResponse };

async function settleRequestPayment(input: {
  context: PaymentContext;
  paymentHeader: string | null;
  bindingSignature: string | null;
  expectedAmount: string;
  expectedAsset: Address;
  expectedRecipient: Address;
  jobId: string;
  agentId: string;
  resourceUrl: string;
}): Promise<SettlementAttempt> {
  let outcome: Awaited<ReturnType<typeof settleStoredJobPayment>>;
  try {
    outcome = await settleStoredJobPayment(input.jobId, input.context.ownerToken, async (job) => {
      if (job.agentIdentityId !== input.agentId || !job.permission || !isAddress(job.clientAddress)) {
        return { status: "rejected", errorReason: "The job binding could not be verified." };
      }
      return settleFromPaymentHeader({
        paymentHeader: input.paymentHeader,
        expectedAmount: input.expectedAmount,
        expectedAsset: input.expectedAsset,
        expectedRecipient: input.expectedRecipient,
        expectedPayer: job.clientAddress,
        bindingSignature: input.bindingSignature,
        jobId: input.jobId,
        agentId: input.agentId,
        resourceUrl: input.resourceUrl,
        permission: job.permission,
        tokenDecimals: input.context.tokenDecimals,
        currency: input.context.currency,
        spentAmountAtomic: BigInt(0),
      });
    });
  } catch (error) {
    const message = error instanceof JobPersistenceError
      ? error.message
      : "Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.";
    return { response: NextResponse.json({ error: message }, { status: 503 }) };
  }

  if (outcome.kind === "settled" || outcome.kind === "rejected") {
    return { settlement: outcome.settlement };
  }
  if (outcome.kind === "already-paid") {
    return { response: NextResponse.json({ error: "This job payment has already been settled." }, { status: 409 }) };
  }
  if (outcome.kind === "not-found") {
    return { response: NextResponse.json({ error: "Payment resource not found." }, { status: 404 }) };
  }
  return { response: NextResponse.json({ error: "This job is not ready for x402 settlement." }, { status: 409 }) };
}

export async function GET(request: NextRequest) {
  const status = getX402ResourceStatus();
  if (!status.enabled) {
    return NextResponse.json({ error: status.reason ?? "The x402 resource is not configured." }, { status: 503 });
  }
  const jobId = request.nextUrl.searchParams.get("jobId") ?? "";
  const agentId = request.nextUrl.searchParams.get("agentId") ?? "";
  if (!jobId || !agentId) {
    return NextResponse.json({ error: "The jobId and agentId query parameters are required." }, { status: 400 });
  }
  const erc = getERC8183Config();
  if (!erc.paymentTokenAddress) {
    return NextResponse.json({ error: "The payment token is not configured." }, { status: 503 });
  }
  const resourceUrl = resourceUrlFrom(request, jobId, agentId);
  const paymentContext = await loadPaymentContext(request, jobId, agentId);
  if ("response" in paymentContext) return paymentContext.response;
  const recipient = paymentContext.context.recipient;
  const paymentHeader = request.headers.get("X-PAYMENT") ?? request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("PAYMENT-SIGNATURE".toLowerCase());
  if (paymentHeader) {
    const settlementAttempt = await settleRequestPayment({
      context: paymentContext.context,
      paymentHeader,
      bindingSignature: request.headers.get("X-PLOW-X402-BINDING"),
      expectedAmount: paymentContext.context.amountAtomic,
      expectedAsset: erc.paymentTokenAddress,
      expectedRecipient: recipient,
      jobId,
      agentId,
      resourceUrl,
    });
    if ("response" in settlementAttempt) return settlementAttempt.response;
    const settlement = settlementAttempt.settlement;
    if (settlement.status !== "paid" || !settlement.transactionHash) {
      console.warn("[x402] settlement rejected", {
        jobId,
        agentId,
        reason: settlement.errorReason ?? "unknown",
      });
      return NextResponse.json(
        { error: settlement.errorReason ?? "The payment was not settled." },
        { status: 402 },
      );
    }
    const receipt = {
      success: true,
      transaction: settlement.transactionHash,
      network: erc.network,
      payer: settlement.payer,
      jobId,
      agentId,
      paymentRecorded: true,
    };
    return NextResponse.json(
      { result: receipt },
      { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64"), "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64") } },
    );
  }
  const requirements = buildPaymentRequirements({
    jobId,
    agentId,
    amount: paymentContext.context.amountAtomic,
    asset: erc.paymentTokenAddress,
    recipient,
    origin: resourceUrl,
  });
  const paymentRequired = {
    x402Version: 2,
    error: undefined,
    accepts: requirements,
    extensions: {},
    resource: {
      url: resourceUrl,
      description: `BNB Agent Studio hire for job ${jobId}`,
      mimeType: "application/json",
    },
  };
  return NextResponse.json(paymentRequired, {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
      "X-PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
    },
  });
}

export async function POST(request: NextRequest) {
  const status = getX402ResourceStatus();
  if (!status.enabled) {
    return NextResponse.json({ error: status.reason ?? "The x402 resource is not configured." }, { status: 503 });
  }
  const jobId = request.nextUrl.searchParams.get("jobId") ?? "";
  const agentId = request.nextUrl.searchParams.get("agentId") ?? "";
  if (!jobId || !agentId) {
    return NextResponse.json({ error: "The jobId and agentId query parameters are required." }, { status: 400 });
  }
  const erc = getERC8183Config();
  if (!erc.paymentTokenAddress) {
    return NextResponse.json({ error: "The payment token is not configured." }, { status: 503 });
  }
  const resourceUrl = resourceUrlFrom(request, jobId, agentId);
  const paymentContext = await loadPaymentContext(request, jobId, agentId);
  if ("response" in paymentContext) return paymentContext.response;
  const recipient = paymentContext.context.recipient;
  const paymentHeader = request.headers.get("X-PAYMENT") ?? request.headers.get("PAYMENT-SIGNATURE");
  const settlementAttempt = await settleRequestPayment({
    context: paymentContext.context,
    paymentHeader,
    bindingSignature: request.headers.get("X-PLOW-X402-BINDING"),
    expectedAmount: paymentContext.context.amountAtomic,
    expectedAsset: erc.paymentTokenAddress,
    expectedRecipient: recipient,
    jobId,
    agentId,
    resourceUrl,
  });
  if ("response" in settlementAttempt) return settlementAttempt.response;
  const settlement = settlementAttempt.settlement;
  if (settlement.status !== "paid" || !settlement.transactionHash) {
    console.warn("[x402] settlement rejected", {
      jobId,
      agentId,
      reason: settlement.errorReason ?? "unknown",
    });
    return NextResponse.json(
      { error: settlement.errorReason ?? "The payment was not settled." },
      { status: 402, headers: { "PAYMENT-REQUIRED": "" } },
    );
  }
  const receipt = {
    success: true,
    transaction: settlement.transactionHash,
    network: erc.network,
    payer: settlement.payer,
    jobId,
    agentId,
    paymentRecorded: true,
  };
  return NextResponse.json(
    { result: receipt },
    { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64") } },
  );
}

export function HEAD() {
  const status = getX402ResourceStatus();
  return new NextResponse(null, { status: status.enabled ? 200 : 503 });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, HEAD, OPTIONS",
      "X-Payment-Version": "x402",
    },
  });
}
