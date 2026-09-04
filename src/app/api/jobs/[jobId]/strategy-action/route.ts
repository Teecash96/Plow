import { NextRequest, NextResponse } from "next/server";
import {
  getStoredJob,
  isJobPersistenceConfigured,
  JobMutationError,
  JobPersistenceError,
  recordStoredStrategyAction,
} from "@/lib/marketplace/job-database";
import { parseStrategyActionRequest } from "@/lib/marketplace/strategy-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_COOKIE = "plow_job_owner";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

interface JobRouteContext {
  params: Promise<{ jobId: string }>;
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

  const value = typeof body === "object" && body !== null && "action" in body ? (body as { action?: unknown }).action : body;
  const input = parseStrategyActionRequest(value);
  if (!input) return errorResponse("The strategy action is invalid.", 400);

  const { jobId } = await context.params;
  try {
    const result = await recordStoredStrategyAction(jobId, ownerToken, input);
    if (result.kind === "not-found") return errorResponse("Job not found.", 404);
    if (result.kind === "not-eligible") return errorResponse("Only a paid, active job with an active permission can arm this strategy.", 409, result.job);
    return NextResponse.json({ job: result.job, idempotent: result.kind === "already-recorded" }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return persistenceErrorResponse(error);
  }
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
