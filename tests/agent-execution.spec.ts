import { expect, test } from "@playwright/test";
import { ERC8183_STATUS } from "@/lib/chain/erc8183-adapter";
import {
  assertERC8183ExecutionProof,
  JobExecutionVerificationError,
} from "@/lib/marketplace/job-execution-verification";
import type { Agent, Job } from "@/lib/marketplace/types";
import { executeAgentJob, probeAgentService } from "@/lib/marketplace/agent-execution";
import type { Address } from "viem";

const CREATED_AT = "2026-08-31T00:00:00.000Z";

function liveAgent(serviceUri = "https://agent.example/execute"): Agent {
  return {
    id: "erc8004-bsc-42",
    slug: "erc8004-42",
    name: "Execution Agent",
    tagline: "Live execution test agent.",
    mode: "live",
    verified: true,
    category: "rebalancing",
    description: "A live agent used by the execution contract test.",
    identity: {
      standard: "ERC-8004",
      agentId: "42",
      registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      explorerUrl: "https://bscscan.com/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432?a=42",
      verifiedAt: CREATED_AT,
      ownerAddress: "0x1111111111111111111111111111111111111111",
      metadataStatus: "verified",
      serviceUri,
    },
    deployment: {
      network: "BSC Mainnet",
      chainId: 56,
      availability: "live",
      freshnessState: "fresh",
      heartbeatAt: CREATED_AT,
      lastExecutionAt: CREATED_AT,
      freshnessSeconds: 0,
    },
    pricing: { protocol: "x402", amount: "1", currency: "USDC", unit: "per task" },
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
      service: {
        endpointVerified: true,
        pricingVerified: true,
        heartbeatVerified: true,
        executionEvidenceVerified: true,
        freshnessVerified: true,
        available: true,
        endpoint: { verified: true, detail: "Test endpoint verified.", checkedAt: CREATED_AT },
        pricing: { verified: true, detail: "Test price verified.", checkedAt: CREATED_AT },
        heartbeat: { verified: true, detail: "Test heartbeat verified.", checkedAt: CREATED_AT },
        executionEvidence: { verified: true, detail: "Test execution verified.", checkedAt: CREATED_AT },
        heartbeatAt: CREATED_AT,
        lastExecutionAt: CREATED_AT,
      },
    },
  };
}

function activeJob(): Job {
  return {
    id: "job-execution-001",
    agentId: "erc8004-bsc-42",
    agentIdentityId: "42",
    agentName: "Execution Agent",
    category: "rebalancing",
    clientAddress: "0x2222222222222222222222222222222222222222",
    taskSummary: "Review the current position and return a bounded rebalance plan.",
    status: "active",
    price: "1",
    currency: "USDC",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    terms: {
      protocol: "ERC-8183",
      taskSummary: "Review the current position and return a bounded rebalance plan.",
      category: "rebalancing",
      expiresAt: "2026-09-01",
    },
    statusHistory: [{ status: "active", changedAt: CREATED_AT }],
    payment: { protocol: "x402", status: "paid", amount: "1", currency: "USDC" },
    permission: {
      provider: "Altana",
      spendCap: "2",
      currency: "USDC",
      allowlistedContracts: ["0x3333333333333333333333333333333333333333"],
      allowlistedTokens: ["0x4444444444444444444444444444444444444444"],
      expiresAt: "24 hours",
      expiresAtTimestamp: "2099-01-01T00:00:00.000Z",
      status: "active",
      templateId: "execution-test",
      revokeSupported: false,
      lastUpdatedAt: CREATED_AT,
      source: "job",
    },
    onchainJobId: "7",
    onchainNetwork: "BSC Mainnet",
    onchainChainId: 56,
    jobContractAddress: "0x3333333333333333333333333333333333333333",
    termsHash: "0xterms-hash",
  };
}

function publicHostResolver() {
  return async () => ["203.0.113.10"];
}

