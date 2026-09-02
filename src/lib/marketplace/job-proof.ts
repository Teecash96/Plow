import type { Job, JobSimulationStep } from "./types";

export type JobProofEventState = "verified" | "simulated" | "pending" | "failed";

export interface JobProofEvent {
  id: string;
  label: string;
  state: JobProofEventState;
  occurredAt: string;
  detail: string;
  transactionHash?: string;
  explorerUrl?: string;
}

const TRANSACTION_FIELDS = [
  ["creationTransactionHash", "ERC 8183 job created"],
  ["registrationTransactionHash", "Evaluator registered"],
  ["budgetTransactionHash", "Escrow budget configured"],
  ["fundingTransactionHash", "Escrow funded"],
  ["submissionTransactionHash", "Deliverable submitted"],
  ["disputeTransactionHash", "Result disputed"],
  ["settlementTransactionHash", "Job settled"],
  ["refundTransactionHash", "Escrow refunded"],
] as const;

const STATUS_LABELS: Record<Job["status"], string> = {
  draft: "Job drafted",
  pending: "Job pending",
  active: "Job active",
  submitted: "Job submitted",
  completed: "Job completed",
  rejected: "Job rejected",
  expired: "Job expired",
  failed: "Execution failed",
  cancelled: "Job cancelled",
};

function isTransactionHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function explorerHost(job: Job) {
  return job.onchainNetwork === "BSC Testnet" ? "https://testnet.bscscan.com" : "https://bscscan.com";
}

function simulationEvent(step: JobSimulationStep): JobProofEvent {
  return {
    id: `simulation-${step.id}`,
    label: step.label,
    state: "simulated",
    occurredAt: step.completedAt,
    detail: step.detail,
  };
}

function liveStatusState(job: Job, status: Job["status"]): JobProofEventState {
  if (status === "failed" || status === "rejected" || status === "cancelled") return "failed";
  return job.onchainJobId ? "verified" : "pending";
}

export function getJobProofEvents(job: Job): readonly JobProofEvent[] {
  if (job.mode === "simulation" || job.simulation) {
    return (job.simulation?.steps ?? []).map(simulationEvent);
  }

  const events: JobProofEvent[] = [
    {
      id: "job-record",
      label: "Job record created",
      state: job.onchainJobId ? "verified" : "pending",
      occurredAt: job.createdAt,
      detail: job.onchainJobId
        ? "The job record is linked to an ERC 8183 job."
        : "A local draft exists, but no on chain job is linked.",
    },
  ];

  for (const [index, entry] of job.statusHistory.entries()) {
    events.push({
      id: `status-${index}-${entry.status}`,
      label: STATUS_LABELS[entry.status],
      state: liveStatusState(job, entry.status),
      occurredAt: entry.changedAt,
      detail: entry.note ?? "Status recorded by Plow.",
    });
  }

  const paymentHash = job.payment?.transactionHash;
  events.push({
    id: "x402-payment",
    label: "x402 payment",
    state: job.payment?.status === "paid" && isTransactionHash(paymentHash)
      ? "verified"
      : job.payment?.status === "unavailable"
        ? "failed"
        : "pending",
    occurredAt: job.payment?.paidAt ?? job.updatedAt,
    detail: job.payment?.status === "paid" && isTransactionHash(paymentHash)
      ? "The x402 payment receipt was recorded with a transaction hash."
      : "The x402 payment transaction is not confirmed in this record.",
    ...(isTransactionHash(paymentHash)
      ? { transactionHash: paymentHash, explorerUrl: `${explorerHost(job)}/tx/${paymentHash}` }
      : {}),
  });

  for (const [field, label] of TRANSACTION_FIELDS) {
    const hash = job.escrow?.[field];
    if (!hash) continue;
    const transactionHash = isTransactionHash(hash) ? hash : undefined;
    events.push({
      id: `escrow-${field}`,
      label,
      state: transactionHash ? "verified" : "failed",
      occurredAt: job.escrow?.submittedAt ?? job.escrow?.settledAt ?? job.updatedAt,
      detail: transactionHash ? "The escrow transaction reference was recorded." : "The escrow transaction reference is invalid.",
      ...(transactionHash ? { transactionHash, explorerUrl: `${explorerHost(job)}/tx/${transactionHash}` } : {}),
    });
  }

  const pendingFundingHash = job.escrow?.pendingFundingTransactionHash;
  if (pendingFundingHash) {
    const transactionHash = isTransactionHash(pendingFundingHash) ? pendingFundingHash : undefined;
    events.push({
      id: "escrow-pending-funding",
      label: "Escrow funding broadcast",
      state: "pending",
      occurredAt: job.escrow?.pendingFundingAt ?? job.updatedAt,
      detail: "The funding transaction was broadcast but its receipt is not confirmed. Verify it before retrying.",
      ...(transactionHash ? { transactionHash, explorerUrl: `${explorerHost(job)}/tx/${transactionHash}` } : {}),
    });
  }

  if (job.execution) {
    events.push({
      id: "agent-execution",
      label: "Agent execution",
      state: job.execution.status === "completed" ? "verified" : job.execution.status === "failed" ? "failed" : "pending",
      occurredAt: job.execution.completedAt ?? job.execution.startedAt,
      detail: job.execution.status === "completed"
        ? "The provider returned a completed result."
        : job.execution.error ?? "The provider is working on the task.",
    });
  }

  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const time = Date.parse(left.event.occurredAt) - Date.parse(right.event.occurredAt);
      return time || left.index - right.index;
    })
    .map(({ event }) => event);
}
