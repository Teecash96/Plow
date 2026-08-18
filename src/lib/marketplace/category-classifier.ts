import type { ERC8004RegistrationMetadata } from "@/lib/chain/erc8004-adapter";
import type { AgentCategory, CategoryEvidence, RegistryCategory } from "./types";

interface ClassificationInput {
  metadata?: ERC8004RegistrationMetadata;
  name?: string;
  description?: string;
  endpoints?: readonly string[];
  capabilities?: readonly string[];
  tags?: readonly string[];
}

interface ClassificationField {
  name: string;
  value: string;
  weight: number;
}

interface CategoryRule {
  label: string;
  pattern: RegExp;
  weight: number;
}

interface CategoryScore {
  score: number;
  keywords: string[];
  fields: string[];
}

const CATEGORY_RULES: Record<AgentCategory, readonly CategoryRule[]> = {
  rebalancing: [
    { label: "portfolio rebalancing", pattern: /portfolio\s+rebalanc(?:e|ing|er)?/i, weight: 6 },
    { label: "rebalancing", pattern: /rebalanc(?:e|ing|er)?/i, weight: 5 },
    { label: "target weights", pattern: /target\s+(?:weights|allocation)/i, weight: 4 },
    { label: "allocation drift", pattern: /(?:allocation|weight)\s+drift|drift\s+(?:measurement|monitoring)/i, weight: 4 },
    { label: "LP range management", pattern: /(?:lp|liquidity|amm)\s+(?:range|position|management)|concentrated\s+liquidity/i, weight: 4 },
    { label: "range manager", pattern: /range\s+(?:manager|management|health|update)/i, weight: 4 },
    { label: "PancakeSwap V3", pattern: /pancakeswap\s+v?3/i, weight: 2 },
  ],
  "grid-trading": [
    { label: "grid trading", pattern: /grid\s+(?:trader|trading|strategy|planning)/i, weight: 6 },
    { label: "buy and sell ladders", pattern: /buy(?:ing)?\s+and\s+sell(?:ing)?\s+ladders?/i, weight: 6 },
    { label: "order grid", pattern: /order\s+(?:grid|ladder)/i, weight: 5 },
    { label: "price levels", pattern: /price\s+(?:levels?|walls?)/i, weight: 4 },
    { label: "market making", pattern: /market\s+mak(?:e|ing|er)|maker\s+strategy/i, weight: 4 },
    { label: "limit orders", pattern: /limit\s+orders?/i, weight: 3 },
  ],
  "yield-optimisation": [
    { label: "yield allocation", pattern: /yield\s+(?:allocator|allocation|optimizer|optimisation|optimization|route|strategy)/i, weight: 6 },
    { label: "risk adjusted yield", pattern: /risk[- ]adjusted\s+(?:yield|ranking)/i, weight: 5 },
    { label: "net APY or APR", pattern: /net\s+(?:apy|apr)|\b(?:apy|apr)\b/i, weight: 4 },
    { label: "vault or staking", pattern: /\b(?:vaults?|staking|liquidity\s+mining|farming)\b/i, weight: 4 },
    { label: "TVL or withdrawal liquidity", pattern: /(?:tvl\s+caps?|withdrawal\s+liquidity)/i, weight: 4 },
  ],
  "health-factor-monitoring": [
    { label: "health factor", pattern: /health\s+factor/i, weight: 7 },
    { label: "loan health monitoring", pattern: /loan\s+health|health\s+monitor(?:ing)?/i, weight: 6 },
    { label: "liquidation risk or price", pattern: /liquidation\s+(?:price|risk|alert)/i, weight: 5 },
    { label: "collateral or borrowing", pattern: /\b(?:collateral|borrow(?:ing)?|debt\s+ratio|drop\s+distance|alert\s+latency)\b/i, weight: 3 },
  ],
};

function flattenText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(flattenText);
  return [];
}

function collectFields(input: ClassificationInput): ClassificationField[] {
  const fields: ClassificationField[] = [];
  const add = (name: string, values: readonly string[], weight: number) => {
    for (const value of values) {
      const trimmed = value.trim();
      if (trimmed) fields.push({ name, value: trimmed, weight });
    }
  };

  add("name", [input.name ?? ""], 2.5);
  add("description", [input.description ?? ""], 1.5);
  add("tags", input.tags ?? [], 1);
  add("capabilities", input.capabilities ?? [], 0.8);
  add("endpoints", input.endpoints ?? [], 0.5);

  if (input.metadata) {
    const excluded = new Set(["name", "title", "description", "summary", "image"]);
    const metadataValues = Object.entries(input.metadata)
      .filter(([key]) => !excluded.has(key.toLowerCase()))
      .flatMap(([, value]) => flattenText(value));
    add("metadata", metadataValues, 0.5);
  }

  return fields;
}

function emptyEvidence(reason: string): CategoryEvidence {
  return {
    matchedKeywords: [],
    matchedFields: [],
    score: 0,
    confidence: "low",
    reason,
  };
}

export function classifyAgentCategory(input: ClassificationInput): {
  category: RegistryCategory;
  source: "metadata" | "uncategorised";
  evidence: CategoryEvidence;
} {
  const fields = collectFields(input);
  const scores = new Map<AgentCategory, CategoryScore>();

  for (const category of Object.keys(CATEGORY_RULES) as AgentCategory[]) {
    const categoryScore: CategoryScore = { score: 0, keywords: [], fields: [] };
    for (const field of fields) {
      for (const rule of CATEGORY_RULES[category]) {
        if (!rule.pattern.test(field.value)) continue;
        categoryScore.score += rule.weight * field.weight;
        categoryScore.keywords.push(rule.label);
        categoryScore.fields.push(field.name);
      }
    }
    scores.set(category, {
      score: categoryScore.score,
      keywords: [...new Set(categoryScore.keywords)],
      fields: [...new Set(categoryScore.fields)],
    });
  }

  const ranked = [...scores.entries()].sort((left, right) => right[1].score - left[1].score);
  const [winner, winnerScore] = ranked[0] ?? [];
  const runnerUpScore = ranked[1]?.[1].score ?? 0;
  const minimumScore = 5;
  const minimumMargin = 2;
  if (!winner || !winnerScore || winnerScore.score < minimumScore || winnerScore.score - runnerUpScore < minimumMargin) {
    return {
      category: "uncategorised",
      source: "uncategorised",
      evidence: emptyEvidence("No category received a strong and unambiguous metadata signal."),
    };
  }

  const confidence = winnerScore.score >= 10 && winnerScore.score - runnerUpScore >= 4 ? "high" : "medium";
  const fieldLabel = winnerScore.fields.join(", ");
  const keywordLabel = winnerScore.keywords.join(", ");
  return {
    category: winner,
    source: "metadata",
    evidence: {
      matchedKeywords: winnerScore.keywords,
      matchedFields: winnerScore.fields,
      score: Math.round(winnerScore.score * 10) / 10,
      confidence,
      reason: `Matched ${keywordLabel} in ${fieldLabel}.`,
    },
  };
}
