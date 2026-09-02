import { expect, test } from "@playwright/test";
import { getHireResumeMode } from "@/lib/marketplace/hire-resume";

const openPendingJob = {
  status: "pending" as const,
  onchainJobId: "56685",
  escrow: { status: "open" as const },
  payment: { protocol: "x402" as const, status: "pending" as const, amount: "0.25", currency: "U" },
};

test("resumes an unpaid open escrow through payment and funding", () => {
  expect(getHireResumeMode(openPendingJob)).toBe("payment-and-funding");
});

test("resumes a paid open escrow through funding without another payment", () => {
  expect(getHireResumeMode({
    ...openPendingJob,
    payment: { ...openPendingJob.payment, status: "paid", transactionHash: `0x${"11".repeat(32)}` },
  })).toBe("funding-only");
});

test("keeps a paid escrow with a pending funding hash in funding recovery", () => {
  expect(getHireResumeMode({
    ...openPendingJob,
    payment: { ...openPendingJob.payment, status: "paid", transactionHash: `0x${"11".repeat(32)}` },
    escrow: {
      status: "open",
      pendingFundingTransactionHash: `0x${"22".repeat(32)}`,
      pendingFundingAt: "2026-08-31T00:00:00.000Z",
    },
  })).toBe("funding-only");
});

test("does not resume closed, missing, or unavailable payment state", () => {
  expect(getHireResumeMode({ ...openPendingJob, status: "active" })).toBeUndefined();
  expect(getHireResumeMode({ ...openPendingJob, onchainJobId: undefined })).toBeUndefined();
  expect(getHireResumeMode({ ...openPendingJob, escrow: { status: "funded" } })).toBeUndefined();
  expect(getHireResumeMode({ ...openPendingJob, payment: { ...openPendingJob.payment, status: "unavailable" } })).toBeUndefined();
});
