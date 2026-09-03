import { NextRequest, NextResponse } from "next/server";
import {
  isJobPersistenceConfigured,
  JobMutationError,
  JobPersistenceError,
  parseAgentReviewInput,
  submitStoredJobReview,
} from "@/lib/marketplace/job-database";

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
  return errorResponse("Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.", 503);
}

export async function POST(request: NextRequest, context: { params: Promise<unknown> }) {
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

  const reviewValue = typeof body === "object" && body !== null && "review" in body ? body.review : body;
  const review = parseAgentReviewInput(reviewValue);
  if (!review) return errorResponse("A review score from 1 to 5 is required. The comment must be 500 characters or less.", 400);

  const params = await context.params;
  const jobId = typeof params === "object" && params !== null && "jobId" in params && typeof params.jobId === "string" ? params.jobId : "";
  if (!jobId) return errorResponse("Job not found.", 404);
  try {
    const job = await submitStoredJobReview(jobId, ownerToken, review);
    return job ? NextResponse.json({ job }, { headers: NO_STORE_HEADERS }) : errorResponse("Job not found.", 404);
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