test("posts an active job to a verified service and accepts its result", async () => {
  let requestUrl = "";
  let requestBody = "";
  let requestRedirect: RequestInit["redirect"];

  const result = await executeAgentJob(activeJob(), liveAgent(), {
    resolveHostname: publicHostResolver(),
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body);
      requestRedirect = init?.redirect;
      return new Response(JSON.stringify({
        status: "completed",
        resultSummary: "The position is inside its target range. No rebalance is needed.",
        resultUri: "https://agent.example/results/job-execution-001",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  expect(requestUrl).toBe("https://agent.example/execute");
  expect(requestRedirect).toBe("error");
  expect(JSON.parse(requestBody)).toMatchObject({
    protocol: "plow-agent-execution-v1",
    job: {
      id: "job-execution-001",
      agentId: "42",
      status: "active",
      taskSummary: "Review the current position and return a bounded rebalance plan.",
    },
  });
  expect(result).toEqual({
    resultSummary: "The position is inside its target range. No rebalance is needed.",
    resultUri: "https://agent.example/results/job-execution-001",
  });
});

test("surfaces a safe provider error response", async () => {
  await expect(executeAgentJob(activeJob(), liveAgent(), {
    resolveHostname: publicHostResolver(),
    fetchImpl: async () => new Response(JSON.stringify({ error: "The provider request field job.termsHash is invalid." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  })).rejects.toMatchObject({
    code: "request_failed",
    message: "The provider request field job.termsHash is invalid.",
  });
});

test("probes a provider health endpoint with a bounded GET request", async () => {
  let requestMethod = "";
  let requestRedirect: RequestInit["redirect"];

  const result = await probeAgentService("https://agent.example/health", {
    resolveHostname: publicHostResolver(),
    fetchImpl: async (_input, init) => {
      requestMethod = init?.method ?? "";
      requestRedirect = init?.redirect;
      return new Response(JSON.stringify({
        status: "ok",
        agentId: "42",
        heartbeatAt: CREATED_AT,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  expect(requestMethod).toBe("GET");
  expect(requestRedirect).toBe("error");
  expect(JSON.parse(result.body)).toMatchObject({ agentId: "42", heartbeatAt: CREATED_AT });
});

test("rejects demo agents and unsafe service URLs", async () => {
  const demo = { ...liveAgent(), mode: "demo" as const, verified: false };

  await expect(executeAgentJob(activeJob(), demo, { resolveHostname: publicHostResolver() })).rejects.toThrow("Live agents only");
  await expect(executeAgentJob(activeJob(), {
    ...liveAgent(),
    identity: { ...liveAgent().identity, serviceUri: undefined, endpoints: ["https://agent.example/card"] },
  }, { resolveHostname: publicHostResolver() })).rejects.toThrow("no published service endpoint");
  await expect(executeAgentJob(activeJob(), liveAgent("http://agent.example/execute"), { resolveHostname: publicHostResolver() })).rejects.toThrow("HTTPS");
  await expect(executeAgentJob(activeJob(), liveAgent("https://localhost/execute"), { resolveHostname: publicHostResolver() })).rejects.toThrow("public service");
  await expect(executeAgentJob(activeJob(), liveAgent("https://[::1]/execute"), { resolveHostname: publicHostResolver() })).rejects.toThrow("public service");
});

test("requires the stored marketplace job to match the funded on chain job", () => {
  const job = activeJob();
  const agent = liveAgent();
  const config = {
    contractAddress: job.jobContractAddress as Address,
    paymentTokenAddress: "0x4444444444444444444444444444444444444444" as Address,
    evaluatorAddress: "0x5555555555555555555555555555555555555555" as Address,
    hookAddress: "0x6666666666666666666666666666666666666666" as Address,
    rpcUrl: "https://bsc.example",
    rpcSource: "environment" as const,
    network: "eip155:56" as const,
    networkName: "BSC Mainnet" as const,
    chainId: 56 as const,
    networkConfigured: true,
    contractConfigured: true,
    paymentTokenConfigured: true,
    evaluatorConfigured: true,
    hookConfigured: true,
    missing: [],
    enabled: true,
  };
  const onchainJob = {
    id: BigInt(7),
    client: job.clientAddress as Address,
    provider: agent.identity.ownerAddress as Address,
    evaluator: config.evaluatorAddress,
    description: JSON.stringify({
      marketplace: "BNB Agent Studio",
      marketplaceJobId: "a-different-marketplace-job",
      marketplaceAgentId: job.agentId,
      agentId: agent.identity.agentId,
      client: job.clientAddress,
      task: job.taskSummary,
      category: job.category,
      termsHash: job.termsHash,
    }),
    budget: BigInt(1_000_000),
    expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3_600),
    status: ERC8183_STATUS.funded,
    hook: config.hookAddress,
    submittedAt: BigInt(0),
    deliverable: "0x" as `0x${string}`,
  };

  expect(() => assertERC8183ExecutionProof(
    job,
    agent,
    onchainJob,
    { address: config.paymentTokenAddress, decimals: 6, symbol: "USDC" },
    config,
  )).toThrow(JobExecutionVerificationError);
  expect(() => assertERC8183ExecutionProof(
    job,
    agent,
    onchainJob,
    { address: config.paymentTokenAddress, decimals: 6, symbol: "USDC" },
    config,
  )).toThrow("description");
});

test("rejects malformed agent results", async () => {
  await expect(executeAgentJob(activeJob(), liveAgent(), {
    resolveHostname: publicHostResolver(),
    fetchImpl: async () => new Response(JSON.stringify({ status: "completed" }), { status: 200 }),
  })).rejects.toThrow("resultSummary");
});

test("aborts an agent request that exceeds the execution timeout", async () => {
  await expect(executeAgentJob(activeJob(), liveAgent(), {
    resolveHostname: publicHostResolver(),
    timeoutMs: 10,
    fetchImpl: () => new Promise<Response>(() => undefined),
  })).rejects.toThrow("timed out");
});

test("does not call an agent when the job has no active permission", async () => {
  let called = false;
  await expect(executeAgentJob({ ...activeJob(), permission: undefined }, liveAgent(), {
    resolveHostname: publicHostResolver(),
    fetchImpl: async () => {
      called = true;
      return new Response(JSON.stringify({ status: "completed", resultSummary: "Should not run." }), { status: 200 });
    },
  })).rejects.toThrow("permission");
  expect(called).toBe(false);
});

test("job detail runs an active agent and renders its result", async ({ page }) => {
  const job = activeJob();
  const completedJob: Job = {
    ...job,
    status: "completed",
    resultSummary: "The position is inside its target range. No rebalance is needed.",
    resultUri: "https://agent.example/results/job-execution-001",
    execution: { status: "completed", attempt: 1, startedAt: CREATED_AT, completedAt: "2026-08-31T00:01:00.000Z" },
  };

  await page.addInitScript((value) => {
    window.localStorage.setItem("plow.jobs.v1", JSON.stringify(value));
  }, [job]);
  await page.route("**/api/jobs/job-execution-001", (route) => route.fulfill({ status: 404, json: { error: "Job not found." } }));
  await page.route("**/api/jobs/job-execution-001/execute", (route) => route.fulfill({ status: 200, json: { job: completedJob } }));

  await page.goto("/jobs/job-execution-001", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Run agent" })).toBeVisible();
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect(page.getByText("The position is inside its target range. No rebalance is needed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run agent" })).toHaveCount(0);
});
