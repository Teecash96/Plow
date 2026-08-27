import { NextRequest, NextResponse } from "next/server";
import { getERC8183Config } from "@/lib/chain/erc8183-adapter";
import {
  buildPaymentRequirements,
  getX402ResourceStatus,
  settleFromPaymentHeader,
} from "@/lib/payments/x402-resource";

export const dynamic = "force-dynamic";

function resourceUrlFrom(request: NextRequest) {
  return `${request.nextUrl.protocol}//${request.nextUrl.host}${request.nextUrl.pathname}`;
}

export async function GET(request: NextRequest) {
  const status = getX402ResourceStatus();
  if (!status.enabled || !status.recipient) {
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
  const paymentHeader = request.headers.get("X-PAYMENT") ?? request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("PAYMENT-SIGNATURE".toLowerCase());
  if (paymentHeader) {
    const settlement = await settleFromPaymentHeader({
      paymentHeader,
      expectedAmount: status.amount ?? "0",
      expectedAsset: erc.paymentTokenAddress,
      expectedRecipient: status.recipient,
      jobId,
      agentId,
      resourceUrl: resourceUrlFrom(request),
    });
    if (settlement.status !== "paid" || !settlement.transactionHash) {
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
    };
    return NextResponse.json(
      { result: receipt },
      { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64"), "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64") } },
    );
  }
  const requirements = buildPaymentRequirements({
    jobId,
    agentId,
    amount: status.amount ?? "0",
    asset: erc.paymentTokenAddress,
    recipient: status.recipient,
    origin: resourceUrlFrom(request),
  });
  const paymentRequired = {
    x402Version: 2,
    error: undefined,
    accepts: requirements,
    extensions: {},
    resource: {
      url: resourceUrlFrom(request),
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
  if (!status.enabled || !status.recipient) {
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
  const paymentHeader = request.headers.get("X-PAYMENT") ?? request.headers.get("PAYMENT-SIGNATURE");
  const settlement = await settleFromPaymentHeader({
    paymentHeader,
    expectedAmount: status.amount ?? "0",
    expectedAsset: erc.paymentTokenAddress,
    expectedRecipient: status.recipient,
  });
  if (settlement.status !== "paid" || !settlement.transactionHash) {
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
