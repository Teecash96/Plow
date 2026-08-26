import { NextResponse } from "next/server";
import { getERC8183Config } from "@/lib/chain/erc8183-adapter";
import { getX402ResourceStatus } from "@/lib/payments/x402-resource";

export const dynamic = "force-dynamic";

export async function GET() {
  const erc = getERC8183Config();
  const x402 = getX402ResourceStatus();
  return NextResponse.json({
    erc: { enabled: erc.enabled, missing: erc.missing, reason: erc.reason, contractConfigured: erc.contractConfigured, networkConfigured: erc.networkConfigured },
    x402: { enabled: x402.enabled, reason: x402.reason, amount: x402.amount },
    raw: {
      NEXT_PUBLIC_HIRE_NETWORK: Boolean(process.env.NEXT_PUBLIC_HIRE_NETWORK),
      NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS: Boolean(process.env.NEXT_PUBLIC_ERC8183_CONTRACT_ADDRESS),
      NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS: Boolean(process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS),
      NEXT_PUBLIC_X402_RESOURCE_URL: process.env.NEXT_PUBLIC_X402_RESOURCE_URL ?? null,
      X402_PAYEE_ADDRESS: Boolean(process.env.X402_PAYEE_ADDRESS),
      X402_FACILITATOR_KEY: Boolean(process.env.X402_FACILITATOR_KEY),
    },
  });
}
