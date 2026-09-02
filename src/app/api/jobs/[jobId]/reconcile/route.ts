import { NextRequest, NextResponse } from "next/server";
import {
  createBscPublicClient,
  ERC8183_ABI,
  ERC8183_POLICY_ABI,
  ERC8183_ROUTER_ABI,
  getERC8183Config,
} from "@/lib/chain/erc8183-adapter";
import {
  getStoredJob,
  isJobPersistenceConfigured,
  JobMutationError,
  JobPersistenceError,
  reconcileStoredJobLifecycle,
  type StoredJobOnchainBinding,
} from "@/lib/marketplace/job-database";
import type { EscrowTransactionEvent } from "@/lib/marketplace/job-lifecycle";
import { getMarketplaceAgentById } from "@/lib/marketplace/registry";
import {
  JobExecutionVerificationError,
  verifyStoredJobForLifecycle,
} from "@/lib/marketplace/job-execution-verification";
import { verifiedTransactionCallData } from "@/lib/chain/transaction-target";
import { decodeEventLog, decodeFunctionData, type Hex } from "viem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_COOKIE = "plow_job_owner";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const ONCHAIN_JOB_ID_PATTERN = /^(0|[1-9]\d*)$/;
const TRANSACTION_EVENTS = new Set<EscrowTransactionEvent>(["creation", "registration", "budget", "funding", "submission", "dispute", "settle", "refund"]);

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function ownerTokenFromRequest(request: NextRequest) {
  const value = request.cookies.get(OWNER_COOKIE)?.value;
  if (!value || value.length > 256 || /\s/.test(value)) return undefined;
  return value;
}

function addressMatches(left: unknown, right: unknown) {
  return typeof left === "string"
    && typeof right === "string"
    && left.toLowerCase() === right.toLowerCase();
}

function persistenceErrorResponse(error: unknown) {
  if (error instanceof JobMutationError) return errorResponse(error.message, 409);
  if (error instanceof JobPersistenceError) return errorResponse(error.message, 503);
  if (error instanceof JobExecutionVerificationError) {
    return errorResponse(error.message, error.code === "unavailable" || error.code === "not-configured" ? 503 : 409);
  }
  return errorResponse("Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.", 503);
}

function escrowStatus(status: number) {
  if (status === 0) return "open" as const;
  if (status === 1) return "funded" as const;
  if (status === 2) return "submitted" as const;
  if (status === 3) return "completed" as const;
  if (status === 4) return "rejected" as const;
  if (status === 5) return "expired" as const;
  return undefined;
}

function isoTimestamp(value: bigint) {
  return value > BigInt(0) ? new Date(Number(value) * 1000).toISOString() : undefined;
}

function allowedTransactionTarget(event: EscrowTransactionEvent, config: ReturnType<typeof getERC8183Config>) {
  if (event === "registration" || event === "settle") return config.routerAddress;
  if (event === "dispute") return config.policyAddress;
  return config.contractAddress;
}

async function verifyReceipt(
  hash: string,
  event: EscrowTransactionEvent,
  job: Awaited<ReturnType<typeof getStoredJob>>,
  agent: Awaited<ReturnType<typeof getMarketplaceAgentById>>,
) {
  if (!job || !agent) throw new JobMutationError("The job or agent is not available for transaction verification.");
  const config = getERC8183Config();
  const target = allowedTransactionTarget(event, config);
  if (!target) throw new JobExecutionVerificationError("The transaction target is not configured.", "not-configured");
  const publicClient = createBscPublicClient(config.rpcUrl);
  const [receipt, transaction] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: hash as Hex }),
    publicClient.getTransaction({ hash: hash as Hex }),
  ]);
  if (receipt.status !== "success") throw new JobMutationError("The transaction reverted on chain.");
  const callData = verifiedTransactionCallData({
    transaction: { to: transaction.to, input: transaction.input, value: transaction.value },
    receiptTo: receipt.to,
    expectedTarget: target,
  });
  if (!callData) throw new JobMutationError("The transaction targeted the wrong contract.");

  try {
    const abi = event === "registration" || event === "settle"
      ? ERC8183_ROUTER_ABI
      : event === "dispute"
        ? ERC8183_POLICY_ABI
        : ERC8183_ABI;
    const expectedFunction = event === "creation"
      ? "createJob"
      : event === "registration"
      ? "registerJob"
      : event === "settle"
        ? "settle"
        : event === "dispute"
          ? "dispute"
          : event === "budget"
            ? "setBudget"
            : event === "funding"
              ? "fund"
              : event === "submission"
                ? "submit"
                : "claimRefund";
    const decoded = decodeFunctionData({ abi, data: callData });
    if (event === "creation") {
      const [provider, evaluator, , , hook] = decoded.args ?? [];
      if (
        decoded.functionName !== "createJob"
        || !addressMatches(provider, agent.identity.ownerAddress)
        || !addressMatches(evaluator, config.routerAddress)
        || !addressMatches(hook, config.routerAddress)
      ) {
        throw new JobMutationError("The creation transaction does not match the stored provider and evaluator router.");
      }
      let eventMatches = false;
      for (const log of receipt.logs) {
        try {
          const created = decodeEventLog({
            abi: ERC8183_ABI,
            eventName: "JobCreated",
            data: log.data,
            topics: log.topics as [Hex, ...Hex[]],
          });
          if (
            typeof created.args.jobId === "bigint"
            && created.args.jobId.toString() === job.onchainJobId
            && addressMatches(created.args.client, job.clientAddress)
            && addressMatches(created.args.provider, agent.identity.ownerAddress)
          ) {
            eventMatches = true;
            break;
          }
        } catch {
          // A receipt may include unrelated logs. Continue until JobCreated is found.
        }
      }
      if (!eventMatches) throw new JobMutationError("The creation receipt does not contain the stored ERC 8183 job.");
    } else {
      const [transactionJobId, transactionPolicy] = decoded.args ?? [];
      const jobIdMatches = typeof transactionJobId === "bigint" && transactionJobId === BigInt(job.onchainJobId ?? "-1");
      const configuredPolicy = config.policyAddress?.toLowerCase();
      const policyMatches = event !== "registration"
        || typeof transactionPolicy === "string"
        && Boolean(configuredPolicy)
        && transactionPolicy.toLowerCase() === configuredPolicy;
      if (decoded.functionName !== expectedFunction || !jobIdMatches || !policyMatches) {
        throw new JobMutationError("The transaction does not target the stored ERC 8183 job.");
      }
    }
  } catch (error) {
    if (error instanceof JobMutationError) throw error;
    throw new JobMutationError("The transaction call could not be decoded.");
  }

  if (event === "creation" || event === "registration" || event === "budget" || event === "funding" || event === "dispute") {
    if (receipt.from.toLowerCase() !== job.clientAddress.toLowerCase()) throw new JobMutationError("The transaction signer does not match the job client.");
  }
  if (event === "submission") {
    if (!agent.identity.ownerAddress || receipt.from.toLowerCase() !== agent.identity.ownerAddress.toLowerCase()) throw new JobMutationError("The transaction signer does not match the agent provider.");
  }
}

