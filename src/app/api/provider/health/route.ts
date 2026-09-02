import { NextRequest, NextResponse } from "next/server";
import { getProviderProfileForAgent, getProviderServiceConfig } from "@/lib/marketplace/provider-service";
import { getProviderSignerStatus } from "@/lib/marketplace/provider-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest = new NextRequest("http://localhost/api/provider/health")) {
  const config = getProviderServiceConfig();
  const requestedAgentId = request.nextUrl.searchParams.get("agentId")?.trim() || config.agentId;
  const profile = requestedAgentId ? getProviderProfileForAgent(requestedAgentId, config) : undefined;
  const signer = getProviderSignerStatus(requestedAgentId);
  if (!config.ready || !profile || !signer.configured) {
    const reason = !config.ready
      ? config.reason
      : !profile
        ? "The requested provider identity is not configured."
        : signer.reason;
    return NextResponse.json(
      { status: "unavailable", reason },
      { status: !config.ready || profile ? 503 : 404, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      agentId: profile.agentId,
      supportedCategories: profile.supportedCategories,
      strategyProtocol: "plow-provider-strategies-v1",
      heartbeatAt: new Date().toISOString(),
    },
    { headers: NO_STORE_HEADERS },
  );
}
