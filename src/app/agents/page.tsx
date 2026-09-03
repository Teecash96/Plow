import type { Metadata } from "next";
import { AgentsBrowser } from "./agents-browser";
import { getMarketplaceRegistry } from "@/lib/marketplace/registry";
import { AGENT_CATEGORIES, type RegistryCategory } from "@/lib/marketplace/types";

export const metadata: Metadata = {
  title: "Browse agents | BNB Agent Studio",
  description: "Compare live BSC agents by category, freshness, availability, and price.",
};

export const dynamic = "force-dynamic";

interface AgentsPageProps {
  searchParams?: Promise<{ category?: string | string[] }>;
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const registry = await getMarketplaceRegistry();
  const params = await searchParams;
  const rawCategory = Array.isArray(params?.category) ? params.category[0] : params?.category;
  const initialCategory = rawCategory === "all" || rawCategory === "uncategorised" || AGENT_CATEGORIES.includes(rawCategory as (typeof AGENT_CATEGORIES)[number])
    ? rawCategory as RegistryCategory | "all"
    : undefined;
  return <AgentsBrowser agents={registry.agents} initialCategory={initialCategory} liveAgentsCount={registry.liveAgents.length} verifiedLiveAgentsCount={registry.verifiedLiveAgentsCount} liveStatus={registry.liveStatus} scan={registry.scan} />;
}
