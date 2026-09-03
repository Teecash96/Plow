import { NextRequest, NextResponse } from "next/server";
import { AGENT_CATEGORIES, type AgentCategory } from "@/lib/marketplace/types";
import { buildProviderTelemetrySnapshot } from "@/lib/marketplace/provider-strategies";
import { getProviderProfileForAgent, getProviderServiceConfig } from "@/lib/marketplace/provider-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest = new NextRequest("http://localhost/api/provider/telemetry")) {
  const config = getProviderServiceConfig();
  const requestedAgentId = request.nextUrl.searchParams.get("agentId")?.trim() || config.agentId;
  const requestedCategory = request.nextUrl.searchParams.get("category")?.trim() as AgentCategory | undefined;
  const profile = requestedAgentId ? getProviderProfileForAgent(requestedAgentId, config) : undefined;

  if (!requestedCategory || !AGENT_CATEGORIES.includes(requestedCategory)) {
    return NextResponse.json(
      { error: "Provide one supported category: rebalancing, grid-trading, yield-optimisation, or health-factor-monitoring." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!config.ready || !profile) {
    return NextResponse.json(
      { error: !config.ready ? config.reason : "The requested provider identity is not configured." },
      { status: !config.ready ? 503 : 404, headers: NO_STORE_HEADERS },
    );
  }

  const telemetry = await buildProviderTelemetrySnapshot(requestedCategory, { supportedCategories: profile.supportedCategories });
  return NextResponse.json(
    {
      agentId: profile.agentId,
      listingMode: config.profileMode ? "independent" : "shared",
      telemetry,
    },
    { headers: NO_STORE_HEADERS },
  );
}
