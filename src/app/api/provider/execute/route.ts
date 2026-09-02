import { NextRequest, NextResponse } from "next/server";
import {
  getProviderServiceConfig,
  getProviderProfileForAgent,
  parseProviderExecutionRequest,
  ProviderServiceRequestError,
  PROVIDER_MAX_REQUEST_BYTES,
  readProviderRequestBody,
  validateProviderExecutionHeaders,
  verifyProviderRequest,
} from "@/lib/marketplace/provider-service";
import { ProviderSubmissionError, submitProviderExecution } from "@/lib/marketplace/provider-submission";
import { buildLiveProviderExecutionResult, ProviderStrategyError } from "@/lib/marketplace/provider-strategies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const config = getProviderServiceConfig();
  if (!config.ready || !config.requestSecret) return errorResponse(config.reason, 503);

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > PROVIDER_MAX_REQUEST_BYTES) {
    return errorResponse("The provider request is too large.", 413);
  }

  let body: string;
  try {
    body = await readProviderRequestBody(request);
  } catch (error) {
    if (error instanceof ProviderServiceRequestError) return errorResponse(error.message, error.status);
    return errorResponse("The provider request body could not be read.", 400);
  }

  const verification = verifyProviderRequest(body, request.headers, config.requestSecret);
  if (!verification.valid) return errorResponse(verification.reason ?? "The provider request is not authorised.", 401);

  try {
    const parsed = parseProviderExecutionRequest(body, config);
    validateProviderExecutionHeaders(request.headers, parsed);
    const profile = getProviderProfileForAgent(parsed.job.agentId, config);
    if (!profile) return errorResponse("The provider identity is not configured.", 409);
    return NextResponse.json(await submitProviderExecution(parsed, {
      buildResult: (providerRequest) => buildLiveProviderExecutionResult(providerRequest, {
        supportedCategories: profile.supportedCategories,
      }),
    }), { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof ProviderServiceRequestError) return errorResponse(error.message, error.status);
    if (error instanceof ProviderSubmissionError) return errorResponse(error.message, error.status);
    if (error instanceof ProviderStrategyError) return errorResponse(error.message, error.status);
    console.error("[provider] execution processing failed", {
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown provider execution error.",
    });
    return errorResponse("The provider request could not be processed.", 400);
  }
}
