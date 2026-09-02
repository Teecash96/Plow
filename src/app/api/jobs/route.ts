import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  insertStoredJob,
  isJobPersistenceConfigured,
  isJobRecord,
  JobConflictError,
  JobMutationError,
  JobPersistenceError,
  listStoredJobs,
} from "@/lib/marketplace/job-database";

export const dynamic = "force-dynamic";

const OWNER_COOKIE = "plow_job_owner";
const OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function ownerTokenFromRequest(request: NextRequest) {
  const value = request.cookies.get(OWNER_COOKIE)?.value;
  if (!value || value.length > 256 || /\s/.test(value)) return undefined;
  return value;
}

function setOwnerCookie(response: NextResponse, ownerToken: string) {
  response.cookies.set(OWNER_COOKIE, ownerToken, {
    httpOnly: true,
    maxAge: OWNER_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function persistenceErrorResponse(error: unknown) {
  if (error instanceof JobMutationError) return errorResponse(error.message, 409);
  if (error instanceof JobConflictError) return errorResponse(error.message, 409);
  if (error instanceof JobPersistenceError) return errorResponse(error.message, 503);
  return errorResponse("Durable job storage is unavailable. Check DATABASE_URL and apply db/001_jobs.sql.", 503);
}

export async function GET(request: NextRequest) {
  if (!isJobPersistenceConfigured()) {
    return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql.", 503);
  }

  const ownerToken = ownerTokenFromRequest(request);
  if (!ownerToken) {
    try {
      await listStoredJobs("health-check");
      return NextResponse.json({ jobs: [] }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      return persistenceErrorResponse(error);
    }
  }

  try {
    const jobs = await listStoredJobs(ownerToken);
    return NextResponse.json({ jobs }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isJobPersistenceConfigured()) {
    return errorResponse("Durable job storage is not configured. Set DATABASE_URL and apply db/001_jobs.sql.", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("The request body must be valid JSON.", 400);
  }

  const candidate = isJobRecord(body)
    ? body
    : typeof body === "object" && body !== null && "job" in body && isJobRecord(body.job)
      ? body.job
      : undefined;
  if (!candidate) return errorResponse("The request must contain a valid job record.", 400);

  const existingOwnerToken = ownerTokenFromRequest(request);
  const ownerToken = existingOwnerToken ?? randomUUID();
  try {
    const job = await insertStoredJob(candidate, ownerToken);
    const response = NextResponse.json({ job }, { status: 201, headers: NO_STORE_HEADERS });
    if (!existingOwnerToken) setOwnerCookie(response, ownerToken);
    return response;
  } catch (error) {
    return persistenceErrorResponse(error);
  }
}
