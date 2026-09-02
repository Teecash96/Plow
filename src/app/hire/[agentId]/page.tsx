import type { Metadata } from "next";
import { HireWizard } from "./hire-wizard";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";

interface HirePageProps {
  params: Promise<{ agentId: string }>;
}

export async function generateMetadata({ params }: HirePageProps): Promise<Metadata> {
  const { agentId } = await params;
  const agent = await getMarketplaceAgentById(agentId);

  return {
    title: agent ? `Hire ${agent.name} | BNB Agent Studio` : "Hire agent | BNB Agent Studio",
    description: "Start a verified agent task with one primary action and safe wallet checks.",
  };
}

export const dynamic = "force-dynamic";

export default async function HirePage({ params }: HirePageProps) {
  const { agentId } = await params;
  return <HireWizard agent={await getMarketplaceAgentById(agentId)} agentId={agentId} />;
}
