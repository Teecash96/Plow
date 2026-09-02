import { NextRequest, NextResponse } from "next/server";
import {
  createBscPublicClient,
  ERC8183_STATUS,
  getERC8183Config,
  readERC8183PolicyState,
} from "@/lib/chain/erc8183-adapter";
import {
  EMPTY_EVALUATOR_EVIDENCE,
  evaluatorDecisionFromVerdict,
  evaluatorReadyFromDecision,
  EVALUATOR_PROTOCOL,
  type EvaluatorOnchainStatus,
  type JobEvaluatorResult,
} from "@/lib/marketplace/evaluator";
import {
  getStoredJob,
  isJobPersistenceConfigured,
  JobMutationError,
  JobPersistenceError,
  reconcileStoredJobLifecycle,
} from "@/lib/marketplace/job-database";
import {
  JobExecutionVerificationError,
  verifyStoredJobForLifecycle,
} from "@/lib/marketplace/job-execution-verification";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_COOKIE = "plow_job_owner";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function ownerTokenFromRequest(request: NextRequest) {
  const value = request.cookies.get(OWNER_COOKIE)?.value;
  if (!value || value.length > 256 || /\s/.test(value)) return undefined;
  return value;
}

function persistenceErrorResponse(error: unknown) {
  if (error instanceof JobMutationError) return errorResponse(error.message, 409);
  if (error instanceof JobPersistenceError) return errorResponse(error.message, 503);
  if (error instanceof JobExecutionVerificationError) {
    return errorResponse(error.message, error.code === "unavailable" || error.code === "not-configured" ? 503 : 409);
  }
  return errorResponse("The evaluator could not verify the job.", 503);
}

function onchainStatus(value: number): EvaluatorOnchainStatus | undefined {
  if (value === ERC8183_STATUS.open) return "open";
  if (value === ERC8183_STATUS.funded) return "funded";
  if (value === ERC8183_STATUS.submitted) return "submitted";
  if (value === ERC8183_STATUS.completed) return "completed";
  if (value === ERC8183_STATUS.rejected) return "rejected";
  if (value === ERC8183_STATUS.expired) return "expired";
  return undefined;
}

function safeNumber(value: bigint | number, label: string) {
  const result = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(result)) throw new JobExecutionVerificationError(`The evaluator returned an invalid ${label}.`, "mismatch");
  return result;
}

function isoTimestamp(value: bigint, label: string) {
  const seconds = safeNumber(value, label);
  if (seconds <= 0) return undefined;
  return new Date(seconds * 1_000).toISOString();
}

function readyMessage(decision: "approve" | "reject") {
  return decision === "approve"
    ? "The evaluator approved this result. Settlement is ready for the client wallet."
    : "The evaluator rejected this result. Settlement is ready to return the escrow to the client.";
}

function pendingMessage(settleAt: string | undefined) {
  return settleAt
    ? `The evaluator policy is still pending. Settlement unlocks at ${settleAt}.`
    : "The evaluator policy is still pending. Settlement is not available yet.";
}

function terminalMessage(status: EvaluatorOnchainStatus) {
  if (status === "completed") return "This job is already completed on chain.";
  if (status === "rejected") return "This job is already rejected on chain.";
  return "This job is already expired on chain.";
}

function buildResult(input: {
  state: JobEvaluatorResult["state"];
  decision: JobEvaluatorResult["decision"];
  ready: boolean;
  reason: `0x${string}`;
  onchainStatus: EvaluatorOnchainStatus;
  observedAt: string;
  submittedAt?: string;
  settleAt?: string;
  disputeWindowSeconds?: number;
  disputed: boolean;
  rejectVotes: number;
  rejectQuorum: number;
  message: string;
}): JobEvaluatorResult {
  return {
    protocol: EVALUATOR_PROTOCOL,
    ...input,
    evidence: EMPTY_EVALUATOR_EVIDENCE,
  };
}

interface EvaluateRouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, context: EvaluateRouteContext) {
  if (!isJobPersistenceConfigured()) {
    return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql.", 503);
  }

  const ownerToken = ownerTokenFromRequest(request);
  if (!ownerToken) return errorResponse("Job not found.", 404);

  const { jobId } = await context.params;
  try {
    const job = await getStoredJob(jobId, ownerToken);
    if (!job) return errorResponse("Job not found.", 404);
    if (!job.onchainJobId || !job.jobContractAddress) return errorResponse("The job has no verified on chain binding.", 409);

    const agent = await getMarketplaceAgentById(job.agentId);
    if (!agent) return errorResponse("The agent record is no longer available.", 422);

    const verified = await verifyStoredJobForLifecycle(job, agent);
    const status = onchainStatus(verified.onchainJob.status);
    if (!status) return errorResponse("The ERC 8183 job returned an unknown status.", 409);

    const publicClient = createBscPublicClient(getERC8183Config().rpcUrl);
    const policy = await readERC8183PolicyState(publicClient, BigInt(job.onchainJobId));
    const observedAt = isoTimestamp(policy.blockTimestamp, "observation timestamp");
    if (!observedAt) throw new JobExecutionVerificationError("The evaluator returned no observation timestamp.", "mismatch");

    const submittedAt = isoTimestamp(policy.submittedAt, "submission timestamp");
    const disputeWindowSeconds = safeNumber(policy.disputeWindow, "dispute window");
    const settleAtSeconds = policy.submittedAt + policy.disputeWindow;
    const settleAt = isoTimestamp(settleAtSeconds, "settlement timestamp");
    const rejectVotes = safeNumber(policy.rejectVotes, "reject vote count");
    const rejectQuorum = safeNumber(policy.disputeQuorum, "reject quorum");
    const onchainState = {
      submittedAt,
      settleAt,
      disputeWindowSeconds,
      disputed: policy.disputed,
      rejectVotes,
      rejectQuorum,
    };

    if (status === "completed" || status === "rejected" || status === "expired") {
      const reconciled = await reconcileStoredJobLifecycle(job.id, ownerToken, {
        status,
        submittedAt,
        expiresAt: isoTimestamp(verified.onchainJob.expiredAt, "expiry timestamp"),
      });
      const finalJob = reconciled ?? job;
      const terminalDecision = status === "completed" ? "approve" : status === "rejected" ? "reject" : "pending";
      const evaluation = buildResult({
        ...onchainState,
        state: status,
        decision: terminalDecision,
        ready: false,
        reason: policy.reason,
        onchainStatus: status,
        observedAt,
        message: terminalMessage(status),
      });
      return NextResponse.json({ evaluation, job: finalJob }, { headers: NO_STORE_HEADERS });
    }

    if (status !== "submitted") {
      return errorResponse("The evaluator requires a submitted provider result before settlement.", 409);
    }
    if (job.execution?.status !== "completed" || !job.resultSummary || !job.escrow?.deliverableHash) {
      return errorResponse("The evaluator requires a completed provider result and verified deliverable.", 409);
    }

    const decision = evaluatorDecisionFromVerdict(policy.verdict);
    if (!decision) return errorResponse("The evaluator returned an unknown verdict.", 503);
    const ready = evaluatorReadyFromDecision(decision);
    const evaluation = buildResult({
      ...onchainState,
      state: ready ? "ready" : "pending",
      decision,
      ready,
      reason: policy.reason,
      onchainStatus: status,
      observedAt,
      message: ready ? readyMessage(decision) : pendingMessage(settleAt),
    });
    return NextResponse.json({ evaluation, job }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
