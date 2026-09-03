import { createHash } from "node:crypto";
import postgres from "postgres";
import { isAddress } from "viem";
import { assertPermissionAllows } from "./permission-policy";
import { applyEscrowObservation, type EscrowObservation } from "./job-lifecycle";
import type { FundMovingAction, Job, JobEscrow, JobExecution, JobReview, JobStatus, JobStatusChange, JobTerms, PaymentReceipt, SessionPermission } from "./types";

const JOB_STATUSES = new Set<JobStatus>([
  "draft",
  "pending",
  "active",
  "submitted",
  "completed",
  "rejected",
  "expired",
  "failed",
  "cancelled",
]);

const PAYMENT_STATUSES = new Set<PaymentReceipt["status"]>([
  "preview",
  "pending",
  "paid",
  "unavailable",
]);

const PATCH_FIELDS = new Set([
  "agentId",
  "agentName",
  "category",
  "clientAddress",
  "taskSummary",
  "status",
  "price",
  "currency",
  "terms",
  "statusHistory",
  "permission",
  "payment",
  "onchainNetwork",
  "onchainChainId",
  "jobContractAddress",
  "termsHash",
  "resultUri",
  "resultSummary",
  "execution",
]);

const EXECUTION_LOCK_MS = 5 * 60 * 1000;
export const FUNDING_RECOVERY_MIN_AGE_MS = 10 * 60 * 1000;

type SqlClient = ReturnType<typeof postgres>;

let sqlClient: SqlClient | undefined;

export type JobPatch = Partial<Omit<Job, "id" | "createdAt" | "updatedAt">>;

export interface StoredJobOnchainBinding {
  onchainJobId: string;
  onchainNetwork: "BSC Mainnet" | "BSC Testnet";
  onchainChainId: 56 | 97;
  jobContractAddress: string;
}

export class JobPersistenceError extends Error {
  constructor(message = "Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.") {
    super(message);
    this.name = "JobPersistenceError";
  }
}

export class JobConflictError extends Error {
  constructor() {
    super("A job with this ID already exists.");
    this.name = "JobConflictError";
  }
}

export class JobMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobMutationError";
  }
}

function databaseUrl() {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
}

export function isJobPersistenceConfigured() {
  return Boolean(databaseUrl());
}

function getSql() {
  const url = databaseUrl();
  if (!url) {
    throw new JobPersistenceError("Durable job storage is not configured. Set DATABASE_URL before using server jobs.");
  }

  if (!sqlClient) {
    sqlClient = postgres(url, {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 5,
      prepare: false,
    });
  }

  return sqlClient;
}

function hashOwnerToken(ownerToken: string) {
  return createHash("sha256").update(ownerToken).digest("hex");
}

function serialiseJob(job: Job): Parameters<SqlClient["json"]>[0] {
  return JSON.parse(JSON.stringify(job));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown) {
  return typeof value === "string";
}

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && JOB_STATUSES.has(value as JobStatus);
}

function isStatusChange(value: unknown): value is JobStatusChange {
  return isRecord(value)
    && isJobStatus(value.status)
    && isString(value.changedAt)
    && (value.note === undefined || isString(value.note));
}

function isJobTerms(value: unknown): value is JobTerms {
  return isRecord(value)
    && value.protocol === "ERC-8183"
    && isString(value.taskSummary)
    && isString(value.category)
    && isString(value.expiresAt)
    && (value.termsHash === undefined || isString(value.termsHash));
}

function isPermission(value: unknown): value is SessionPermission {
  return isRecord(value)
    && value.provider === "Altana"
    && isString(value.spendCap)
    && isString(value.currency)
    && Array.isArray(value.allowlistedContracts)
    && value.allowlistedContracts.every(isString)
    && (value.allowlistedTokens === undefined || (Array.isArray(value.allowlistedTokens) && value.allowlistedTokens.every(isString)))
    && isString(value.expiresAt)
    && (value.expiresAtTimestamp === undefined || isString(value.expiresAtTimestamp));
}

function isPayment(value: unknown): value is PaymentReceipt {
  return isRecord(value)
    && value.protocol === "x402"
    && typeof value.status === "string"
    && PAYMENT_STATUSES.has(value.status as PaymentReceipt["status"])
    && isString(value.amount)
    && isString(value.currency)
    && (value.receiptId === undefined || isString(value.receiptId))
    && (value.transactionHash === undefined || isString(value.transactionHash))
    && (value.paidAt === undefined || isString(value.paidAt));
}

function isJobExecution(value: unknown): value is JobExecution {
  return isRecord(value)
    && (value.status === "running" || value.status === "completed" || value.status === "failed")
    && Number.isInteger(value.attempt)
    && Number(value.attempt) > 0
    && isString(value.startedAt)
    && (value.completedAt === undefined || isString(value.completedAt))
    && (value.error === undefined || (isString(value.error) && value.error.length <= 500));
}

function isJobReview(value: unknown): value is JobReview {
  return isRecord(value)
    && Number.isInteger(value.score)
    && Number(value.score) >= 1
    && Number(value.score) <= 5
    && isString(value.submittedAt)
    && isIsoTimestamp(value.submittedAt)
    && (value.comment === undefined || (isString(value.comment) && value.comment.length <= 500));
}

const FUND_MOVING_ACTION_STATUSES = new Set<FundMovingAction["status"]>([
  "reserved",
  "approval-submitted",
  "swap-submitted",
  "confirmed",
  "failed",
]);

