import { NextRequest, NextResponse } from "next/server";
import { decodeFunctionData, isAddress, type Address, type Hex } from "viem";
import {
  createBscPublicClient,
  getERC8183Config,
} from "@/lib/chain/erc8183-adapter";
import {
  assertPancakeSwapRebalancePolicy,
  getPancakeSwapRebalanceConfig,
  PANCAKESWAP_V2_ROUTER_ABI,
  quotePancakeSwapRebalanceAtomic,
} from "@/lib/chain/pancakeswap-rebalance";
import {
  getStoredJob,
  isJobPersistenceConfigured,
  JobMutationError,
  JobPersistenceError,
  recordStoredPancakeSwapActionProgress,
  reserveStoredPancakeSwapAction,
  type FundMovingActionProgress,
  type FundMovingActionReservationInput,
} from "@/lib/marketplace/job-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_COOKIE = "plow_job_owner";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

interface JobRouteContext {
  params: Promise<{ jobId: string }>;
}

interface ReserveRequest {
  action: "reserve";
  kind: "pancakeswap-rebalance";
  chainId: 56 | 97;
  routerAddress: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  amountInAtomic: string;
  quotedAmountOutAtomic: string;
  minimumAmountOutAtomic: string;
  slippageBps: number;
  deadline: string;
  quotedAt: string;
}

function errorResponse(message: string, status: number, job?: unknown) {
  return NextResponse.json(job ? { error: message, job } : { error: message }, { status, headers: NO_STORE_HEADERS });
}

function ownerTokenFromRequest(request: NextRequest) {
  const value = request.cookies.get(OWNER_COOKIE)?.value;
  if (!value || value.length > 256 || /\s/.test(value)) return undefined;
  return value;
}

function persistenceErrorResponse(error: unknown) {
  if (error instanceof JobMutationError) return errorResponse(error.message, 409);
  if (error instanceof JobPersistenceError) return errorResponse(error.message, 503);
  return errorResponse("Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.", 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAtomicString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > BigInt(0);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseReserveRequest(value: unknown): ReserveRequest | undefined {
  if (!isRecord(value)
    || value.action !== "reserve"
    || value.kind !== "pancakeswap-rebalance"
    || (value.chainId !== 56 && value.chainId !== 97)
    || typeof value.routerAddress !== "string"
    || typeof value.tokenInAddress !== "string"
    || typeof value.tokenOutAddress !== "string"
    || !isAddress(value.routerAddress)
    || !isAddress(value.tokenInAddress)
    || !isAddress(value.tokenOutAddress)
    || typeof value.tokenInSymbol !== "string"
    || typeof value.tokenOutSymbol !== "string"
    || !value.tokenInSymbol.trim()
    || !value.tokenOutSymbol.trim()
    || !Number.isInteger(value.tokenInDecimals)
    || Number(value.tokenInDecimals) < 0
    || Number(value.tokenInDecimals) > 255
    || !Number.isInteger(value.tokenOutDecimals)
    || Number(value.tokenOutDecimals) < 0
    || Number(value.tokenOutDecimals) > 255
    || !isAtomicString(value.amountInAtomic)
    || !isAtomicString(value.quotedAmountOutAtomic)
    || !isAtomicString(value.minimumAmountOutAtomic)
    || !Number.isInteger(value.slippageBps)
    || !isAtomicString(value.deadline)
    || !isTimestamp(value.quotedAt)) {
    return undefined;
  }
  return {
    action: "reserve",
    kind: "pancakeswap-rebalance",
    chainId: Number(value.chainId) as 56 | 97,
    routerAddress: value.routerAddress as string,
    tokenInAddress: value.tokenInAddress as string,
    tokenOutAddress: value.tokenOutAddress as string,
    tokenInSymbol: value.tokenInSymbol as string,
    tokenOutSymbol: value.tokenOutSymbol as string,
    tokenInDecimals: Number(value.tokenInDecimals),
    tokenOutDecimals: Number(value.tokenOutDecimals),
    amountInAtomic: value.amountInAtomic as string,
    quotedAmountOutAtomic: value.quotedAmountOutAtomic as string,
    minimumAmountOutAtomic: value.minimumAmountOutAtomic as string,
    slippageBps: Number(value.slippageBps),
    deadline: value.deadline as string,
    quotedAt: value.quotedAt as string,
  };
}

function timestampIsFresh(value: string) {
  const timestamp = Date.parse(value);
  return timestamp <= Date.now() + 10_000 && Date.now() - timestamp <= 2 * 60 * 1000;
}

async function verifyConfirmedSwap(jobId: string, txHash: string, ownerToken: string) {
  const job = await getStoredJob(jobId, ownerToken);
  if (!job) throw new Error("Job not found.");
  const action = job.fundMovingAction;
  if (!action || action.status !== "swap-submitted" || action.transactionHash !== txHash) {
    throw new Error("The confirmed transaction does not match the reserved PancakeSwap action.");
  }
  if (!isAddress(job.clientAddress)) throw new Error("The job client wallet address is invalid.");
  const config = getPancakeSwapRebalanceConfig();
  const ercConfig = getERC8183Config();
  if (!config.enabled || action.chainId !== config.chainId) throw new Error("The PancakeSwap action configuration changed before confirmation.");
  const publicClient = createBscPublicClient(ercConfig.rpcUrl);
  const [transaction, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: txHash as Hex }),
    publicClient.getTransactionReceipt({ hash: txHash as Hex }),
  ]);
  if (!transaction || !receipt) throw new Error("The swap transaction is not available on the selected BSC network yet.");
  if (receipt.status !== "success") throw new Error("The PancakeSwap rebalance transaction reverted.");
  if (transaction.chainId !== undefined && transaction.chainId !== action.chainId) throw new Error("The swap transaction is on the wrong BSC network.");
  if (!transaction.to || transaction.to.toLowerCase() !== action.routerAddress.toLowerCase()) throw new Error("The confirmed transaction target does not match the configured PancakeSwap router.");
  if (transaction.from.toLowerCase() !== job.clientAddress.toLowerCase()) throw new Error("The confirmed transaction sender does not match the job client wallet.");
  if (transaction.value !== undefined && transaction.value !== BigInt(0)) throw new Error("The confirmed PancakeSwap transaction sent native value.");

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: PANCAKESWAP_V2_ROUTER_ABI, data: transaction.input });
  } catch {
    throw new Error("The confirmed transaction does not call the supported PancakeSwap swap function.");
  }
  if (decoded.functionName !== "swapExactTokensForTokens") throw new Error("The confirmed transaction does not call the supported PancakeSwap swap function.");
  const args = decoded.args;
  if (!args) throw new Error("The confirmed PancakeSwap call has no arguments.");
  const path = args[2] as readonly string[];
  const actualDeadline = args[4] as bigint;
  if (args[0] !== BigInt(action.amountInAtomic)
    || args[1] !== BigInt(action.minimumAmountOutAtomic)
    || path.length !== 2
    || path[0]?.toLowerCase() !== action.tokenInAddress.toLowerCase()
    || path[1]?.toLowerCase() !== action.tokenOutAddress.toLowerCase()
    || (args[3] as string).toLowerCase() !== job.clientAddress.toLowerCase()
    || actualDeadline > BigInt(Math.floor(Date.now() / 1000) + 5 * 60)) {
    throw new Error("The confirmed PancakeSwap call does not match the reserved amount, path, recipient, or deadline.");
  }
  return job;
}

