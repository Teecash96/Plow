import type { Metadata } from "next";
import { AgentsBrowser } from "./agents-browser";
import { getMarketplaceRegistry } from "@/lib/marketplace/registry";

export const metadata: Metadata = {
  title: "Browse agents | BNB Agent Studio",
  description: "Compare live BSC agents by category, freshness, availability, and price.",
};

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const registry = await getMarketplaceRegistry();
  return <AgentsBrowser agents={registry.agents} liveAgentsCount={registry.liveAgents.length} liveStatus={registry.liveStatus} scan={registry.scan} />;
}
