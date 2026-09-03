import type { Metadata } from "next";
import { AgentDetail } from "@/components/marketplace/agent-detail";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";
import { buildProviderTelemetrySnapshot } from "@/lib/marketplace/provider-strategies";
import { getProviderProfileForAgent, getProviderServiceConfig } from "@/lib/marketplace/provider-service";

interface AgentDetailPageProps {
  params: Promise<{ agentId: string }>;
}

export async function generateMetadata({ params }: AgentDetailPageProps): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getMarketplaceAgentById(agentId);

  return {
    title: agent ? `${agent.name} | BNB Agent Studio` : `Agent ${agentId} | BNB Agent Studio`,
    description: agent?.description ?? "Inspect an agent identity, deployment, freshness, metrics, and evidence.",
  };
}

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { agentId } = await params;
  const agent = await getMarketplaceAgentById(agentId);
  const providerProfile = agent ? getProviderProfileForAgent(agent.identity.agentId, getProviderServiceConfig()) : undefined;
  const telemetry = providerProfile
    ? await Promise.all(providerProfile.supportedCategories.map((category) => buildProviderTelemetrySnapshot(category, { supportedCategories: providerProfile.supportedCategories })))
    : undefined;
  return <AgentDetail agent={agent} agentId={agentId} telemetry={telemetry} />;
}
