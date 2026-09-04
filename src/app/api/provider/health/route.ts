import { NextRequest, NextResponse } from "next/server";
import { getCategoryDefinition } from "@/lib/marketplace/categories";
import { AGENT_CATEGORIES, type AgentCategory } from "@/lib/marketplace/types";
import { getProviderProfileExecutionUrl, getProviderProfileForAgent, getProviderProfileHealthUrl, getProviderServiceConfig, getProviderServiceListingId } from "@/lib/marketplace/provider-service";
import { getProviderSignerStatus } from "@/lib/marketplace/provider-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest = new NextRequest("http://localhost/api/provider/health")) {
  const config = getProviderServiceConfig();
  const requestedAgentId = request.nextUrl.searchParams.get("agentId")?.trim() || config.agentId;
  const requestedCategory = request.nextUrl.searchParams.get("category")?.trim();
  if (requestedCategory && !AGENT_CATEGORIES.includes(requestedCategory as AgentCategory)) {
    return NextResponse.json({ status: "unavailable", reason: "The requested provider category is invalid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
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

  const category = requestedCategory as AgentCategory | undefined;
  if (category && !profile.supportedCategories.includes(category)) {
    return NextResponse.json(
      { status: "unavailable", reason: "The requested provider category is not published by this identity." },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const executionEndpoint = getProviderProfileExecutionUrl(config, profile);
  const healthEndpoint = getProviderProfileHealthUrl(config, profile);

  return NextResponse.json(
    {
      status: "ok",
      agentId: profile.agentId,
      listingMode: config.profileMode ? "independent" : "shared",
      ...(executionEndpoint ? { executionEndpoint } : {}),
      ...(healthEndpoint ? { healthEndpoint } : {}),
      supportedCategories: profile.supportedCategories,
      strategyProtocol: "plow-provider-strategies-v1",
      heartbeatAt: new Date().toISOString(),
      ...(category ? {
        service: {
          listingId: getProviderServiceListingId(profile.agentId, category),
          name: getCategoryDefinition(category)?.label ?? category,
          category,
        },
      } : {}),
    },
    { headers: NO_STORE_HEADERS },
  );
}
