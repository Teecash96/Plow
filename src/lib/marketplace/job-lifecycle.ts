import type { Job, JobEscrow, JobEscrowStatus, JobStatus } from "./types";

export type EscrowTransactionEvent = "creation" | "registration" | "budget" | "funding" | "submission" | "dispute" | "settle" | "refund";

export interface EscrowObservation {
  status: JobEscrowStatus;
  transactionHash?: string;
  transactionEvent?: EscrowTransactionEvent;
  deliverableHash?: string;
  submittedAt?: string;
  expiresAt?: string;
  reason?: string;
}

const ESCROW_TRANSITIONS: Record<JobEscrowStatus, readonly JobEscrowStatus[]> = {
  open: ["open", "funded", "rejected"],
  funded: ["funded", "submitted", "rejected", "expired"],
  submitted: ["submitted", "completed", "rejected", "expired"],
  completed: ["completed"],
  rejected: ["rejected"],
  expired: ["expired"],
};

export function assertEscrowTransition(previous: JobEscrowStatus | undefined, next: JobEscrowStatus) {
  if (!previous || previous === next) return true;
  if (!ESCROW_TRANSITIONS[previous].includes(next)) {
    throw new Error(`Escrow status cannot move from ${previous} to ${next}.`);
  }
  return true;
}

function jobStatusForEscrow(status: JobEscrowStatus, current: JobStatus): JobStatus {
  if (status === "open") return current === "draft" ? "draft" : "pending";
  if (status === "funded") return "active";
  if (status === "submitted") return "submitted";
  if (status === "completed") return "completed";
  if (status === "rejected") return "rejected";
  return "expired";
}

function setTransactionHash(
  escrow: JobEscrow,
  event: EscrowTransactionEvent | undefined,
  transactionHash: string,
) {
  if (event === "creation") return { ...escrow, creationTransactionHash: transactionHash };
  if (event === "registration") return { ...escrow, registrationTransactionHash: transactionHash };
  if (event === "budget") return { ...escrow, budgetTransactionHash: transactionHash };
  if (event === "funding") return { ...escrow, fundingTransactionHash: transactionHash };
  if (event === "submission") return { ...escrow, submissionTransactionHash: transactionHash };
  if (event === "dispute") return { ...escrow, disputeTransactionHash: transactionHash };
  if (event === "refund") return { ...escrow, refundTransactionHash: transactionHash };
  if (event === "settle") return { ...escrow, settlementTransactionHash: transactionHash };
  return escrow;
}

function inferredTransactionEvent(status: JobEscrowStatus): EscrowTransactionEvent | undefined {
  if (status === "funded") return "funding";
  if (status === "submitted") return "submission";
  if (status === "completed" || status === "rejected") return "settle";
  if (status === "expired") return "refund";
  return undefined;
}

export function applyEscrowObservation(job: Job, observation: EscrowObservation): Job {
  assertEscrowTransition(job.escrow?.status, observation.status);
  const now = new Date().toISOString();
  let escrow: JobEscrow = {
    ...job.escrow,
    status: observation.status,
    ...(observation.deliverableHash ? { deliverableHash: observation.deliverableHash } : {}),
    ...(observation.submittedAt ? { submittedAt: observation.submittedAt } : {}),
    ...(observation.expiresAt ? { expiresAt: observation.expiresAt } : {}),
    ...(observation.reason ? { reason: observation.reason } : {}),
  };
  if (observation.transactionHash) {
    escrow = setTransactionHash(
      escrow,
      observation.transactionEvent ?? inferredTransactionEvent(observation.status),
      observation.transactionHash,
    );
  }
  if (observation.status === "funded" || observation.status === "submitted" || observation.status === "completed" || observation.status === "rejected" || observation.status === "expired") {
    escrow = {
      ...escrow,
      pendingFundingTransactionHash: undefined,
      pendingFundingAt: undefined,
    };
  }
  if (observation.status === "completed" || observation.status === "rejected" || observation.status === "expired") {
    escrow = { ...escrow, settledAt: escrow.settledAt ?? now };
  }

  const nextStatus = jobStatusForEscrow(observation.status, job.status);
  const statusHistory = nextStatus === job.status
    ? job.statusHistory
    : [
        ...job.statusHistory,
        {
          status: nextStatus,
          changedAt: now,
          note: observation.reason ?? `On chain escrow status changed to ${observation.status}.`,
        },
      ];

  return {
    ...job,
    status: nextStatus,
    updatedAt: now,
    escrow,
    statusHistory,
  };
}
