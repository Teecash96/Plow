import { getERC8183Config } from "@/lib/chain/erc8183-adapter";
import { getX402Config } from "@/lib/payments/x402-adapter";
import type { Agent } from "./types";

export type HireSetupCheckState = "ready" | "blocked" | "optional";

export interface HireSetupCheck {
  key: string;
  label: string;
  state: HireSetupCheckState;
  detail: string;
}

export interface HireSetupStatus {
  ready: boolean;
  networkName: "BSC Mainnet" | "BSC Testnet";
  chainId: number;
  checks: readonly HireSetupCheck[];
  blocked: readonly HireSetupCheck[];
}

export function getHireSetupStatus(agent?: Agent): HireSetupStatus {
  const erc = getERC8183Config();
  const x402 = getX402Config();
  const combinedSettlementEnabled = process.env.NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT === "true";
  const checks: HireSetupCheck[] = [
    {
      key: "network",
      label: "BSC network",
      state: erc.networkConfigured ? "ready" : "blocked",
      detail: erc.networkConfigured
        ? `${erc.networkName}, chain ${erc.chainId}`
        : "Set NEXT_PUBLIC_HIRE_NETWORK to bsc-mainnet or bsc-testnet.",
    },
    {
      key: "erc8183-contract",
      label: "ERC 8183 contract",
      state: erc.contractConfigured ? "ready" : "blocked",
      detail: erc.contractConfigured ? "Contract address is configured." : "Set ERC8183_CONTRACT_ADDRESS.",
    },
    {
      key: "payment-token",
      label: "Payment token",
      state: erc.paymentTokenConfigured ? "ready" : "blocked",
      detail: erc.paymentTokenConfigured ? "ERC 20 payment token is configured." : "Set PAYMENT_TOKEN_ADDRESS.",
    },
    {
      key: "x402-resource",
      label: "x402 resource",
      state: x402.resourceUrl && erc.networkConfigured ? "ready" : "blocked",
      detail: x402.resourceUrl && erc.networkConfigured
        ? "Resource URL is configured and will be challenged per job."
        : "Set X402_RESOURCE or NEXT_PUBLIC_X402_RESOURCE_URL.",
    },
    {
      key: "x402-facilitator",
      label: "x402 facilitator",
      state: x402.facilitatorConfigured ? "ready" : "optional",
      detail: x402.facilitatorConfigured ? "Facilitator URL is configured." : "Optional when the resource handles x402 settlement directly.",
    },
    {
      key: "rpc",
      label: "BSC RPC",
      state: "ready",
      detail: erc.rpcSource === "environment" ? "Using the configured RPC endpoint." : "Using the default public BSC RPC. Set BSC_RPC_URL for production.",
    },
    {
      key: "evaluator",
      label: "ERC 8183 evaluator",
      state: erc.evaluatorConfigured ? "ready" : "optional",
      detail: erc.evaluatorConfigured ? "Configured evaluator address will be used." : "Optional. The buyer wallet becomes evaluator when omitted.",
    },
    {
      key: "hook",
      label: "ERC 8183 hook",
      state: erc.hookConfigured ? "ready" : "optional",
      detail: erc.hookConfigured ? "Configured hook address will be used." : "Optional only if the deployment whitelists the zero address.",
    },
    {
      key: "combined-settlement",
      label: "Combined settlement safety gate",
      state: combinedSettlementEnabled ? "ready" : "blocked",
      detail: combinedSettlementEnabled
        ? "x402 service settlement and ERC 8183 escrow are explicitly enabled."
        : "Set NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=true only after both transfers are tested together.",
    },
  ];

  if (agent) {
    const identityReady = agent.mode === "live" && agent.verified && Boolean(agent.identity.ownerAddress);
    checks.push({
      key: "agent-identity",
      label: "Agent identity",
      state: identityReady ? "ready" : "blocked",
      detail: identityReady
        ? "Live ERC 8004 identity and provider address are available."
        : "The agent must be live, verified, and have an ERC 8004 provider address. Demo agents stay local.",
    });
  }

  const blocked = checks.filter((check) => check.state === "blocked");
  return {
    ready: blocked.length === 0,
    networkName: erc.networkName,
    chainId: erc.chainId,
    checks,
    blocked,
  };
}
