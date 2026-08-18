import type { Agent, AgentCategory, EvidenceKind } from "./types";

const DEMO_CAPTURE = "Demo fixture";

function demoPerformance() {
  return [
    { window: "7 day" as const, value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" as const },
    { window: "30 day" as const, value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" as const },
  ];
}

function demoEvidence(agentKey: string, entries: readonly [EvidenceKind, string][]) {
  return entries.map(([kind, label], index) => ({
    id: `demo-evidence-${agentKey}-${index + 1}`,
    kind,
    label,
    status: "unavailable" as const,
    source: "demo" as const,
    capturedAt: DEMO_CAPTURE,
    sampleSize: 0,
    detail: "Placeholder only. No live Mainnet evidence is attached.",
  }));
}

function demoReadiness() {
  return {
    identityVerified: false,
    mainnetVerified: false,
    freshnessVerified: false,
    available: false,
    reason: "Demo record. Live Mainnet verification is required.",
  };
}

function demoAltanaTemplate(): NonNullable<NonNullable<Agent["integrations"]["altana"]>["permissionTemplate"]> {
  return {
    status: "draft",
    templateId: "altana-demo-template",
    spendCap: "Demo only",
    currency: "USDC",
    allowlistedContracts: [],
    allowlistedTokens: [],
    expiresAt: DEMO_CAPTURE,
    revokeSupported: false,
    lastUpdatedAt: DEMO_CAPTURE,
    source: "demo",
  };
}

function demoTermiXReport(category: AgentCategory, taskDefinition: string) {
  return {
    reportId: `terminx-demo-${category}`,
    status: "demo" as const,
    taskDefinition,
    category,
    human: { time: "Demo only", cost: "Demo only", outputQuality: "Demo only" },
    agent: { time: "Demo only", cost: "Demo only", outputQuality: "Demo only" },
    sampleSize: 0,
    capturedAt: DEMO_CAPTURE,
    source: "demo" as const,
    notes: "Demo fixture only. No human or agent task was measured.",
  };
}

function demoPancakeEvidence(pair: string, benefitStatement: string) {
  return {
    status: "demo" as const,
    poolAddress: "Not connected",
    poolUrl: "",
    pair,
    feeTier: "Not connected",
    rangeUpdates: [{ status: "demo" as const, value: "Demo only", capturedAt: DEMO_CAPTURE, note: "No live range update is attached." }],
    feeCapture: { status: "demo" as const, value: "Demo only", capturedAt: DEMO_CAPTURE, note: "No live fee capture is attached." },
    benefitStatement,
    source: "demo" as const,
  };
}

function demoIntegrations(category: AgentCategory, pair: string, taskDefinition: string, benefitStatement?: string) {
  const integrations: Agent["integrations"] = {
    termiX: {
      reportId: `terminx-demo-${category}`,
      reportUrl: "",
      taskName: taskDefinition,
      reports: [demoTermiXReport(category, taskDefinition)],
    },
    altana: {
      sessionKeySupported: false,
      permissionTemplateId: "altana-demo-template",
      permissionTemplate: demoAltanaTemplate(),
    },
  };

  if (category === "rebalancing" || category === "yield-optimisation") {
    integrations.pancakeSwap = {
      poolAddress: "Not connected",
      poolUrl: "",
      pair,
      lastRangeUpdateAt: DEMO_CAPTURE,
      evidence: demoPancakeEvidence(
        pair,
        benefitStatement ?? "A future PancakeSwap feed will show how this agent can improve trader or LP decisions.",
      ),
    };
  }

  return integrations;
}

export const DEMO_AGENTS = [
  {
    id: "demo-rebalancer-001",
    slug: "range-steward-demo",
    name: "Range Steward Demo",
    tagline: "Demo LP range manager for PancakeSwap positions.",
    mode: "demo",
    verified: false,
    category: "rebalancing",
    description: "A clearly labeled demo record showing how a rebalancing agent will present range health, fee capture, and rebalance evidence.",
    identity: { standard: "ERC-8004", agentId: "demo-erc8004-rebalancing-001", registryAddress: "Demo registry placeholder", explorerUrl: "", verifiedAt: "Not verified" },
    deployment: { network: "BSC Mainnet", chainId: 56, availability: "unverified", freshnessState: "unknown", heartbeatAt: DEMO_CAPTURE, lastExecutionAt: DEMO_CAPTURE, freshnessSeconds: 0 },
    pricing: { protocol: "x402", amount: "Demo only", currency: "USDC", unit: "preview request" },
    performance: demoPerformance(),
    categoryMetrics: [
      { key: "range-health", label: "Range health", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "fee-capture", label: "Fee capture", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "rebalance-activity", label: "Rebalance activity", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
    ],
    riskBand: "unknown",
    evidence: demoEvidence("rebalancing", [["identity", "ERC 8004 identity"], ["execution", "Range update record"], ["pancakeswap", "PancakeSwap pool evidence"]]),
    integrations: demoIntegrations("rebalancing", "Demo pair", "Review LP range health and propose a bounded PancakeSwap range update.", "A future range monitor can help LPs keep liquidity closer to their target range.",),
    hiring: demoReadiness(),
  },
  {
    id: "demo-grid-trader-001",
    slug: "grid-pilot-demo",
    name: "Grid Pilot Demo",
    tagline: "Demo grid strategy record for structured BSC execution.",
    mode: "demo",
    verified: false,
    category: "grid-trading",
    description: "A clearly labeled demo record showing how a grid agent will present realised PnL, fill rate, and drawdown evidence.",
    identity: { standard: "ERC-8004", agentId: "demo-erc8004-grid-001", registryAddress: "Demo registry placeholder", explorerUrl: "", verifiedAt: "Not verified" },
    deployment: { network: "BSC Mainnet", chainId: 56, availability: "unverified", freshnessState: "unknown", heartbeatAt: DEMO_CAPTURE, lastExecutionAt: DEMO_CAPTURE, freshnessSeconds: 0 },
    pricing: { protocol: "x402", amount: "Demo only", currency: "USDC", unit: "preview request" },
    performance: demoPerformance(),
    categoryMetrics: [
      { key: "realised-pnl", label: "Realised PnL", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "fill-rate", label: "Fill rate", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "drawdown", label: "Drawdown", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
    ],
    riskBand: "unknown",
    evidence: demoEvidence("grid", [["identity", "ERC 8004 identity"], ["execution", "Grid fill record"], ["risk", "Grid drawdown record"]]),
    integrations: demoIntegrations("grid-trading", "Demo pair", "Review a grid configuration and return a bounded execution plan.",),
    hiring: demoReadiness(),
  },
  {
    id: "demo-yield-optimizer-001",
    slug: "yield-route-demo",
    name: "Yield Route Demo",
    tagline: "Demo yield route comparison for visible protocol risk.",
    mode: "demo",
    verified: false,
    category: "yield-optimisation",
    description: "A clearly labeled demo record showing how a yield agent will present net APY, protocol risk, and withdrawal liquidity evidence.",
    identity: { standard: "ERC-8004", agentId: "demo-erc8004-yield-001", registryAddress: "Demo registry placeholder", explorerUrl: "", verifiedAt: "Not verified" },
    deployment: { network: "BSC Mainnet", chainId: 56, availability: "unverified", freshnessState: "unknown", heartbeatAt: DEMO_CAPTURE, lastExecutionAt: DEMO_CAPTURE, freshnessSeconds: 0 },
    pricing: { protocol: "x402", amount: "Demo only", currency: "USDC", unit: "preview request" },
    performance: demoPerformance(),
    categoryMetrics: [
      { key: "net-apy", label: "Net APY", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "protocol-risk", label: "Protocol risk", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "withdrawal-liquidity", label: "Withdrawal liquidity", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
    ],
    riskBand: "unknown",
    evidence: demoEvidence("yield", [["identity", "ERC 8004 identity"], ["risk", "Protocol risk record"], ["execution", "Yield route record"]]),
    integrations: demoIntegrations("yield-optimisation", "Demo route", "Compare yield routes and surface protocol and withdrawal risk.", "A future route monitor can help LPs compare PancakeSwap liquidity opportunities with visible risk.",),
    hiring: demoReadiness(),
  },
  {
    id: "demo-health-monitor-001",
    slug: "health-sentinel-demo",
    name: "Health Sentinel Demo",
    tagline: "Demo borrowing monitor for visible health factor alerts.",
    mode: "demo",
    verified: false,
    category: "health-factor-monitoring",
    description: "A clearly labeled demo record showing how a health monitor will present current health, alert latency, and response history.",
    identity: { standard: "ERC-8004", agentId: "demo-erc8004-health-001", registryAddress: "Demo registry placeholder", explorerUrl: "", verifiedAt: "Not verified" },
    deployment: { network: "BSC Mainnet", chainId: 56, availability: "unverified", freshnessState: "unknown", heartbeatAt: DEMO_CAPTURE, lastExecutionAt: DEMO_CAPTURE, freshnessSeconds: 0 },
    pricing: { protocol: "x402", amount: "Demo only", currency: "USDC", unit: "preview request" },
    performance: demoPerformance(),
    categoryMetrics: [
      { key: "current-health", label: "Current health", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "alert-latency", label: "Alert latency", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "response-history", label: "Response history", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
    ],
    riskBand: "unknown",
    evidence: demoEvidence("health", [["identity", "ERC 8004 identity"], ["risk", "Health factor record"], ["execution", "Alert response record"]]),
    integrations: demoIntegrations("health-factor-monitoring", "Demo lending position", "Monitor a lending position and report health factor alerts.",),
    hiring: demoReadiness(),
  },
  {
    id: "demo-rebalancer-002",
    slug: "liquidity-compass-demo",
    name: "Liquidity Compass Demo",
    tagline: "Demo LP drift monitor for concentrated liquidity positions.",
    mode: "demo",
    verified: false,
    category: "rebalancing",
    categorySource: "demo",
    description: "A clearly labeled demo record showing how a rebalancing agent will compare target weights, range drift, and fee capture before proposing a position update.",
    identity: { standard: "ERC-8004", agentId: "demo-erc8004-rebalancing-002", registryAddress: "Demo registry placeholder", explorerUrl: "", verifiedAt: "Not verified" },
    deployment: { network: "BSC Mainnet", chainId: 56, availability: "unverified", freshnessState: "unknown", heartbeatAt: DEMO_CAPTURE, lastExecutionAt: DEMO_CAPTURE, freshnessSeconds: 0 },
    pricing: { protocol: "x402", amount: "Demo only", currency: "USDC", unit: "preview request" },
    performance: demoPerformance(),
    categoryMetrics: [
      { key: "range-health-compass", label: "Range health", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "fee-capture-compass", label: "Fee capture", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "rebalance-activity-compass", label: "Rebalance activity", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
    ],
    riskBand: "unknown",
    evidence: demoEvidence("rebalancing-compass", [["identity", "ERC 8004 identity"], ["execution", "Range drift proposal"], ["pancakeswap", "PancakeSwap pool evidence"]]),
    integrations: demoIntegrations("rebalancing", "Demo concentrated liquidity pair", "Compare target weights and range drift before proposing a position update.", "A future drift monitor can help LPs keep concentrated liquidity productive without hiding range risk.",),
    hiring: demoReadiness(),
  },
  {
    id: "demo-yield-optimizer-002",
    slug: "vault-scout-demo",
    name: "Vault Scout Demo",
    tagline: "Demo yield route analyst with visible protocol and withdrawal risk.",
    mode: "demo",
    verified: false,
    category: "yield-optimisation",
    categorySource: "demo",
    description: "A clearly labeled demo record showing how a yield agent will compare net APY, protocol concentration, TVL limits, and withdrawal liquidity without claiming live returns.",
    identity: { standard: "ERC-8004", agentId: "demo-erc8004-yield-002", registryAddress: "Demo registry placeholder", explorerUrl: "", verifiedAt: "Not verified" },
    deployment: { network: "BSC Mainnet", chainId: 56, availability: "unverified", freshnessState: "unknown", heartbeatAt: DEMO_CAPTURE, lastExecutionAt: DEMO_CAPTURE, freshnessSeconds: 0 },
    pricing: { protocol: "x402", amount: "Demo only", currency: "USDC", unit: "preview request" },
    performance: demoPerformance(),
    categoryMetrics: [
      { key: "net-apy-vault-scout", label: "Net APY", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "protocol-risk-vault-scout", label: "Protocol risk", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "withdrawal-liquidity-vault-scout", label: "Withdrawal liquidity", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
    ],
    riskBand: "unknown",
    evidence: demoEvidence("yield-vault-scout", [["identity", "ERC 8004 identity"], ["risk", "Protocol risk comparison"], ["execution", "Yield route proposal"]]),
    integrations: demoIntegrations("yield-optimisation", "Demo yield route", "Compare net yield routes, protocol concentration, and withdrawal liquidity.", "A future route monitor can help LPs compare fee opportunities against protocol risk.",),
    hiring: demoReadiness(),
  },
  {
    id: "demo-health-monitor-002",
    slug: "collateral-watch-demo",
    name: "Collateral Watch Demo",
    tagline: "Demo lending position monitor for early health factor alerts.",
    mode: "demo",
    verified: false,
    category: "health-factor-monitoring",
    categorySource: "demo",
    description: "A clearly labeled demo record showing how a health factor agent will track collateral, liquidation distance, alert latency, and response history.",
    identity: { standard: "ERC-8004", agentId: "demo-erc8004-health-002", registryAddress: "Demo registry placeholder", explorerUrl: "", verifiedAt: "Not verified" },
    deployment: { network: "BSC Mainnet", chainId: 56, availability: "unverified", freshnessState: "unknown", heartbeatAt: DEMO_CAPTURE, lastExecutionAt: DEMO_CAPTURE, freshnessSeconds: 0 },
    pricing: { protocol: "x402", amount: "Demo only", currency: "USDC", unit: "preview request" },
    performance: demoPerformance(),
    categoryMetrics: [
      { key: "current-health-collateral-watch", label: "Current health", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "alert-latency-collateral-watch", label: "Alert latency", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
      { key: "response-history-collateral-watch", label: "Response history", value: "Demo only", sampleSize: 0, capturedAt: DEMO_CAPTURE, source: "demo" },
    ],
    riskBand: "unknown",
    evidence: demoEvidence("health-collateral-watch", [["identity", "ERC 8004 identity"], ["risk", "Liquidation distance record"], ["execution", "Alert response record"]]),
    integrations: demoIntegrations("health-factor-monitoring", "Demo lending position", "Track collateral, liquidation distance, and alert response requirements.",),
    hiring: demoReadiness(),
  },
] as const satisfies readonly Agent[];

// Live records will be populated by the future ERC 8004 adapter.
export const LIVE_AGENTS: readonly Agent[] = [];
export const AGENTS: readonly Agent[] = [...DEMO_AGENTS, ...LIVE_AGENTS];
export const AGENT_REGISTRY = { demo: DEMO_AGENTS, live: LIVE_AGENTS, all: AGENTS } as const;

export function getAgentById(agentId: string) {
  return AGENTS.find((agent) => agent.id === agentId || agent.slug === agentId);
}
