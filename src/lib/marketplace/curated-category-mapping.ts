import type { ERC8004RegistrationMetadata } from "@/lib/chain/erc8004-adapter";
import type { AgentCategory, CategoryEvidence } from "./types";

interface CuratedInput {
  metadata?: ERC8004RegistrationMetadata;
  name?: string;
  description?: string;
  endpoints?: readonly string[];
  capabilities?: readonly string[];
  tags?: readonly string[];
}

interface CuratedRule {
  label: string;
  pattern: RegExp;
}

interface CuratedMapping {
  category: AgentCategory;
  reason: string;
  rules: readonly CuratedRule[];
}

const CURATED_LIVE_CATEGORY_MAPPINGS: Record<string, CuratedMapping> = {
  "269233": {
    category: "grid-trading",
    reason: "The published name and description explicitly identify a PancakeSwap grid trader with grid plans and price levels.",
    rules: [
      { label: "grid trader", pattern: /grid\s+trader/i },
      { label: "grid plans", pattern: /grid\s+plans?/i },
      { label: "price levels", pattern: /levels|price\s+walls?/i },
    ],
  },
  "269228": {
    category: "health-factor-monitoring",
    reason: "The published name and description explicitly identify health factor monitoring with liquidation prices.",
    rules: [
      { label: "health factor", pattern: /health\s+factor/i },
      { label: "liquidation prices", pattern: /liquidation\s+prices?/i },
    ],
  },
  "269226": {
    category: "yield-optimisation",
    reason: "The published name and description explicitly identify yield allocation with risk adjusted ranking and TVL caps.",
    rules: [
      { label: "yield allocation", pattern: /yield\s+allocation/i },
      { label: "risk adjusted ranking", pattern: /risk[- ]adjusted\s+ranking/i },
      { label: "TVL caps", pattern: /tvl\s+caps?/i },
    ],
  },
  "269224": {
    category: "grid-trading",
    reason: "The published name and description explicitly identify grid planning with symmetric buy and sell ladders.",
    rules: [
      { label: "grid planning", pattern: /grid\s+planning/i },
      { label: "buy and sell ladders", pattern: /buy\s+and\s+sell\s+ladders?/i },
      { label: "price walls", pattern: /price\s+walls?/i },
    ],
  },
  "269223": {
    category: "rebalancing",
    reason: "The published name and description explicitly identify portfolio rebalancing, drift measurement, and target weights.",
    rules: [
      { label: "portfolio rebalancing", pattern: /portfolio\s+rebalanc/i },
      { label: "drift measurement", pattern: /drift\s+measurement/i },
      { label: "target weights", pattern: /target\s+weights?/i },
    ],
  },
};

function flattenText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(flattenText);
  return [];
}

function inputFields(input: CuratedInput) {
  const fields: Array<{ name: string; value: string }> = [];
  const add = (name: string, values: readonly string[]) => values.forEach((value) => value.trim() && fields.push({ name, value }));
  add("name", [input.name ?? ""]);
  add("description", [input.description ?? ""]);
  add("endpoints", input.endpoints ?? []);
  add("capabilities", input.capabilities ?? []);
  add("tags", input.tags ?? []);
  if (input.metadata) add("metadata", flattenText(input.metadata));
  return fields;
}

export function curatedCategoryForLiveAgent(agentId: string, input: CuratedInput): {
  category: AgentCategory;
  source: "manual";
  evidence: CategoryEvidence;
} | undefined {
  const mapping = CURATED_LIVE_CATEGORY_MAPPINGS[agentId];
  if (!mapping) return undefined;

  const fields = inputFields(input);
  const matches = mapping.rules.flatMap((rule) => fields.filter((field) => rule.pattern.test(field.value)).map((field) => ({ rule, field })));
  const strongFields = new Set(matches.filter(({ field }) => field.name === "name" || field.name === "description").map(({ field }) => field.name));
  if (matches.length === 0 || strongFields.size === 0) return undefined;

  const matchedKeywords = [...new Set(matches.map(({ rule }) => rule.label))];
  const matchedFields = [...new Set(matches.map(({ field }) => field.name))];
  return {
    category: mapping.category,
    source: "manual",
    evidence: {
      matchedKeywords,
      matchedFields,
      score: matches.length * 10,
      confidence: "high",
      reason: `${mapping.reason} Matched ${matchedKeywords.join(", ")} in ${matchedFields.join(", ")}.`,
    },
  };
}
