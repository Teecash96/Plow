import type { CategoryDefinition, RegistryCategory } from "./types";

export const CATEGORY_DEFINITIONS = [
  {
    id: "rebalancing",
    label: "Rebalancing",
    description: "Keep liquidity positions aligned as markets move.",
    plainLanguage: "LP range management",
    metricLabels: ["Range health", "Fee capture", "Rebalance activity"],
  },
  {
    id: "grid-trading",
    label: "Grid Trading",
    description: "Place structured orders across a defined price range.",
    plainLanguage: "Rules based trading",
    metricLabels: ["Realised PnL", "Fill rate", "Drawdown"],
  },
  {
    id: "yield-optimisation",
    label: "Yield Optimisation",
    description: "Compare yield routes with visible protocol and liquidity risk.",
    plainLanguage: "Yield route selection",
    metricLabels: ["Net APY", "Protocol risk", "Withdrawal liquidity"],
  },
  {
    id: "health-factor-monitoring",
    label: "Health Factor Monitoring",
    description: "Track lending positions before health factors become urgent.",
    plainLanguage: "Borrowing risk alerts",
    metricLabels: ["Current health", "Alert latency", "Response history"],
  },
] as const satisfies readonly CategoryDefinition[];

export function getCategoryDefinition(id: RegistryCategory) {
  if (id === "uncategorised") return undefined;
  return CATEGORY_DEFINITIONS.find((category) => category.id === id);
}
