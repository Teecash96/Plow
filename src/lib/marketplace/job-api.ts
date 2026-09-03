import type { FundMovingAction, Job } from "./types";
import type { EscrowTransactionEvent } from "./job-lifecycle";
import { isJobEvaluatorResult, type JobEvaluatorResult } from "./evaluator";

export type RemoteJobPatch = Partial<Omit<Job, "id" | "createdAt" | "updatedAt">>;

export class JobApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "JobApiError";
    this.status = status;
  }
}

export class JobPersistenceUnavailableError extends JobApiError {
  constructor(message: string) {
    super(message, 503);
    this.name = "JobPersistenceUnavailableError";
  }
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Use the status message below when the server did not return JSON.
  }
  return `Jobs API request failed with status ${response.status}.`;
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new JobPersistenceUnavailableError("The jobs service could not be reached. The local record was kept.");
  }

  if (!response.ok) {
    const message = await responseMessage(response);
    if (response.status === 503) throw new JobPersistenceUnavailableError(message);
    throw new JobApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

function isJob(value: unknown): value is Job {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string";
}

export async function listRemoteJobs() {
  const body = await request<{ jobs?: unknown }>("/api/jobs");
  return Array.isArray(body.jobs) ? body.jobs.filter(isJob) : [];
}

export async function getRemoteJob(jobId: string) {
  try {
    const body = await request<{ job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}`);
    return isJob(body.job) ? body.job : undefined;
  } catch (error) {
    if (error instanceof JobApiError && error.status === 404) return undefined;
    throw error;
  }
}

export async function createRemoteJob(job: Job) {
  const body = await request<{ job?: unknown }>("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job }),
  });
  if (!isJob(body.job)) throw new JobApiError("The jobs service returned an invalid job record.", 502);
  return body.job;
}

export async function updateRemoteJob(jobId: string, patch: RemoteJobPatch) {
  const body = await request<{ job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch }),
  });
  if (!isJob(body.job)) throw new JobApiError("The jobs service returned an invalid job record.", 502);
  return body.job;
}

export async function recordFundingBroadcastRemoteJob(jobId: string, transactionHash: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const body = await request<{ job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}/funding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionHash }),
      });
      if (!isJob(body.job)) throw new JobApiError("The jobs service returned an invalid funding broadcast record.", 502);
      return body.job;
    } catch (error) {
      if (!(error instanceof JobPersistenceUnavailableError) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 250));
    }
  }

  throw new JobApiError("The jobs service could not record the funding broadcast.", 503);
}

export async function recoverRemoteFunding(jobId: string, transactionHash: string) {
  const body = await request<{ job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}/funding/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionHash }),
  });
  if (!isJob(body.job)) throw new JobApiError("The jobs service returned an invalid funding recovery record.", 502);
  return body.job;
}

export async function reconcileRemoteJob(
  jobId: string,
  input?: { onchainJobId?: string; transactionHash?: string; transactionEvent?: EscrowTransactionEvent },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const body = await request<{ job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input ?? {}),
      });
      if (!isJob(body.job)) throw new JobApiError("The jobs service returned an invalid reconciled job record.", 502);
      return body.job;
    } catch (error) {
      if (!(error instanceof JobPersistenceUnavailableError) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 250));
    }
  }

  throw new JobApiError("The jobs service could not reconcile the job.", 503);
}

export async function executeRemoteJob(jobId: string) {
  const body = await request<{ job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!isJob(body.job)) throw new JobApiError("The jobs service returned an invalid execution record.", 502);
  return body.job;
}

export async function evaluateRemoteJob(jobId: string) {
  const body = await request<{ evaluation?: unknown; job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!isJobEvaluatorResult(body.evaluation)) {
    throw new JobApiError("The evaluator service returned an invalid decision.", 502);
  }
  return {
    evaluation: body.evaluation as JobEvaluatorResult,
    job: isJob(body.job) ? body.job : undefined,
  };
}

export type RemotePancakeSwapReservation = Omit<FundMovingAction, "status" | "reservedAt">;

export async function reserveRemotePancakeSwapAction(jobId: string, action: RemotePancakeSwapReservation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const body = await request<{ job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}/pancakeswap-rebalance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reserve", ...action }),
      });
      if (!isJob(body.job)) throw new JobApiError("The jobs service returned an invalid PancakeSwap reservation.", 502);
      return body.job;
    } catch (error) {
      if (!(error instanceof JobPersistenceUnavailableError) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 250));
    }
  }

  throw new JobApiError("The jobs service could not reserve the PancakeSwap action.", 503);
}

export async function recordRemotePancakeSwapAction(
  jobId: string,
  action:
    | { action: "approval-submitted"; approvalTransactionHash: string }
    | { action: "swap-submitted"; transactionHash: string; approvalTransactionHash?: string }
    | { action: "confirmed"; transactionHash: string }
    | { action: "release"; failureReason: string },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const body = await request<{ job?: unknown }>(`/api/jobs/${encodeURIComponent(jobId)}/pancakeswap-rebalance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!isJob(body.job)) throw new JobApiError("The jobs service returned an invalid PancakeSwap action record.", 502);
      return body.job;
    } catch (error) {
      if (!(error instanceof JobPersistenceUnavailableError) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 250));
    }
  }

  throw new JobApiError("The jobs service could not record the PancakeSwap action.", 503);
}
