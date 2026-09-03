import type { Metadata } from "next";
import { HireWizard } from "./hire-wizard";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";
import type { AgentCategory } from "@/lib/marketplace/types";

interface HirePageProps {
  params: Promise<{ agentId: string }>;
  searchParams?: Promise<{ category?: string | string[] }>;
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

export default async function HirePage({ params, searchParams }: HirePageProps) {
  const { agentId } = await params;
  const agent = await getMarketplaceAgentById(agentId);
  const rawCategory = (await searchParams)?.category;
  const requestedCategory = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
  const supportedCategories = agent?.supportedCategories?.length
    ? agent.supportedCategories
    : agent && agent.category !== "uncategorised" ? [agent.category] : [];
  const initialCategory = supportedCategories.includes(requestedCategory as AgentCategory)
    ? requestedCategory as AgentCategory
    : undefined;
  return <HireWizard agent={agent} agentId={agentId} initialCategory={initialCategory} />;
}
