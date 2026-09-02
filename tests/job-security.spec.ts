import { expect, test } from "@playwright/test";
import { isJobRecord, JobMutationError, parseJobPatch, validateJobPatch } from "@/lib/marketplace/job-database";
import type { Job, SessionPermission } from "@/lib/marketplace/types";

const permission: SessionPermission = {
  provider: "Altana",
  spendCap: "2",
  currency: "USDC",
  allowlistedContracts: ["0x1111111111111111111111111111111111111111"],
  allowlistedTokens: ["0x2222222222222222222222222222222222222222"],
  expiresAt: "24 hours",
  expiresAtTimestamp: "2099-01-01T00:00:00.000Z",
  status: "active",
  templateId: "job-policy",
  revokeSupported: false,
  lastUpdatedAt: "2026-08-31T00:00:00.000Z",
  source: "job",
};

const job: Job = {
  id: "job-security-1",
  agentId: "erc8004-bsc-42",
  agentIdentityId: "42",
  agentName: "Execution Agent",
  category: "rebalancing",
  clientAddress: "0x3333333333333333333333333333333333333333",
  taskSummary: "Return a bounded result.",
  status: "pending",
  price: "1",
  currency: "USDC",
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
  terms: { protocol: "ERC-8183", taskSummary: "Return a bounded result.", category: "rebalancing", expiresAt: "24 hours" },
  statusHistory: [{ status: "pending", changedAt: "2026-08-31T00:00:00.000Z" }],
  permission,
  payment: { protocol: "x402", status: "pending", amount: "1", currency: "USDC" },
};

test("rejects patches that rewrite immutable payment and authorization fields", () => {
  expect(() => validateJobPatch(job, { price: "99" })).toThrow(JobMutationError);
  expect(() => validateJobPatch(job, { clientAddress: "0x4444444444444444444444444444444444444444" })).toThrow("cannot be changed");
  expect(() => validateJobPatch(job, { permission: { ...permission, spendCap: "99" } })).toThrow("cannot be changed");
});

test("allows only an explicit permission revocation", () => {
  expect(() => validateJobPatch(job, {
    permission: {
      ...permission,
      status: "revoked",
      revokedAt: "2026-08-31T01:00:00.000Z",
      lastUpdatedAt: "2026-08-31T01:00:00.000Z",
    },
  })).not.toThrow();
});

test("does not allow public patches to advance escrow state", () => {
  expect(() => validateJobPatch(job, { status: "active" })).toThrow("managed by the server");
  expect(() => validateJobPatch(job, { status: "submitted" })).toThrow("managed by the server");
  expect(() => validateJobPatch({ ...job, status: "active" }, { status: "failed" })).toThrow("managed by the server");
  expect(() => validateJobPatch(job, { onchainJobId: "7" })).toThrow("cannot be changed");
  expect(() => validateJobPatch(job, {
    statusHistory: [...job.statusHistory, { status: "completed", changedAt: "2026-08-31T01:00:00.000Z" }],
  })).toThrow("failed execution");
  expect(parseJobPatch({ escrow: { status: "completed" } })).toBeUndefined();
});

test("accepts only a valid pending funding broadcast in a job record", () => {
  const pendingJob = {
    ...job,
    onchainJobId: "7",
    escrow: {
      status: "open" as const,
      pendingFundingTransactionHash: `0x${"11".repeat(32)}`,
      pendingFundingAt: "2026-08-31T01:00:00.000Z",
    },
  };

  expect(isJobRecord(pendingJob)).toBe(true);
  expect(isJobRecord({
    ...pendingJob,
    escrow: { ...pendingJob.escrow, pendingFundingTransactionHash: "not-a-transaction" },
  })).toBe(false);
});
