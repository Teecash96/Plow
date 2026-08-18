import type { Metadata } from "next";
import { AgentDetail } from "@/components/marketplace/agent-detail";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";

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
  return <AgentDetail agent={await getMarketplaceAgentById(agentId)} agentId={agentId} />;
}
