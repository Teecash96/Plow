import { NextRequest, NextResponse } from "next/server";
import {
  claimStoredJobExecution,
  completeStoredJobExecution,
  failStoredJobExecution,
  isJobPersistenceConfigured,
  JobPersistenceError,
} from "@/lib/marketplace/job-database";
import { executeAgentJob, AgentExecutionError } from "@/lib/marketplace/agent-execution";
import {
  JobExecutionVerificationError,
  verifyStoredJobForExecution,
  verifyStoredJobSubmission,
} from "@/lib/marketplace/job-execution-verification";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_COOKIE = "plow_job_owner";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function errorResponse(message: string, status: number, job?: unknown) {
  return NextResponse.json(job ? { error: message, job } : { error: message }, { status, headers: NO_STORE_HEADERS });
}

function ownerTokenFromRequest(request: NextRequest) {
  const value = request.cookies.get(OWNER_COOKIE)?.value;
  if (!value || value.length > 256 || /\s/.test(value)) return undefined;
  return value;
}

function persistenceErrorResponse(error: unknown) {
  if (error instanceof JobPersistenceError) return errorResponse(error.message, 503);
  return errorResponse("Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.", 503);
}

function executionErrorStatus(error: AgentExecutionError) {
  if (error.code === "timeout") return 504;
  if (error.code === "permission_denied") return 409;
  if (error.code === "invalid_endpoint" || error.code === "agent_unavailable") return 422;
  return 502;
}

function verificationErrorStatus(error: JobExecutionVerificationError) {
  return error.code === "unavailable" || error.code === "not-configured" ? 503 : 409;
}

interface JobExecuteRouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, context: JobExecuteRouteContext) {
  if (!isJobPersistenceConfigured()) {
    return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql before executing jobs.", 503);
  }

  const ownerToken = ownerTokenFromRequest(request);
  if (!ownerToken) return errorResponse("Job not found.", 404);

  const { jobId } = await context.params;
  let claim;
  try {
    claim = await claimStoredJobExecution(jobId, ownerToken);
  } catch (error) {
    return persistenceErrorResponse(error);
  }

  if (claim.kind === "not-found") return errorResponse("Job not found.", 404);
  if (claim.kind === "already-running") return errorResponse("An agent execution is already in progress.", 409, claim.job);
  if (claim.kind === "already-completed") return NextResponse.json({ job: claim.job }, { headers: NO_STORE_HEADERS });
  if (claim.kind === "not-eligible") return errorResponse("Only paid, active jobs can be executed.", 409, claim.job);

  const { job, attempt } = claim;
  let agent;
  try {
    agent = await getMarketplaceAgentById(job.agentId);
  } catch {
    const failedJob = await failStoredJobExecution(job.id, ownerToken, attempt, "The agent registry could not be reached.").catch(() => undefined);
    return errorResponse("The agent registry could not be reached.", 503, failedJob);
  }

  if (!agent) {
    const failedJob = await failStoredJobExecution(job.id, ownerToken, attempt, "The agent record is no longer available.").catch(() => undefined);
    return errorResponse("The agent record is no longer available.", 422, failedJob);
  }

  try {
    await verifyStoredJobForExecution(job, agent);
  } catch (caught) {
    const error = caught instanceof JobExecutionVerificationError
      ? caught
      : new JobExecutionVerificationError("The on chain job could not be verified.", "unavailable");
    const failedJob = await failStoredJobExecution(job.id, ownerToken, attempt, error.message).catch(() => undefined);
    return errorResponse(error.message, verificationErrorStatus(error), failedJob);
  }

  try {
    const result = await executeAgentJob(job, agent);
    let submission: { deliverableHash: string; submissionTransactionHash: string; submittedAt?: string } | undefined;
    if (result.deliverableHash || result.submissionTransactionHash) {
      if (!result.deliverableHash || !result.submissionTransactionHash) {
        throw new AgentExecutionError("The agent submission was incomplete.", "invalid_result");
      }
      try {
        const verified = await verifyStoredJobSubmission(job, agent, result.deliverableHash, result.submissionTransactionHash);
        submission = {
          deliverableHash: result.deliverableHash,
          submissionTransactionHash: result.submissionTransactionHash,
          submittedAt: verified.onchainJob.submittedAt > BigInt(0)
            ? new Date(Number(verified.onchainJob.submittedAt) * 1000).toISOString()
            : undefined,
        };
      } catch (caught) {
        const error = caught instanceof JobExecutionVerificationError
          ? caught
          : new JobExecutionVerificationError("The provider submission could not be verified.", "unavailable");
        const failedJob = await failStoredJobExecution(job.id, ownerToken, attempt, error.message).catch(() => undefined);
        return errorResponse(error.message, verificationErrorStatus(error), failedJob);
      }
    }
    const completedJob = await completeStoredJobExecution(job.id, ownerToken, attempt, result, submission);
    if (!completedJob) return errorResponse("The execution attempt is no longer active. Try again.", 409);
    return NextResponse.json({ job: completedJob }, { headers: NO_STORE_HEADERS });
  } catch (caught) {
    console.error("[jobs] agent execution failed", {
      jobId: job.id,
      attempt,
      error: caught instanceof Error ? caught.message.slice(0, 500) : "Unknown agent execution error.",
    });
    const error = caught instanceof AgentExecutionError
      ? caught
      : new AgentExecutionError("The agent execution failed.", "request_failed");
    const failedJob = await failStoredJobExecution(job.id, ownerToken, attempt, error.message).catch(() => undefined);
    return errorResponse(error.message, executionErrorStatus(error), failedJob);
  }
}
