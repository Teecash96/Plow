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
      key: "erc8183-router",
      label: "ERC 8183 evaluator router",
      state: erc.routerConfigured ? "ready" : "blocked",
      detail: erc.routerConfigured ? "The canonical evaluator router is configured." : "Set ERC8183_ROUTER_ADDRESS.",
    },
    {
      key: "erc8183-policy",
      label: "ERC 8183 policy",
      state: erc.policyConfigured ? "ready" : "blocked",
      detail: erc.policyConfigured ? "The evaluator policy is configured." : "Set ERC8183_POLICY_ADDRESS.",
    },
    {
      key: "x402-resource",
      label: "x402 resource",
      state: x402.resourceUrl ? "ready" : "blocked",
      detail: x402.resourceUrl
        ? x402.resourceUrl.startsWith("/")
          ? `Internal resource at ${x402.resourceUrl} — no facilitator URL is needed.`
          : x402.facilitatorConfigured
            ? "Resource URL is configured and facilitator metadata is set."
            : "Resource URL is configured. For an internal /api/x402 route, the facilitator URL is not needed."
        : "Set NEXT_PUBLIC_X402_RESOURCE_URL to /api/x402/resource for the in-app resource.",
    },
    {
      key: "x402-facilitator",
      label: "x402 facilitator",
      state: x402.resourceUrl && x402.resourceUrl.startsWith("/") ? "ready" : x402.facilitatorConfigured ? "ready" : "optional",
      detail:
        x402.resourceUrl && x402.resourceUrl.startsWith("/")
          ? "The internal resource settles via X402_FACILITATOR_KEY (server side)."
          : x402.facilitatorConfigured
            ? "Facilitator URL is configured."
            : "Optional when the resource handles x402 settlement directly.",
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
      state: erc.routerConfigured || erc.evaluatorConfigured ? "ready" : "blocked",
      detail: erc.routerConfigured
        ? "The evaluator router will be bound to the job."
        : erc.evaluatorConfigured
          ? "Configured evaluator address will be used."
          : "The canonical evaluator router is required.",
    },
    {
      key: "hook",
      label: "ERC 8183 hook",
      state: erc.routerConfigured || erc.hookConfigured ? "ready" : "blocked",
      detail: erc.routerConfigured
        ? "The evaluator router will be used as the job hook."
        : erc.hookConfigured
          ? "Configured hook address will be used."
          : "The canonical evaluator router is required as the job hook.",
    },
    {
      key: "combined-settlement",
      label: "Combined settlement safety gate",
      state: combinedSettlementEnabled ? "ready" : "blocked",
      detail: combinedSettlementEnabled
        ? "x402 service settlement and ERC 8183 escrow are explicitly enabled."
        : "Set NEXT_PUBLIC_HIRE_COMBINED_SETTLEMENT=true only after both transfers are tested together.",
    },
    {
      key: "x402-payee",
      label: "x402 payee",
      state:
        x402.resourceUrl && x402.resourceUrl !== "/api/x402/resource"
          ? process.env.NEXT_PUBLIC_X402_PAYEE_ADDRESS
            ? "ready"
            : "blocked"
          : "ready",
      detail:
        x402.resourceUrl && x402.resourceUrl !== "/api/x402/resource"
          ? process.env.NEXT_PUBLIC_X402_PAYEE_ADDRESS
            ? "The resource pays the configured agent wallet."
            : "Set X402_PAYEE_ADDRESS (server side) to the agent wallet that receives payment."
          : "Internal resource at /api/x402/resource — payee is resolved server side.",
    },
    {
      key: "x402-facilitator-key",
      label: "x402 facilitator signer",
      state:
        x402.resourceUrl && x402.resourceUrl !== "/api/x402/resource"
          ? process.env.NEXT_PUBLIC_X402_FACILITATOR_KEY
            ? "ready"
            : "blocked"
          : "ready",
      detail:
        x402.resourceUrl && x402.resourceUrl !== "/api/x402/resource"
          ? process.env.NEXT_PUBLIC_X402_FACILITATOR_KEY
            ? "The server-held facilitator key is configured for settlement."
            : "Set X402_FACILITATOR_KEY (server only) so the resource can push settlement transactions."
          : "Internal resource at /api/x402/resource — facilitator key is server side and never exposed to the browser.",
    },
  ];

  if (agent) {
    const identityReady = agent.mode === "live" && agent.verified && Boolean(agent.identity.ownerAddress);
    const service = agent.hiring.service;
    const serviceReady = service?.available === true;
    checks.push({
      key: "agent-identity",
      label: "Agent identity",
      state: identityReady ? "ready" : "blocked",
      detail: identityReady
        ? "Live ERC 8004 identity and provider address are available."
        : "The agent must be live, verified, and have an ERC 8004 provider address. Demo agents stay local.",
    });
    checks.push({
      key: "agent-service-readiness",
      label: "Agent service readiness",
      state: serviceReady ? "ready" : "blocked",
      detail: serviceReady
        ? "Pricing, freshness, and execution checks are verified."
        : agent.hiring.reason ?? "Pricing, freshness, and execution checks are required before hiring.",
    });
    checks.push({
      key: "agent-service-endpoint",
      label: "Controlled HTTPS service",
      state: service?.endpointVerified ? "ready" : "blocked",
      detail: service?.endpoint.detail ?? "A Plow execution endpoint must be verified before hiring.",
    });
    checks.push({
      key: "agent-service-price",
      label: "Verified x402 price",
      state: service?.pricingVerified ? "ready" : "blocked",
      detail: service?.pricing.detail ?? "A positive x402 amount and currency are required.",
    });
    checks.push({
      key: "agent-service-heartbeat",
      label: "Fresh provider heartbeat",
      state: service?.heartbeatVerified ? "ready" : "blocked",
      detail: service?.heartbeat.detail ?? "A recent heartbeat from the provider health endpoint is required.",
    });
    checks.push({
      key: "agent-service-evidence",
      label: "Execution evidence",
      state: service?.executionEvidenceVerified || service?.bootstrapEligible ? "ready" : "blocked",
      detail: service?.executionEvidence.detail ?? "A completed execution recorded by Plow is required before hiring.",
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