async function reserveAction(jobId: string, ownerToken: string, body: unknown) {
  const request = parseReserveRequest(body);
  if (!request) return errorResponse("The PancakeSwap reservation is invalid.", 400);
  if (!timestampIsFresh(request.quotedAt)) return errorResponse("The quote expired. Refresh it before reserving the action.", 409);

  const config = getPancakeSwapRebalanceConfig();
  if (!config.enabled) return errorResponse(config.reason ?? "PancakeSwap rebalance is disabled.", 409);
  const job = await getStoredJob(jobId, ownerToken);
  if (!job) return errorResponse("Job not found.", 404);
  if (job.mode === "simulation" || job.category !== "rebalancing" || job.status !== "active" || !job.onchainJobId || job.payment?.status !== "paid" || !job.permission) {
    return errorResponse("Only a paid, active rebalancing job can reserve a PancakeSwap action.", 409, job);
  }
  if (!isAddress(job.clientAddress)) return errorResponse("The job client wallet address is invalid.", 409, job);
  if (request.chainId !== config.chainId || job.onchainChainId && job.onchainChainId !== request.chainId) {
    return errorResponse(`The action network must be ${config.networkName} (chain ${config.chainId}).`, 409, job);
  }
  if (request.slippageBps !== config.maxSlippageBps) return errorResponse("The requested slippage does not match the configured safety limit.", 409, job);
  if (request.routerAddress.toLowerCase() !== config.routerAddress?.toLowerCase() || request.tokenInAddress.toLowerCase() !== config.tokenInAddress?.toLowerCase() || request.tokenOutAddress.toLowerCase() !== config.tokenOutAddress?.toLowerCase()) {
    return errorResponse("The requested PancakeSwap pair does not match the configured fixed pair.", 409, job);
  }

  const ercConfig = getERC8183Config();
  const publicClient = createBscPublicClient(ercConfig.rpcUrl);
  let chainQuote;
  try {
    chainQuote = await quotePancakeSwapRebalanceAtomic({
      publicClient,
      permission: job.permission,
      amountInAtomic: BigInt(request.amountInAtomic),
      account: job.clientAddress as Address,
      config,
    });
    assertPancakeSwapRebalancePolicy({
      permission: job.permission,
      config,
      routerAddress: request.routerAddress as Address,
      tokenInAddress: request.tokenInAddress as Address,
      tokenOutAddress: request.tokenOutAddress as Address,
      amountInAtomic: BigInt(request.amountInAtomic),
      minimumAmountOutAtomic: BigInt(request.minimumAmountOutAtomic),
      tokenInDecimals: request.tokenInDecimals,
      tokenInSymbol: request.tokenInSymbol,
      deadline: BigInt(request.deadline),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "The on chain quote could not be verified.", 409, job);
  }

  if (chainQuote.quotedAmountOutAtomic !== BigInt(request.quotedAmountOutAtomic)
    || chainQuote.minimumAmountOutAtomic !== BigInt(request.minimumAmountOutAtomic)
    || chainQuote.tokenIn.symbol !== request.tokenInSymbol
    || chainQuote.tokenOut.symbol !== request.tokenOutSymbol
    || chainQuote.tokenIn.decimals !== request.tokenInDecimals
    || chainQuote.tokenOut.decimals !== request.tokenOutDecimals) {
    return errorResponse("The PancakeSwap quote changed. Refresh it before reserving the action.", 409, job);
  }

  const actionInput: FundMovingActionReservationInput = {
    kind: "pancakeswap-rebalance",
    chainId: request.chainId,
    routerAddress: request.routerAddress,
    tokenInAddress: request.tokenInAddress,
    tokenOutAddress: request.tokenOutAddress,
    tokenInSymbol: request.tokenInSymbol,
    tokenOutSymbol: request.tokenOutSymbol,
    tokenInDecimals: request.tokenInDecimals,
    tokenOutDecimals: request.tokenOutDecimals,
    amountInAtomic: request.amountInAtomic,
    quotedAmountOutAtomic: request.quotedAmountOutAtomic,
    minimumAmountOutAtomic: request.minimumAmountOutAtomic,
    slippageBps: request.slippageBps,
    deadline: request.deadline,
    quotedAt: request.quotedAt,
  };
  const result = await reserveStoredPancakeSwapAction(jobId, ownerToken, actionInput);
  if (result.kind === "not-found") return errorResponse("Job not found.", 404);
  if (result.kind === "not-eligible") return errorResponse("The job is no longer eligible for this action.", 409, result.job);
  if (result.kind === "already-confirmed") return errorResponse("This job already has a confirmed PancakeSwap action.", 409, result.job);
  if (result.kind === "already-reserved") return errorResponse("A PancakeSwap action is already reserved for this job. Check its transaction status before trying again.", 409, result.job);
  return NextResponse.json({ job: result.job }, { headers: NO_STORE_HEADERS });
}

function parseProgress(value: unknown): FundMovingActionProgress | undefined {
  if (!isRecord(value) || typeof value.action !== "string") return undefined;
  if (value.action === "approval-submitted" && isHash(value.approvalTransactionHash)) {
    return { kind: "approval-submitted", approvalTransactionHash: value.approvalTransactionHash };
  }
  if (value.action === "swap-submitted" && isHash(value.transactionHash) && (value.approvalTransactionHash === undefined || isHash(value.approvalTransactionHash))) {
    return { kind: "swap-submitted", transactionHash: value.transactionHash, ...(value.approvalTransactionHash ? { approvalTransactionHash: value.approvalTransactionHash } : {}) };
  }
  if (value.action === "confirmed" && isHash(value.transactionHash)) {
    return { kind: "confirmed", transactionHash: value.transactionHash };
  }
  if (value.action === "release" && typeof value.failureReason === "string") {
    return { kind: "release", failureReason: value.failureReason };
  }
  return undefined;
}

export async function GET(request: NextRequest, context: JobRouteContext) {
  if (!isJobPersistenceConfigured()) return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql.", 503);
  const ownerToken = ownerTokenFromRequest(request);
  if (!ownerToken) return errorResponse("Job not found.", 404);
  const { jobId } = await context.params;
  try {
    const job = await getStoredJob(jobId, ownerToken);
    return job ? NextResponse.json({ job }, { headers: NO_STORE_HEADERS }) : errorResponse("Job not found.", 404);
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: JobRouteContext) {
  if (!isJobPersistenceConfigured()) return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql.", 503);
  const ownerToken = ownerTokenFromRequest(request);
  if (!ownerToken) return errorResponse("Job not found.", 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("The request body must be valid JSON.", 400);
  }
  const { jobId } = await context.params;
  try {
    if (isRecord(body) && body.action === "reserve") return await reserveAction(jobId, ownerToken, body);
    const progress = parseProgress(body);
    if (!progress) return errorResponse("The PancakeSwap action update is invalid.", 400);
    if (progress.kind === "confirmed") {
      try {
        await verifyConfirmedSwap(jobId, progress.transactionHash, ownerToken);
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : "The swap receipt could not be verified.", 409);
      }
    }
    const job = await recordStoredPancakeSwapActionProgress(jobId, ownerToken, progress);
    return job ? NextResponse.json({ job }, { headers: NO_STORE_HEADERS }) : errorResponse("Job not found.", 404);
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
