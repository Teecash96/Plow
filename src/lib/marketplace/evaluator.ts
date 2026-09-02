import type { Hex } from "viem";

export const EVALUATOR_PROTOCOL = "plow-evaluator-v1" as const;
export const EMPTY_EVALUATOR_EVIDENCE = "0x" as Hex;

export type EvaluatorDecision = "pending" | "approve" | "reject";
export type EvaluatorState = "pending" | "ready" | "completed" | "rejected" | "expired" | "blocked";
export type EvaluatorOnchainStatus = "open" | "funded" | "submitted" | "completed" | "rejected" | "expired";

export interface JobEvaluatorResult {
  protocol: typeof EVALUATOR_PROTOCOL;
  state: EvaluatorState;
  decision: EvaluatorDecision;
  ready: boolean;
  evidence: Hex;
  reason: Hex;
  onchainStatus: EvaluatorOnchainStatus;
  observedAt: string;
  submittedAt?: string;
  settleAt?: string;
  disputeWindowSeconds?: number;
  disputed: boolean;
  rejectVotes: number;
  rejectQuorum: number;
  message: string;
}

export function evaluatorDecisionFromVerdict(verdict: number): EvaluatorDecision | undefined {
  if (verdict === 0) return "pending";
  if (verdict === 1) return "approve";
  if (verdict === 2) return "reject";
  return undefined;
}

export function evaluatorReadyFromDecision(decision: EvaluatorDecision) {
  return decision === "approve" || decision === "reject";
}

export function evaluatorRefreshDelay(settleAt: string | undefined, now = Date.now()) {
  if (!settleAt) return undefined;
  const settleAtMs = Date.parse(settleAt);
  if (!Number.isFinite(settleAtMs)) return undefined;
  if (settleAtMs <= now) return 30_000;
  return Math.max(1_000, settleAtMs - now + 500);
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value) && value.length % 2 === 0;
}

function isOnchainStatus(value: unknown): value is EvaluatorOnchainStatus {
  return value === "open"
    || value === "funded"
    || value === "submitted"
    || value === "completed"
    || value === "rejected"
    || value === "expired";
}

export function isJobEvaluatorResult(value: unknown): value is JobEvaluatorResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.protocol === EVALUATOR_PROTOCOL
    && (candidate.state === "pending" || candidate.state === "ready" || candidate.state === "completed" || candidate.state === "rejected" || candidate.state === "expired" || candidate.state === "blocked")
    && (candidate.decision === "pending" || candidate.decision === "approve" || candidate.decision === "reject")
    && typeof candidate.ready === "boolean"
    && isHex(candidate.evidence)
    && isHex(candidate.reason)
    && isOnchainStatus(candidate.onchainStatus)
    && typeof candidate.observedAt === "string"
    && (candidate.submittedAt === undefined || typeof candidate.submittedAt === "string")
    && (candidate.settleAt === undefined || typeof candidate.settleAt === "string")
    && (candidate.disputeWindowSeconds === undefined || Number.isSafeInteger(candidate.disputeWindowSeconds))
    && typeof candidate.disputed === "boolean"
    && Number.isSafeInteger(candidate.rejectVotes)
    && Number.isSafeInteger(candidate.rejectQuorum)
    && typeof candidate.message === "string";
}
