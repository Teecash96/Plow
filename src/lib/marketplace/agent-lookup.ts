interface MarketplaceAgentReference {
  id: string;
  slug: string;
}

export function extractERC8004AgentId(value: string) {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return normalized;
  const match = /^(?:erc8004|erc8004-bsc)-(\d+)$/i.exec(normalized);
  return match?.[1];
}

export async function findMarketplaceAgentById<T extends MarketplaceAgentReference>(
  agentId: string,
  agents: readonly T[],
  directLookup: (agentId: string) => Promise<T | undefined>,
) {
  const normalizedAgentId = agentId.trim();
  const listedAgent = agents.find((agent) => agent.id === normalizedAgentId || agent.slug === normalizedAgentId);
  if (listedAgent) return listedAgent;

  const erc8004AgentId = extractERC8004AgentId(normalizedAgentId);
  return erc8004AgentId ? directLookup(erc8004AgentId) : undefined;
}
