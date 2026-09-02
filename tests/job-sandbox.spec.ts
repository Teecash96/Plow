import { expect, test } from "@playwright/test";
import { createSandboxJob } from "../src/lib/marketplace/sandbox";
import { getJobProofEvents } from "../src/lib/marketplace/job-proof";
import { validateNewStoredJob } from "../src/lib/marketplace/job-database";
import type { Agent } from "../src/lib/marketplace/types";

const agent: Agent = {
  id: "erc8004-bsc-42",
  slug: "erc8004-42",
  name: "Execution Agent",
  tagline: "Bounded execution test agent.",
  mode: "live",
  verified: true,
  category: "rebalancing",
  description: "A live agent used by the sandbox test.",
  identity: {
    standard: "ERC-8004",
    agentId: "42",
    registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    explorerUrl: "https://bscscan.com/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432?a=42",
    verifiedAt: "2026-08-31T00:00:00.000Z",
    ownerAddress: "0x1111111111111111111111111111111111111111",
    serviceUri: "https://agent.example/execute",
  },
  deployment: {
    network: "BSC Mainnet",
    chainId: 56,
    availability: "live",
    freshnessState: "fresh",
    heartbeatAt: "2026-08-31T00:00:00.000Z",
    lastExecutionAt: "2026-08-31T00:00:00.000Z",
    freshnessSeconds: 0,
  },
  pricing: { protocol: "x402", amount: "0.25", currency: "USDC", unit: "per task" },
  performance: [],
  categoryMetrics: [],
  riskBand: "unknown",
  evidence: [],
  integrations: {},
  hiring: {
    identityVerified: true,
    mainnetVerified: true,
    freshnessVerified: true,
    available: true,
  },
};

test("creates a local simulation with no real payment or chain evidence", () => {
  const job = createSandboxJob({
    id: "simulation-job-1",
    agent,
    taskSummary: "Return a bounded readiness report.",
    price: "0.25",
    currency: "USDC",
    expiresAt: "24 hours",
    now: "2026-08-31T12:00:00.000Z",
  });

  expect(job).toMatchObject({
    id: "simulation-job-1",
    mode: "simulation",
    status: "completed",
    clientAddress: "Simulation only",
    payment: { protocol: "x402", status: "preview", amount: "0.25", currency: "USDC" },
    escrow: { status: "completed" },
    execution: { status: "completed", attempt: 1 },
  });
  expect(job.onchainJobId).toBeUndefined();
  expect(job.payment?.transactionHash).toBeUndefined();
  expect(job.escrow?.creationTransactionHash).toBeUndefined();
  expect(job.escrow?.fundingTransactionHash).toBeUndefined();
  expect(job.simulation?.scenario).toBe("one-click-hire");
  expect(job.simulation?.steps).toHaveLength(7);
  expect(job.simulation?.steps.every((step) => step.detail.includes("Simulation only"))).toBe(true);
});

test("builds a proof timeline that keeps simulated steps separate", () => {
  const job = createSandboxJob({
    id: "simulation-job-2",
    agent,
    taskSummary: "Return a bounded readiness report.",
    price: "0.25",
    currency: "USDC",
    expiresAt: "24 hours",
    now: "2026-08-31T12:00:00.000Z",
  });

  const events = getJobProofEvents(job);

  expect(events).toHaveLength(7);
  expect(events.every((event) => event.state === "simulated")).toBe(true);
  expect(events.every((event) => !event.transactionHash && !event.explorerUrl)).toBe(true);
  expect(events.map((event) => event.label)).toContain("x402 payment");
  expect(events.map((event) => event.label)).toContain("Agent execution");
});

test("does not allow a simulation record into durable storage", () => {
  const job = createSandboxJob({
    id: "simulation-job-server-guard",
    agent,
    taskSummary: "Return a bounded readiness report.",
    price: "0.25",
    currency: "USDC",
    expiresAt: "24 hours",
  });

  expect(() => validateNewStoredJob(job)).toThrow("local only");
});

test("adds explorer links only for verified live transaction hashes", () => {
  const job = createSandboxJob({
    id: "live-proof-job",
    agent,
    taskSummary: "Return a bounded readiness report.",
    price: "0.25",
    currency: "USDC",
    expiresAt: "24 hours",
    now: "2026-08-31T12:00:00.000Z",
  });
  const liveJob = {
    ...job,
    mode: "live" as const,
    status: "active" as const,
    clientAddress: "0x2222222222222222222222222222222222222222",
    onchainJobId: "7",
    onchainNetwork: "BSC Testnet" as const,
    onchainChainId: 97 as const,
    jobContractAddress: "0x3333333333333333333333333333333333333333",
    payment: {
      protocol: "x402" as const,
      status: "paid" as const,
      amount: "0.25",
      currency: "USDC",
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    escrow: {
      status: "funded" as const,
      fundingTransactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    simulation: undefined,
  };

  const events = getJobProofEvents(liveJob);
  const payment = events.find((event) => event.label === "x402 payment");
  const funding = events.find((event) => event.label === "Escrow funded");

  expect(payment).toMatchObject({
    state: "verified",
    transactionHash: liveJob.payment.transactionHash,
    explorerUrl: "https://testnet.bscscan.com/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  expect(funding).toMatchObject({
    state: "verified",
    transactionHash: liveJob.escrow.fundingTransactionHash,
    explorerUrl: "https://testnet.bscscan.com/tx/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
});

test("shows a broadcast funding hash as pending proof", () => {
  const pendingHash = `0x${"cc".repeat(32)}`;
  const baseJob = createSandboxJob({
    id: "pending-funding-proof-job",
    agent,
    taskSummary: "Return a bounded readiness report.",
    price: "0.25",
    currency: "USDC",
    expiresAt: "24 hours",
    now: "2026-08-31T12:00:00.000Z",
  });
  const pendingJob = {
    ...baseJob,
    mode: "live" as const,
    status: "pending" as const,
    clientAddress: "0x2222222222222222222222222222222222222222",
    onchainJobId: "7",
    onchainNetwork: "BSC Testnet" as const,
    onchainChainId: 97 as const,
    jobContractAddress: "0x3333333333333333333333333333333333333333",
    payment: {
      protocol: "x402" as const,
      status: "paid" as const,
      amount: "0.25",
      currency: "USDC",
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    statusHistory: [{ status: "pending" as const, changedAt: "2026-08-31T12:00:00.000Z" }],
    escrow: {
      status: "open" as const,
      pendingFundingTransactionHash: pendingHash,
      pendingFundingAt: "2026-08-31T12:01:00.000Z",
    },
    simulation: undefined,
  };
  const events = getJobProofEvents(pendingJob);
  const funding = events.find((event) => event.label === "Escrow funding broadcast");

  expect(funding).toMatchObject({
    state: "pending",
    transactionHash: pendingHash,
    explorerUrl: `https://testnet.bscscan.com/tx/${pendingHash}`,
  });
  expect(events.find((event) => event.label === "Escrow funded")).toBeUndefined();
});
