import { NextRequest, NextResponse } from "next/server";
import { buildProviderRegistrationMetadata, getProviderProfileForAgent, getProviderServiceConfig } from "@/lib/marketplace/provider-service";
import { getProviderSignerStatus } from "@/lib/marketplace/provider-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest = new NextRequest("http://localhost/api/provider/metadata")) {
  const config = getProviderServiceConfig();
  const requestedAgentId = request.nextUrl.searchParams.get("agentId")?.trim() || config.agentId;
  const profile = requestedAgentId ? getProviderProfileForAgent(requestedAgentId, config) : undefined;
  const signer = getProviderSignerStatus(requestedAgentId);
  const metadata = profile ? buildProviderRegistrationMetadata(config, profile) : undefined;
  if (!metadata || !profile || !signer.configured) {
    const reason = !config.ready
      ? config.reason
      : !profile
        ? "The requested provider identity is not configured."
        : signer.reason;
    return NextResponse.json(
      { error: reason },
      { status: !config.ready || profile ? 503 : 404, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(metadata, { headers: NO_STORE_HEADERS });
}
