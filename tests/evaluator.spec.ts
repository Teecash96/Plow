import { expect, test } from "@playwright/test";
import {
  evaluatorDecisionFromVerdict,
  evaluatorRefreshDelay,
  evaluatorReadyFromDecision,
  isJobEvaluatorResult,
} from "@/lib/marketplace/evaluator";

test("maps the deployed optimistic policy verdicts", () => {
  expect(evaluatorDecisionFromVerdict(0)).toBe("pending");
  expect(evaluatorDecisionFromVerdict(1)).toBe("approve");
  expect(evaluatorDecisionFromVerdict(2)).toBe("reject");
  expect(evaluatorDecisionFromVerdict(3)).toBeUndefined();
  expect(evaluatorReadyFromDecision("pending")).toBe(false);
  expect(evaluatorReadyFromDecision("approve")).toBe(true);
  expect(evaluatorReadyFromDecision("reject")).toBe(true);
});

test("schedules one evaluator refresh at the unlock time without tight polling", () => {
  const now = Date.parse("2026-09-02T00:00:00.000Z");
  expect(evaluatorRefreshDelay("2026-09-08T18:12:04.000Z", now)).toBe(
    Date.parse("2026-09-08T18:12:04.000Z") - now + 500,
  );
  expect(evaluatorRefreshDelay("2026-09-01T00:00:00.000Z", now)).toBe(30_000);
  expect(evaluatorRefreshDelay("not-a-date", now)).toBeUndefined();
  expect(evaluatorRefreshDelay(undefined, now)).toBeUndefined();
});

test("accepts only a complete evaluator response shape", () => {
  const result = {
    protocol: "plow-evaluator-v1",
    state: "pending",
    decision: "pending",
    ready: false,
    evidence: "0x",
    reason: `0x${"00".repeat(32)}`,
    onchainStatus: "submitted",
    observedAt: "2026-09-01T00:00:00.000Z",
    submittedAt: "2026-08-31T00:00:00.000Z",
    settleAt: "2026-09-07T00:00:00.000Z",
    disputeWindowSeconds: 604800,
    disputed: false,
    rejectVotes: 0,
    rejectQuorum: 0,
    message: "The evaluator policy is still pending.",
  };

  expect(isJobEvaluatorResult(result)).toBe(true);
  expect(isJobEvaluatorResult({ ...result, evidence: "not-hex" })).toBe(false);
  expect(isJobEvaluatorResult({ ...result, rejectVotes: 1.5 })).toBe(false);
});
