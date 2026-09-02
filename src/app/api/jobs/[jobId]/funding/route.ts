import { NextRequest, NextResponse } from "next/server";
import {
  isJobPersistenceConfigured,
  JobMutationError,
  JobPersistenceError,
  recordStoredFundingBroadcast,
} from "@/lib/marketplace/job-database";

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
  return errorResponse("Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.", 503);
}

interface JobRouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, context: JobRouteContext) {
  if (!isJobPersistenceConfigured()) {
    return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql.", 503);
  }

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
    return errorResponse("The funding transaction hash is invalid.", 400);
  }

  const { jobId } = await context.params;
  try {
    const job = await recordStoredFundingBroadcast(jobId, ownerToken, transactionHash);
    return job
      ? NextResponse.json({ job }, { headers: NO_STORE_HEADERS })
      : errorResponse("Job not found.", 404);
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