interface ReconcileContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, context: ReconcileContext) {
  if (!isJobPersistenceConfigured()) return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql.", 503);
  const ownerToken = ownerTokenFromRequest(request);
  if (!ownerToken) return errorResponse("Job not found.", 404);

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return errorResponse("The request body must be valid JSON.", 400);
  }
  const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const onchainJobId = input.onchainJobId;
  const transactionHash = input.transactionHash;
  const transactionEvent = input.transactionEvent;
  if (onchainJobId !== undefined && (typeof onchainJobId !== "string" || !ONCHAIN_JOB_ID_PATTERN.test(onchainJobId))) {
    return errorResponse("The on chain job ID is invalid.", 400);
  }
  if (transactionHash !== undefined && (typeof transactionHash !== "string" || !TRANSACTION_HASH_PATTERN.test(transactionHash))) {
    return errorResponse("The transaction hash is invalid.", 400);
  }
  if (transactionEvent !== undefined && (typeof transactionEvent !== "string" || !TRANSACTION_EVENTS.has(transactionEvent as EscrowTransactionEvent))) {
    return errorResponse("The transaction event is invalid.", 400);
  }
  if (transactionHash && !transactionEvent) return errorResponse("A transaction event is required with a transaction hash.", 400);
  if (onchainJobId !== undefined && transactionEvent !== "creation") return errorResponse("A new on chain job ID requires a verified creation transaction.", 400);
  if (transactionEvent === "creation" && onchainJobId !== undefined && !transactionHash) return errorResponse("A creation transaction is required with a new on chain job ID.", 400);

  const { jobId } = await context.params;
  try {
    const job = await getStoredJob(jobId, ownerToken);
    if (!job) return errorResponse("Job not found.", 404);
    const agent = await getMarketplaceAgentById(job.agentId);
    if (!agent) return errorResponse("The agent record is no longer available.", 422);
    const config = getERC8183Config();
    let verificationJob = job;
    let binding: StoredJobOnchainBinding | undefined;
    if (typeof onchainJobId === "string") {
      if (job.onchainJobId && job.onchainJobId !== onchainJobId) return errorResponse("The stored on chain job ID cannot be changed.", 409);
      if (!job.onchainJobId) {
        if (!config.contractAddress) throw new JobExecutionVerificationError("The ERC 8183 contract is not configured.", "not-configured");
        binding = {
          onchainJobId,
          onchainNetwork: config.networkName,
          onchainChainId: config.chainId,
          jobContractAddress: config.contractAddress,
        };
        verificationJob = { ...job, ...binding };
      }
    }
    if (transactionHash && transactionEvent) await verifyReceipt(transactionHash, transactionEvent as EscrowTransactionEvent, verificationJob, agent);

    const verified = await verifyStoredJobForLifecycle(verificationJob, agent);
    const status = escrowStatus(verified.onchainJob.status);
    if (!status) return errorResponse("The ERC 8183 job returned an unknown status.", 409);
    const reconciled = await reconcileStoredJobLifecycle(jobId, ownerToken, {
      status,
      transactionHash: transactionHash as string | undefined,
      transactionEvent: transactionEvent as EscrowTransactionEvent | undefined,
      deliverableHash: status === "submitted" && /^0x[a-fA-F0-9]{64}$/.test(verified.onchainJob.deliverable) ? verified.onchainJob.deliverable : undefined,
      submittedAt: isoTimestamp(verified.onchainJob.submittedAt),
      expiresAt: isoTimestamp(verified.onchainJob.expiredAt),
    }, binding);
    return reconciled ? NextResponse.json({ job: reconciled }, { headers: NO_STORE_HEADERS }) : errorResponse("Job not found.", 404);
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
