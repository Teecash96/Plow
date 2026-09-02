import { expect, test } from "@playwright/test";
import { parseAgentExecutionResult } from "@/lib/marketplace/agent-execution";
import {
  applyEscrowObservation,
  assertEscrowTransition,
} from "@/lib/marketplace/job-lifecycle";
import type { Job } from "@/lib/marketplace/types";

const CREATED_AT = "2026-08-31T00:00:00.000Z";

function activeJob(): Job {
  return {
    id: "job-lifecycle-001",
    agentId: "erc8004-bsc-42",
    agentIdentityId: "42",
    agentName: "Execution Agent",
    category: "rebalancing",
    clientAddress: "0x2222222222222222222222222222222222222222",
    taskSummary: "Return a bounded result.",
    status: "active",
    price: "1",
    currency: "USDC",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    terms: {
      protocol: "ERC-8183",
      termsHash: "0xterms-hash",
      taskSummary: "Return a bounded result.",
      category: "rebalancing",
      expiresAt: "24 hours",
    },
    statusHistory: [{ status: "active", changedAt: CREATED_AT }],
    payment: { protocol: "x402", status: "paid", amount: "1", currency: "USDC" },
    onchainJobId: "7",
    onchainNetwork: "BSC Testnet",
    onchainChainId: 97,
    jobContractAddress: "0x3333333333333333333333333333333333333333",
    escrow: { status: "funded", fundingTransactionHash: "0xfunding" },
  };
}

test("an agent result does not claim escrow completion without provider submission", () => {
  const result = parseAgentExecutionResult(JSON.stringify({
    status: "completed",
    resultSummary: "The result is ready for review.",
    resultUri: "https://agent.example/results/job-lifecycle-001",
  }));

  expect(result).toEqual({
    resultSummary: "The result is ready for review.",
    resultUri: "https://agent.example/results/job-lifecycle-001",
  });
  expect(result.submissionTransactionHash).toBeUndefined();
});

test("accepts a provider submission only when both hashes are present and valid", () => {
  const result = parseAgentExecutionResult(JSON.stringify({
    status: "completed",
    resultSummary: "The result was submitted on chain.",
    deliverableHash: `0x${"11".repeat(32)}`,
    submissionTransactionHash: `0x${"22".repeat(32)}`,
  }));

  expect(result.deliverableHash).toBe(`0x${"11".repeat(32)}`);
  expect(result.submissionTransactionHash).toBe(`0x${"22".repeat(32)}`);
  expect(() => parseAgentExecutionResult(JSON.stringify({
    status: "completed",
    resultSummary: "Missing transaction.",
    deliverableHash: `0x${"11".repeat(32)}`,
  }))).toThrow("submission transaction");
});

test("maps funded, submitted, completed, rejected, and expired chain states", () => {
  const job = activeJob();
  const submitted = applyEscrowObservation(job, {
    status: "submitted",
    deliverableHash: `0x${"11".repeat(32)}`,
    transactionHash: `0x${"22".repeat(32)}`,
    submittedAt: "2026-08-31T00:05:00.000Z",
  });
  expect(submitted.status).toBe("submitted");
  expect(submitted.escrow?.status).toBe("submitted");

  const completed = applyEscrowObservation(submitted, {
    status: "completed",
    transactionHash: `0x${"33".repeat(32)}`,
  });
  expect(completed.status).toBe("completed");
  expect(completed.escrow?.settlementTransactionHash).toBe(`0x${"33".repeat(32)}`);

  const expired = applyEscrowObservation(activeJob(), {
    status: "expired",
    transactionHash: `0x${"44".repeat(32)}`,
  });
  expect(expired.status).toBe("expired");
  expect(expired.escrow?.refundTransactionHash).toBe(`0x${"44".repeat(32)}`);
});

test("rejects backward escrow transitions", () => {
  expect(() => assertEscrowTransition("completed", "funded")).toThrow("cannot move");
  expect(() => assertEscrowTransition("submitted", "funded")).toThrow("cannot move");
  expect(() => assertEscrowTransition("funded", "submitted")).not.toThrow();
});

test("keeps an unconfirmed funding broadcast until the escrow is verified", () => {
  const pendingHash = `0x${"55".repeat(32)}`;
  const openJob: Job = {
    ...activeJob(),
    status: "pending",
    statusHistory: [{ status: "pending", changedAt: CREATED_AT }],
    escrow: { status: "open", pendingFundingTransactionHash: pendingHash, pendingFundingAt: CREATED_AT },
  };

  const stillOpen = applyEscrowObservation(openJob, { status: "open" });
  expect(stillOpen.escrow?.pendingFundingTransactionHash).toBe(pendingHash);

  const funded = applyEscrowObservation(openJob, {
    status: "funded",
    transactionHash: `0x${"66".repeat(32)}`,
    transactionEvent: "funding",
  });
  expect(funded.escrow?.fundingTransactionHash).toBe(`0x${"66".repeat(32)}`);
  expect(funded.escrow?.pendingFundingTransactionHash).toBeUndefined();
  expect(funded.escrow?.pendingFundingAt).toBeUndefined();
});