function isTransactionHash(value: unknown): value is string {
  return isString(value) && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isAtomicString(value: unknown): value is string {
  return isString(value) && /^\d+$/.test(value) && BigInt(value) > BigInt(0);
}

function isIsoTimestamp(value: unknown) {
  return isString(value) && Number.isFinite(Date.parse(value));
}

function isFundMovingAction(value: unknown): value is FundMovingAction {
  if (!isRecord(value)
    || value.kind !== "pancakeswap-rebalance"
    || !isString(value.status)
    || !FUND_MOVING_ACTION_STATUSES.has(value.status as FundMovingAction["status"])
    || (value.chainId !== 56 && value.chainId !== 97)
    || !isAddress(String(value.routerAddress ?? ""))
    || !isAddress(String(value.tokenInAddress ?? ""))
    || !isAddress(String(value.tokenOutAddress ?? ""))
    || !isString(value.tokenInSymbol)
    || !value.tokenInSymbol.trim()
    || !isString(value.tokenOutSymbol)
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
    || Number(value.slippageBps) < 1
    || Number(value.slippageBps) > 500
    || !isAtomicString(value.deadline)
    || !isIsoTimestamp(value.quotedAt)
    || !isIsoTimestamp(value.reservedAt)
    || (value.approvalTransactionHash !== undefined && !isTransactionHash(value.approvalTransactionHash))
    || (value.transactionHash !== undefined && !isTransactionHash(value.transactionHash))
    || (value.confirmedAt !== undefined && !isIsoTimestamp(value.confirmedAt))
    || (value.failureReason !== undefined && (!isString(value.failureReason) || value.failureReason.length > 500))) {
    return false;
  }
  if (value.status === "approval-submitted" && !value.approvalTransactionHash) return false;
  if ((value.status === "swap-submitted" || value.status === "confirmed") && !value.transactionHash) return false;
  if (value.status === "confirmed" && !value.confirmedAt) return false;
  if (value.status === "failed" && !value.failureReason) return false;
  return true;
}

function isJobEscrow(value: unknown): value is JobEscrow {
  return isRecord(value)
    && (value.status === "open" || value.status === "funded" || value.status === "submitted" || value.status === "completed" || value.status === "rejected" || value.status === "expired")
    && [
      "registrationTransactionHash",
      "creationTransactionHash",
      "budgetTransactionHash",
      "fundingTransactionHash",
      "submissionTransactionHash",
      "disputeTransactionHash",
      "settlementTransactionHash",
      "refundTransactionHash",
      "deliverableHash",
      "submittedAt",
      "expiresAt",
      "settledAt",
      "reason",
    ].every((key) => value[key] === undefined || isString(value[key]))
    && (value.pendingFundingTransactionHash === undefined || isTransactionHash(value.pendingFundingTransactionHash))
    && (value.pendingFundingAt === undefined || isIsoTimestamp(value.pendingFundingAt));
}

export function isJobRecord(value: unknown): value is Job {
  return isRecord(value)
    && isString(value.id)
    && value.id.length > 0
    && isString(value.agentId)
    && (value.agentIdentityId === undefined || isString(value.agentIdentityId))
    && isString(value.category)
    && isString(value.clientAddress)
    && isString(value.taskSummary)
    && isJobStatus(value.status)
    && isString(value.price)
    && isString(value.currency)
    && isString(value.createdAt)
    && isString(value.updatedAt)
    && isJobTerms(value.terms)
    && Array.isArray(value.statusHistory)
    && value.statusHistory.every(isStatusChange)
    && (value.permission === undefined || isPermission(value.permission))
    && (value.payment === undefined || isPayment(value.payment))
    && (value.execution === undefined || isJobExecution(value.execution))
    && (value.review === undefined || isJobReview(value.review))
    && (value.fundMovingAction === undefined || isFundMovingAction(value.fundMovingAction))
    && (value.escrow === undefined || isJobEscrow(value.escrow));
}

export interface NewAgentReviewInput {
  score: number;
  comment?: string;
}

export function parseAgentReviewInput(value: unknown): NewAgentReviewInput | undefined {
  if (!isRecord(value) || !Number.isInteger(value.score) || Number(value.score) < 1 || Number(value.score) > 5) return undefined;
  if (value.comment !== undefined && (!isString(value.comment) || value.comment.trim().length > 500)) return undefined;
  const comment = isString(value.comment) ? value.comment.trim() : "";
  return {
    score: Number(value.score),
    ...(comment ? { comment } : {}),
  };
}

export function parseJobPatch(value: unknown): JobPatch | undefined {
  if (!isRecord(value)) return undefined;

  const keys = Object.keys(value);
  if (keys.some((key) => !PATCH_FIELDS.has(key))) return undefined;
  if (value.status !== undefined && !isJobStatus(value.status)) return undefined;
  if (value.terms !== undefined && !isJobTerms(value.terms)) return undefined;
  if (value.statusHistory !== undefined && (!Array.isArray(value.statusHistory) || !value.statusHistory.every(isStatusChange))) return undefined;
  if (value.permission !== undefined && !isPermission(value.permission)) return undefined;
  if (value.payment !== undefined && !isPayment(value.payment)) return undefined;
  if (value.execution !== undefined && !isJobExecution(value.execution)) return undefined;
  if (value.escrow !== undefined) return undefined;
  if (value.onchainNetwork !== undefined && value.onchainNetwork !== "BSC Mainnet" && value.onchainNetwork !== "BSC Testnet") return undefined;
  if (value.onchainChainId !== undefined && value.onchainChainId !== 56 && value.onchainChainId !== 97) return undefined;
  for (const key of ["agentId", "agentName", "category", "clientAddress", "taskSummary", "price", "currency", "jobContractAddress", "termsHash", "resultUri", "resultSummary"]) {
    if (key in value && value[key] !== undefined && !isString(value[key])) return undefined;
  }

  return value as JobPatch;
}

function rethrowDatabaseError(error: unknown): never {
  if (error instanceof JobPersistenceError || error instanceof JobConflictError || error instanceof JobMutationError) throw error;
  throw new JobPersistenceError();
}

export async function listStoredJobs(ownerToken: string) {
  try {
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    const rows = await sql<{ job: unknown }[]>`
      SELECT job
      FROM plow_jobs
      WHERE owner_token_hash = ${ownerTokenHash}
      ORDER BY updated_at DESC
    `;

    return rows.flatMap((row) => isJobRecord(row.job) ? [row.job] : []);
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export async function getStoredJob(jobId: string, ownerToken: string) {
  try {
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    const rows = await sql<{ job: unknown }[]>`
      SELECT job
      FROM plow_jobs
      WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      LIMIT 1
    `;

    const job = rows[0]?.job;
    return isJobRecord(job) ? job : undefined;
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export interface StoredAgentExecutionEvidence {
  jobId: string;
  completedAt: string;
  resultSummary: string;
  submissionTransactionHash?: string;
  completedJobs: number;
  rating?: number;
  reviewCount: number;
  positivePercent?: number;
}

type VerifiedAgentExecutionJob = Job & {
  agentIdentityId: string;
  onchainJobId: string;
  payment: NonNullable<Job["payment"]> & { status: "paid" };
  execution: NonNullable<Job["execution"]> & { status: "completed"; completedAt: string };
  resultSummary: string;
};

function isVerifiedAgentExecutionJob(job: unknown, agentIdentityId: string): job is VerifiedAgentExecutionJob {
  return isJobRecord(job)
    && job.agentIdentityId === agentIdentityId
    && Boolean(job.onchainJobId)
    && job.payment?.status === "paid"
    && job.execution?.status === "completed"
    && Boolean(job.execution.completedAt)
    && Boolean(job.resultSummary)
    && !Number.isNaN(Date.parse(job.execution.completedAt ?? ""));
}

export async function getLatestVerifiedAgentExecutionEvidence(agentIdentityId: string, marketplaceAgentId: string) {
  if (!isJobPersistenceConfigured()) return undefined;

  try {
    const sql = getSql();
    const [rows, statsRows] = await Promise.all([
      sql<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE agent_id = ${marketplaceAgentId}
        ORDER BY updated_at DESC
        LIMIT 25
      `,
      sql<{
        completed_jobs: number | string;
        review_count: number | string;
        rating: number | string | null;
        positive_reviews: number | string;
      }[]>`
        WITH eligible AS (
          SELECT job
          FROM plow_jobs
          WHERE agent_id = ${marketplaceAgentId}
            AND job->>'agentIdentityId' = ${agentIdentityId}
            AND NULLIF(job->>'onchainJobId', '') IS NOT NULL
            AND job->'payment'->>'status' = 'paid'
            AND job->'execution'->>'status' = 'completed'
            AND NULLIF(job->'execution'->>'completedAt', '') IS NOT NULL
            AND NULLIF(job->>'resultSummary', '') IS NOT NULL
        )
        SELECT
          COUNT(*)::int AS completed_jobs,
          COUNT(*) FILTER (WHERE (job->'review'->>'score') ~ '^[1-5]$')::int AS review_count,
          AVG(CASE
            WHEN (job->'review'->>'score') ~ '^[1-5]$' THEN (job->'review'->>'score')::numeric
            ELSE NULL
          END) AS rating,
          COUNT(*) FILTER (WHERE CASE
            WHEN (job->'review'->>'score') ~ '^[1-5]$' THEN (job->'review'->>'score')::int >= 4
            ELSE false
          END)::int AS positive_reviews
        FROM eligible
      `,
    ]);
    const stats = statsRows[0];
    const completedJobs = Math.max(0, Number(stats?.completed_jobs ?? 0));
    const reviewCount = Math.max(0, Number(stats?.review_count ?? 0));
    const positiveReviews = Math.max(0, Number(stats?.positive_reviews ?? 0));
    const averageRating = stats?.rating === null || stats?.rating === undefined ? undefined : Number(stats.rating);

    for (const row of rows) {
      const job = row.job;
      if (!isVerifiedAgentExecutionJob(job, agentIdentityId)) continue;
      return {
        jobId: job.id,
        completedAt: job.execution.completedAt,
        resultSummary: job.resultSummary,
        ...(job.escrow?.submissionTransactionHash ? { submissionTransactionHash: job.escrow.submissionTransactionHash } : {}),
        completedJobs,
        ...(averageRating !== undefined && Number.isFinite(averageRating) ? { rating: averageRating } : {}),
        reviewCount,
        ...(reviewCount > 0 ? { positivePercent: Math.round((positiveReviews / reviewCount) * 100) } : {}),
      } satisfies StoredAgentExecutionEvidence;
    }
    return undefined;
  } catch {
    // Missing or unavailable persistence must keep the agent blocked.
    return undefined;
  }
}

const IMMUTABLE_JOB_PATCH_FIELDS = new Set([
  "agentId",
  "agentName",
  "agentIdentityId",
  "category",
  "clientAddress",
  "taskSummary",
  "price",
  "currency",
  "terms",
  "onchainNetwork",
  "onchainChainId",
  "jobContractAddress",
  "onchainJobId",
  "termsHash",
  "resultUri",
  "resultSummary",
  "execution",
  "escrow",
]);

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatePermissionRevocation(current: SessionPermission | undefined, next: SessionPermission | undefined) {
  if (!current || !next || current.status === "revoked" || next.status !== "revoked") {
    throw new JobMutationError("Permission fields cannot be changed after job creation. Only an explicit revocation is allowed.");
  }
  for (const field of ["provider", "spendCap", "currency", "allowlistedContracts", "allowlistedTokens", "expiresAt", "expiresAtTimestamp", "templateId", "revokeSupported", "source"]) {
    if (!sameValue(current[field as keyof SessionPermission], next[field as keyof SessionPermission])) {
      throw new JobMutationError("Permission fields cannot be changed after job creation. Only an explicit revocation is allowed.");
    }
  }
  if (typeof next.revokedAt !== "string" || !next.revokedAt) {
    throw new JobMutationError("A permission revocation must include a timestamp.");
  }
}

function validatePaymentUpdate(current: PaymentReceipt | undefined, next: PaymentReceipt | undefined) {
  if (!current || !next || current.protocol !== next.protocol || current.amount !== next.amount || current.currency !== next.currency) {
    throw new JobMutationError("Payment amount and currency cannot be changed after job creation.");
  }
  const allowedTransitions: Record<PaymentReceipt["status"], readonly PaymentReceipt["status"][]> = {
    preview: ["preview", "pending", "unavailable"],
    pending: ["pending", "paid", "unavailable"],
    paid: ["paid"],
    unavailable: ["unavailable", "pending"],
  };
  if (!allowedTransitions[current.status].includes(next.status)) {
    throw new JobMutationError("Payment status cannot move backwards.");
  }
  for (const field of ["receiptId", "transactionHash", "paidAt"] as const) {
    if (current[field] !== undefined && current[field] !== next[field]) {
      throw new JobMutationError("Payment receipt fields cannot be changed after they are recorded.");
    }
  }
  if (next.status === "paid" && (!next.transactionHash || !/^0x[a-fA-F0-9]{64}$/.test(next.transactionHash))) {
    throw new JobMutationError("A paid job must include a verified transaction hash.");
  }
}

export function validateNewStoredJob(job: Job) {
  if (job.mode === "simulation") {
    throw new JobMutationError("Simulation jobs are local only and cannot be stored on the server.");
  }
  if (job.status !== "draft" && job.status !== "pending") {
    throw new JobMutationError("A new stored job must be a draft or pending job.");
  }
  if (job.escrow && job.escrow.status !== "open") {
    throw new JobMutationError("A new stored job must start with open escrow.");
  }
  if (job.onchainJobId || job.execution || job.resultUri || job.resultSummary || job.payment?.status === "paid") {
    throw new JobMutationError("A new stored job cannot contain payment or execution results.");
  }
}

export function validateJobPatch(currentJob: Job, patch: JobPatch) {
  const keys = Object.keys(patch);
  const immutableField = keys.find((key) => IMMUTABLE_JOB_PATCH_FIELDS.has(key));
  if (immutableField) throw new JobMutationError(`${immutableField} cannot be changed after job creation.`);

  if ("permission" in patch) validatePermissionRevocation(currentJob.permission, patch.permission);
  if ("payment" in patch) validatePaymentUpdate(currentJob.payment, patch.payment);

  if ("statusHistory" in patch) {
    if (!patch.statusHistory || patch.statusHistory.length < currentJob.statusHistory.length) {
      throw new JobMutationError("Job status history cannot be removed.");
    }
    for (let index = 0; index < currentJob.statusHistory.length; index += 1) {
      if (!sameValue(currentJob.statusHistory[index], patch.statusHistory[index])) {
        throw new JobMutationError("Job status history cannot be rewritten.");
      }
    }
    if (patch.statusHistory.slice(currentJob.statusHistory.length).some((entry) => entry.status !== "failed")) {
      throw new JobMutationError("Only a failed execution may be appended by the public job update route.");
    }
  }

  if (patch.status !== undefined && patch.status !== currentJob.status) {
    const canRecordPreFundingFailure = patch.status === "failed" && (currentJob.status === "pending" || currentJob.status === "failed");
    if (!canRecordPreFundingFailure) throw new JobMutationError("On chain job states are managed by the server.");
  }
  if (patch.statusHistory && patch.statusHistory.length > currentJob.statusHistory.length && patch.status !== "failed") {
    throw new JobMutationError("A failed status history entry requires a failed job status.");
  }

  return true;
}

export async function insertStoredJob(job: Job, ownerToken: string) {
  try {
    validateNewStoredJob(job);
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    const rows = await sql<{ id: string }[]>`
      INSERT INTO plow_jobs (id, owner_token_hash, agent_id, status, created_at, updated_at, job)
      VALUES (
        ${job.id},
        ${ownerTokenHash},
        ${job.agentId},
        ${job.status},
        ${job.createdAt},
        ${job.updatedAt},
        ${sql.json(serialiseJob(job))}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

    if (!rows[0]) throw new JobConflictError();
    return job;
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export async function updateStoredJob(jobId: string, ownerToken: string, patch: JobPatch) {
  try {
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    const updatedJob = await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return undefined;
      validateJobPatch(currentJob, patch);

      const nextJob: Job = {
        ...currentJob,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      if (!isJobRecord(nextJob)) throw new JobPersistenceError("The job update would create an invalid record.");

      await transaction`
        UPDATE plow_jobs
        SET agent_id = ${nextJob.agentId},
            status = ${nextJob.status},
            updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return nextJob;
    });

    return updatedJob;
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export async function submitStoredJobReview(jobId: string, ownerToken: string, input: NewAgentReviewInput) {
  try {
    const parsed = parseAgentReviewInput(input);
    if (!parsed) throw new JobMutationError("A review score from 1 to 5 is required. The comment must be 500 characters or less.");

    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return undefined;
      if (currentJob.review) throw new JobMutationError("This job already has a review.");
      if (currentJob.mode === "simulation") throw new JobMutationError("Simulation jobs cannot be reviewed.");
      if (!currentJob.onchainJobId || currentJob.payment?.status !== "paid" || currentJob.execution?.status !== "completed") {
        throw new JobMutationError("A review unlocks after the paid agent execution is complete.");
      }

      const updatedAt = new Date().toISOString();
      const nextJob: Job = {
        ...currentJob,
        review: { ...parsed, submittedAt: updatedAt },
        updatedAt,
      };
      if (!isJobRecord(nextJob)) throw new JobPersistenceError("The review would create an invalid job record.");

      await transaction`
        UPDATE plow_jobs
        SET updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return nextJob;
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

/**
 * Record a funding transaction as broadcast before waiting for its receipt.
 * This state is deliberately separate from fundingTransactionHash, which is
 * reserved for a transaction verified by the reconciliation route.
 */
export async function recordStoredFundingBroadcast(jobId: string, ownerToken: string, transactionHash: string) {
  try {
    if (!isTransactionHash(transactionHash)) throw new JobMutationError("The funding transaction hash is invalid.");

    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return undefined;

      const escrow = currentJob.escrow;
      if (!escrow || !currentJob.onchainJobId) {
        throw new JobMutationError("The job is not linked to an on chain escrow.");
      }
      if (escrow.fundingTransactionHash) {
        throw new JobMutationError("Escrow funding is already verified. Do not submit another funding transaction.");
      }
      if (escrow.pendingFundingTransactionHash) {
        if (escrow.pendingFundingTransactionHash.toLowerCase() === transactionHash.toLowerCase()) return currentJob;
        throw new JobMutationError(`A different funding transaction is already pending. Verify it before retrying: ${escrow.pendingFundingTransactionHash}`);
      }
      if (currentJob.status !== "pending" || escrow.status !== "open" || currentJob.payment?.status !== "paid") {
        throw new JobMutationError("Only a paid job with open escrow can record a funding transaction.");
      }

      const now = new Date().toISOString();
      const nextJob: Job = {
        ...currentJob,
        updatedAt: now,
        escrow: {
          ...escrow,
          pendingFundingTransactionHash: transactionHash,
          pendingFundingAt: now,
        },
      };
      if (!isJobRecord(nextJob)) throw new JobPersistenceError("The funding broadcast would create an invalid job record.");

      await transaction`
        UPDATE plow_jobs
        SET updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return nextJob;
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export function canRecoverFundingBroadcast(pendingFundingAt: string | undefined, now = Date.now()) {
  const pendingAt = pendingFundingAt ? Date.parse(pendingFundingAt) : Number.NaN;
  return Number.isFinite(pendingAt) && now - pendingAt >= FUNDING_RECOVERY_MIN_AGE_MS;
}

export async function recoverStoredFundingBroadcast(jobId: string, ownerToken: string, transactionHash: string) {
  try {
    if (!isTransactionHash(transactionHash)) throw new JobMutationError("The funding transaction hash is invalid.");

    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return undefined;

      const escrow = currentJob.escrow;
      if (!escrow || !currentJob.onchainJobId) {
        throw new JobMutationError("The job is not linked to an on chain escrow.");
      }
      if (escrow.fundingTransactionHash) {
        throw new JobMutationError("Escrow funding is already verified. Do not retry it.");
      }
      if (!escrow.pendingFundingTransactionHash) {
        throw new JobMutationError("There is no pending funding broadcast to recover.");
      }
      if (escrow.pendingFundingTransactionHash.toLowerCase() !== transactionHash.toLowerCase()) {
        throw new JobMutationError("The funding hash does not match the pending broadcast.");
      }
      if (!canRecoverFundingBroadcast(escrow.pendingFundingAt)) {
        throw new JobMutationError("The funding broadcast is too recent to recover. Wait ten minutes and verify it again.");
      }
      if (currentJob.status !== "pending" || escrow.status !== "open" || currentJob.payment?.status !== "paid") {
        throw new JobMutationError("Only a paid job with open escrow can recover a funding broadcast.");
      }

      const nextEscrow = { ...escrow };
      delete nextEscrow.pendingFundingTransactionHash;
      delete nextEscrow.pendingFundingAt;
      const nextJob: Job = {
        ...currentJob,
        updatedAt: new Date().toISOString(),
        escrow: nextEscrow,
      };
      if (!isJobRecord(nextJob)) throw new JobPersistenceError("The funding recovery would create an invalid job record.");

      await transaction`
        UPDATE plow_jobs
        SET updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return nextJob;
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export type FundMovingActionReservationInput = Omit<FundMovingAction, "status" | "reservedAt">;

export type StoredFundMovingActionReservationResult =
  | { kind: "reserved"; job: Job }
  | { kind: "already-reserved"; job: Job }
  | { kind: "already-confirmed"; job: Job }
  | { kind: "not-eligible"; job: Job }
  | { kind: "not-found" };

function fundMovingJobIsEligible(job: Job) {
  return job.mode !== "simulation"
    && job.category === "rebalancing"
    && job.status === "active"
    && Boolean(job.onchainJobId)
    && job.payment?.status === "paid"
    && Boolean(job.permission);
}

function fundMovingActionInputIsValid(input: FundMovingActionReservationInput) {
  return !input.approvalTransactionHash
    && !input.transactionHash
    && !input.confirmedAt
    && !input.failureReason
    && isFundMovingAction({ ...input, status: "reserved", reservedAt: new Date().toISOString() });
}

function reservationMatchesAction(action: FundMovingAction, input: FundMovingActionReservationInput) {
  return (Object.keys(input) as Array<keyof FundMovingActionReservationInput>).every((key) => sameValue(action[key], input[key]));
}

export async function reserveStoredPancakeSwapAction(
  jobId: string,
  ownerToken: string,
  input: FundMovingActionReservationInput,
): Promise<StoredFundMovingActionReservationResult> {
  try {
    if (!fundMovingActionInputIsValid(input)) throw new JobMutationError("The PancakeSwap action reservation is invalid.");
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return { kind: "not-found" };
      if (!fundMovingJobIsEligible(currentJob)) return { kind: "not-eligible", job: currentJob };
      if (currentJob.onchainChainId && currentJob.onchainChainId !== input.chainId) return { kind: "not-eligible", job: currentJob };

      const existing = currentJob.fundMovingAction;
      if (existing?.status === "confirmed") return { kind: "already-confirmed", job: currentJob };
      if (existing?.status === "reserved" && reservationMatchesAction(existing, input)) return { kind: "reserved", job: currentJob };
      if (existing && existing.status !== "failed") return { kind: "already-reserved", job: currentJob };
      if (existing?.status === "failed" && existing.transactionHash) return { kind: "already-reserved", job: currentJob };

      try {
        assertPermissionAllows({
          permission: currentJob.permission,
          action: "pancakeswap-rebalance",
          contractAddress: input.routerAddress,
          tokenAddress: input.tokenInAddress,
          amountAtomic: BigInt(input.amountInAtomic),
          tokenDecimals: input.tokenInDecimals,
          currency: input.tokenInSymbol,
          spentAmountAtomic: BigInt(0),
        });
        assertPermissionAllows({
          permission: currentJob.permission,
          action: "pancakeswap-rebalance",
          contractAddress: input.routerAddress,
          tokenAddress: input.tokenOutAddress,
          requireAmount: false,
        });
        assertPermissionAllows({
          permission: currentJob.permission,
          action: "token-approval",
          contractAddress: input.routerAddress,
          tokenAddress: input.tokenInAddress,
          amountAtomic: BigInt(input.amountInAtomic),
          tokenDecimals: input.tokenInDecimals,
          countAmount: false,
        });
      } catch (error) {
        throw new JobMutationError(error instanceof Error ? error.message : "The job permission does not allow this action.");
      }

      const now = new Date().toISOString();
      const nextJob: Job = {
        ...currentJob,
        updatedAt: now,
        fundMovingAction: { ...input, status: "reserved", reservedAt: now },
      };
      if (!isJobRecord(nextJob)) throw new JobPersistenceError("The PancakeSwap action would create an invalid job record.");

      await transaction`
        UPDATE plow_jobs
        SET updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return { kind: "reserved", job: nextJob };
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export type FundMovingActionProgress =
  | { kind: "approval-submitted"; approvalTransactionHash: string }
  | { kind: "swap-submitted"; transactionHash: string; approvalTransactionHash?: string }
  | { kind: "confirmed"; transactionHash: string }
  | { kind: "release"; failureReason: string };

export async function recordStoredPancakeSwapActionProgress(jobId: string, ownerToken: string, progress: FundMovingActionProgress) {
  try {
    if (progress.kind === "approval-submitted" && !isTransactionHash(progress.approvalTransactionHash)) {
      throw new JobMutationError("The approval transaction hash is invalid.");
    }
    if (progress.kind === "swap-submitted" && (!isTransactionHash(progress.transactionHash) || progress.approvalTransactionHash !== undefined && !isTransactionHash(progress.approvalTransactionHash))) {
      throw new JobMutationError("The swap transaction record is invalid.");
    }
    if (progress.kind === "confirmed" && !isTransactionHash(progress.transactionHash)) {
      throw new JobMutationError("The confirmed transaction hash is invalid.");
    }
    if (progress.kind === "release" && (!progress.failureReason.trim() || progress.failureReason.length > 500)) {
      throw new JobMutationError("The reservation release reason is invalid.");
    }

    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return undefined;
      const currentAction = currentJob.fundMovingAction;
      if (!currentAction) throw new JobMutationError("No PancakeSwap action is reserved for this job.");

      let nextAction: FundMovingAction;
      if (progress.kind === "approval-submitted") {
        if (currentAction.status === "approval-submitted" && currentAction.approvalTransactionHash === progress.approvalTransactionHash) return currentJob;
        if (currentAction.status !== "reserved" || currentAction.approvalTransactionHash || currentAction.transactionHash) {
          throw new JobMutationError("The approval cannot be recorded for the current PancakeSwap action state.");
        }
        nextAction = { ...currentAction, status: "approval-submitted", approvalTransactionHash: progress.approvalTransactionHash };
      } else if (progress.kind === "swap-submitted") {
        if (currentAction.status === "swap-submitted" && currentAction.transactionHash === progress.transactionHash) return currentJob;
        if (currentAction.status !== "reserved" && currentAction.status !== "approval-submitted") {
          throw new JobMutationError("The swap cannot be recorded for the current PancakeSwap action state.");
        }
        if (currentAction.approvalTransactionHash && progress.approvalTransactionHash && currentAction.approvalTransactionHash !== progress.approvalTransactionHash) {
          throw new JobMutationError("The approval transaction does not match the reserved PancakeSwap action.");
        }
        nextAction = {
          ...currentAction,
          status: "swap-submitted",
          transactionHash: progress.transactionHash,
          ...(currentAction.approvalTransactionHash || progress.approvalTransactionHash ? { approvalTransactionHash: currentAction.approvalTransactionHash ?? progress.approvalTransactionHash } : {}),
        };
      } else if (progress.kind === "confirmed") {
        if (currentAction.status === "confirmed" && currentAction.transactionHash === progress.transactionHash) return currentJob;
        if (currentAction.status !== "swap-submitted" || currentAction.transactionHash !== progress.transactionHash) {
          throw new JobMutationError("The confirmed transaction does not match the submitted PancakeSwap action.");
        }
        nextAction = { ...currentAction, status: "confirmed", confirmedAt: new Date().toISOString() };
      } else {
        if (currentAction.status !== "reserved" || currentAction.approvalTransactionHash || currentAction.transactionHash) {
          throw new JobMutationError("Only an unused reservation can be released.");
        }
        nextAction = { ...currentAction, status: "failed", failureReason: progress.failureReason.trim() };
      }

      const nextJob: Job = { ...currentJob, updatedAt: new Date().toISOString(), fundMovingAction: nextAction };
      if (!isJobRecord(nextJob)) throw new JobPersistenceError("The PancakeSwap action update would create an invalid job record.");
      await transaction`
        UPDATE plow_jobs
        SET updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return nextJob;
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export async function reconcileStoredJobLifecycle(
  jobId: string,
  ownerToken: string,
  observation: EscrowObservation,
  binding?: StoredJobOnchainBinding,
) {
  try {
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return undefined;

      if (binding) {
        if (currentJob.onchainJobId && currentJob.onchainJobId !== binding.onchainJobId) {
          throw new JobMutationError("The stored on chain job ID cannot be changed.");
        }
        if (currentJob.onchainNetwork && currentJob.onchainNetwork !== binding.onchainNetwork) {
          throw new JobMutationError("The stored on chain network cannot be changed.");
        }
        if (currentJob.onchainChainId && currentJob.onchainChainId !== binding.onchainChainId) {
          throw new JobMutationError("The stored on chain chain ID cannot be changed.");
        }
        if (currentJob.jobContractAddress && currentJob.jobContractAddress.toLowerCase() !== binding.jobContractAddress.toLowerCase()) {
          throw new JobMutationError("The stored ERC 8183 contract cannot be changed.");
        }
      }

      let nextJob: Job;
      try {
        nextJob = applyEscrowObservation(binding ? { ...currentJob, ...binding } : currentJob, observation);
      } catch (error) {
        throw new JobMutationError(error instanceof Error ? error.message : "The on chain job state is invalid.");
      }
      if (!isJobRecord(nextJob)) throw new JobMutationError("The on chain job update is invalid.");

      await transaction`
        UPDATE plow_jobs
        SET agent_id = ${nextJob.agentId},
            status = ${nextJob.status},
            updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return nextJob;
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export interface StoredPaymentSettlement {
  status: "paid" | "rejected";
  transactionHash?: string;
  receiptId?: string;
  payer?: string;
  errorReason?: string;
}

export type StoredPaymentSettlementResult =
  | { kind: "settled"; job: Job; settlement: StoredPaymentSettlement }
  | { kind: "rejected"; job: Job; settlement: StoredPaymentSettlement }
  | { kind: "already-paid"; job: Job }
  | { kind: "not-eligible"; job: Job }
  | { kind: "not-found" };

/**
 * Serialise the facilitator call with the job payment state. The row lock is
 * held until the on chain result is recorded, so two requests cannot both
 * settle a pending payment for the same job.
 */
export async function settleStoredJobPayment(
  jobId: string,
  ownerToken: string,
  settle: (job: Job) => Promise<StoredPaymentSettlement>,
): Promise<StoredPaymentSettlementResult> {
  try {
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return { kind: "not-found" };
      if (currentJob.payment?.status === "paid") return { kind: "already-paid", job: currentJob };
      if (currentJob.status !== "pending" || !currentJob.onchainJobId || currentJob.payment?.status !== "pending") {
        return { kind: "not-eligible", job: currentJob };
      }

      const settlement = await settle(currentJob);
      if (settlement.status !== "paid" || !settlement.transactionHash) {
        return { kind: "rejected", job: currentJob, settlement };
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(settlement.transactionHash)) {
        return {
          kind: "rejected",
          job: currentJob,
          settlement: { status: "rejected", errorReason: "The settlement returned an invalid transaction hash." },
        };
      }

      const now = new Date().toISOString();
      const nextJob: Job = {
        ...currentJob,
        updatedAt: now,
        payment: {
          ...currentJob.payment,
          status: "paid",
          receiptId: settlement.receiptId ?? currentJob.payment.receiptId,
          transactionHash: settlement.transactionHash,
          paidAt: now,
        },
      };
      validatePaymentUpdate(currentJob.payment, nextJob.payment);

      await transaction`
        UPDATE plow_jobs
        SET updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return { kind: "settled", job: nextJob, settlement };
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export type JobExecutionClaim =
  | { kind: "claimed"; job: Job; attempt: number }
  | { kind: "not-found" }
  | { kind: "already-running"; job: Job }
  | { kind: "already-completed"; job: Job }
  | { kind: "not-eligible"; job: Job };

function executionIsStale(execution: JobExecution) {
  const startedAt = Date.parse(execution.startedAt);
  return Number.isFinite(startedAt) && Date.now() - startedAt > EXECUTION_LOCK_MS;
}

function executionPermissionIsValid(job: Job) {
  try {
    assertPermissionAllows({ permission: job.permission, action: "agent-execution" });
    return true;
  } catch {
    return false;
  }
}

export async function claimStoredJobExecution(jobId: string, ownerToken: string): Promise<JobExecutionClaim> {
  try {
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob)) return { kind: "not-found" };

      if (currentJob.execution?.status === "completed") return { kind: "already-completed", job: currentJob };
      if (currentJob.execution?.status === "running" && !executionIsStale(currentJob.execution)) return { kind: "already-running", job: currentJob };
      if ((currentJob.status !== "active" && currentJob.status !== "failed") || !currentJob.onchainJobId || currentJob.payment?.status !== "paid" || !executionPermissionIsValid(currentJob)) return { kind: "not-eligible", job: currentJob };

      const now = new Date().toISOString();
      const attempt = (currentJob.execution?.attempt ?? 0) + 1;
      const nextJob: Job = {
        ...currentJob,
        status: "active",
        updatedAt: now,
        execution: { status: "running", attempt, startedAt: now },
        statusHistory: [
          ...currentJob.statusHistory,
          {
            status: "active",
            changedAt: now,
            note: attempt > 1 ? "Agent execution retry started." : "Agent execution started.",
          },
        ],
      };

      await transaction`
        UPDATE plow_jobs
        SET agent_id = ${nextJob.agentId},
            status = ${nextJob.status},
            updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return { kind: "claimed", job: nextJob, attempt };
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export async function completeStoredJobExecution(
  jobId: string,
  ownerToken: string,
  attempt: number,
  result: { resultSummary: string; resultUri?: string },
  submission?: { deliverableHash: string; submissionTransactionHash: string; submittedAt?: string },
) {
  try {
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob) || currentJob.execution?.status !== "running" || currentJob.execution.attempt !== attempt) return undefined;

      const now = new Date().toISOString();
      let nextJob: Job = {
        ...currentJob,
        status: "active",
        updatedAt: now,
        resultSummary: result.resultSummary,
        resultUri: result.resultUri,
        execution: { ...currentJob.execution, status: "completed", completedAt: now, error: undefined },
      };
      if (submission) {
        nextJob = applyEscrowObservation(nextJob, {
          status: "submitted",
          deliverableHash: submission.deliverableHash,
          transactionHash: submission.submissionTransactionHash,
          transactionEvent: "submission",
          submittedAt: submission.submittedAt,
        });
      }

      await transaction`
        UPDATE plow_jobs
        SET agent_id = ${nextJob.agentId},
            status = ${nextJob.status},
            updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return nextJob;
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}

export async function failStoredJobExecution(jobId: string, ownerToken: string, attempt: number, message: string) {
  try {
    const sql = getSql();
    const ownerTokenHash = hashOwnerToken(ownerToken);
    return await sql.begin(async (transaction) => {
      const rows = await transaction<{ job: unknown }[]>`
        SELECT job
        FROM plow_jobs
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
        FOR UPDATE
      `;
      const currentJob = rows[0]?.job;
      if (!isJobRecord(currentJob) || currentJob.execution?.status !== "running" || currentJob.execution.attempt !== attempt) return undefined;

      const now = new Date().toISOString();
      const safeMessage = message.slice(0, 500);
      const nextJob: Job = {
        ...currentJob,
        status: "failed",
        updatedAt: now,
        execution: { ...currentJob.execution, status: "failed", completedAt: now, error: safeMessage },
        statusHistory: [
          ...currentJob.statusHistory,
          { status: "failed", changedAt: now, note: `Agent execution failed: ${safeMessage}` },
        ],
      };

      await transaction`
        UPDATE plow_jobs
        SET agent_id = ${nextJob.agentId},
            status = ${nextJob.status},
            updated_at = ${nextJob.updatedAt},
            job = ${transaction.json(serialiseJob(nextJob))}
        WHERE id = ${jobId} AND owner_token_hash = ${ownerTokenHash}
      `;
      return nextJob;
    });
  } catch (error) {
    return rethrowDatabaseError(error);
  }
}
