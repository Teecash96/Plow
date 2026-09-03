import { NextRequest, NextResponse } from "next/server";
import { TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex } from "viem";
import {
  createBscPublicClient,
  ERC8183_STATUS,
  getERC8183Config,
} from "@/lib/chain/erc8183-adapter";
import {
  getStoredJob,
  isJobPersistenceConfigured,
  JobMutationError,
  JobPersistenceError,
  recoverStoredFundingBroadcast,
} from "@/lib/marketplace/job-database";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";
import {
  JobExecutionVerificationError,
  verifyStoredJobForLifecycle,
} from "@/lib/marketplace/job-execution-verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_COOKIE = "plow_job_owner";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

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
  return errorResponse("Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.", 503);
}

async function assertFundingHashAbsent(hash: string) {
  const config = getERC8183Config();
  const publicClient = createBscPublicClient(config.rpcUrl);
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex });
    if (receipt) throw new JobMutationError("The funding transaction has a receipt. Refresh the job instead of retrying it.");
  } catch (error) {
    if (!(error instanceof TransactionReceiptNotFoundError) && !(error instanceof JobMutationError)) {
      throw new JobExecutionVerificationError("The BSC RPC could not verify the funding transaction receipt.", "unavailable");
    }
    if (error instanceof JobMutationError) throw error;
  }

  try {
    const transaction = await publicClient.getTransaction({ hash: hash as Hex });
    if (transaction) throw new JobMutationError("The funding transaction is still visible on the network. Do not retry it.");
  } catch (error) {
    if (!(error instanceof TransactionNotFoundError) && !(error instanceof JobMutationError)) {
      throw new JobExecutionVerificationError("The BSC RPC could not verify whether the funding transaction is still present.", "unavailable");
    }
    if (error instanceof JobMutationError) throw error;
  }
}

interface RecoveryRouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, context: RecoveryRouteContext) {
  if (!isJobPersistenceConfigured()) return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql.", 503);
  const ownerToken = ownerTokenFromRequest(request);
  if (!ownerToken) return errorResponse("Job not found.", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("The request body must be valid JSON.", 400);
  }
  const transactionHash = typeof body === "object" && body !== null && "transactionHash" in body
    ? body.transactionHash
    : undefined;
  if (typeof transactionHash !== "string" || !TRANSACTION_HASH_PATTERN.test(transactionHash)) {
    return errorResponse("A valid funding transaction hash is required.", 400);
  }

  const { jobId } = await context.params;
  try {
    const job = await getStoredJob(jobId, ownerToken);
    if (!job) return errorResponse("Job not found.", 404);
    if (job.escrow?.pendingFundingTransactionHash?.toLowerCase() !== transactionHash.toLowerCase()) {
      throw new JobMutationError("The funding hash does not match the pending broadcast.");
    }
    const agent = await getMarketplaceAgentById(job.agentId);
    if (!agent) return errorResponse("The agent record is no longer available.", 422);

    const config = getERC8183Config();
    if (!config.enabled) throw new JobExecutionVerificationError(config.reason ?? "ERC 8183 is not configured.", "not-configured");
    const verified = await verifyStoredJobForLifecycle(job, agent);
    if (verified.onchainJob.status !== ERC8183_STATUS.open) {
      throw new JobMutationError("The on chain escrow is no longer open. Refresh the job before retrying.");
    }
    await assertFundingHashAbsent(transactionHash);

    const recovered = await recoverStoredFundingBroadcast(jobId, ownerToken, transactionHash);
    return recovered
      ? NextResponse.json({ job: recovered }, { headers: NO_STORE_HEADERS })
      : errorResponse("Job not found.", 404);
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
