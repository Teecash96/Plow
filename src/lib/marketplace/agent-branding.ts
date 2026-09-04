import type { AgentAvatar, AgentCategory } from "./types";

export interface ProviderAgentBranding {
  name: string;
  tagline: string;
  description: string;
  avatar: AgentAvatar;
}

export const PROVIDER_AGENT_BRANDING: Record<AgentCategory, ProviderAgentBranding> = {
  rebalancing: {
    name: "Range Steward",
    tagline: "PancakeSwap range health analyst for concentrated liquidity positions.",
    description: "Reads live BSC pool telemetry, measures range drift, and returns a bounded rebalancing proposal without moving user funds.",
    avatar: {
      src: "/agents/range-steward.svg",
      alt: "Range Steward avatar",
      initials: "RS",
    },
  },
  "grid-trading": {
    name: "Grid Pilot",
    tagline: "Structured grid analysis for defined BSC price ranges.",
    description: "Maps current BSC market data into bounded grid levels and reports execution risk before any order placement is enabled.",
    avatar: {
      src: "/agents/grid-pilot.svg",
      alt: "Grid Pilot avatar",
      initials: "GP",
    },
  },
  "yield-optimisation": {
    name: "Yield Scout",
    tagline: "Yield route comparison with protocol and liquidity risk in view.",
    description: "Compares configured yield routes using live BSC data and explains net yield, protocol exposure, and withdrawal liquidity.",
    avatar: {
      src: "/agents/yield-scout.svg",
      alt: "Yield Scout avatar",
      initials: "YS",
    },
  },
  "health-factor-monitoring": {
    name: "Health Sentinel",
    tagline: "Early warning monitor for BSC lending health factors.",
    description: "Checks configured lending positions, measures liquidation distance, and raises bounded alerts before a health factor becomes urgent.",
    avatar: {
      src: "/agents/health-sentinel.svg",
      alt: "Health Sentinel avatar",
      initials: "HS",
    },
  },
};
