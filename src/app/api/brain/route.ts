import { NextResponse } from "next/server";

import { runBrain } from "@/agents/brain/run-brain";
import { BrainRunError } from "@/agents/brain/retry-policy";
import { brainRequestSchema } from "@/domain/schemas";
import type { ApiError } from "@/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

function errorResponse(
  code: ApiError["error"]["code"],
  message: string,
  retryable: boolean,
  requestId: string,
  status: number,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message, retryable, requestId } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function requestIdFrom(request: Request): string {
  const value = request.headers.get("x-request-id") ?? "UNKNOWN";
  return /^[A-Z][A-Z0-9_-]{1,63}$/.test(value) ? value : "UNKNOWN";
}

function statusFor(error: BrainRunError): number {
  switch (error.code) {
    case "MODEL_TIMEOUT":
      return 504;
    case "MODEL_REFUSAL":
    case "INVALID_MODEL_OUTPUT":
      return 422;
    case "RATE_LIMITED":
      return 429;
    default:
      return 502;
  }
}

function hasValidOrigin(request: Request): boolean {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "http://localhost:3000";
  return request.headers.get("origin") === allowedOrigin;
}

export async function POST(request: Request): Promise<NextResponse> {
  let requestId = requestIdFrom(request);

  if (process.env.LIVE_AI_ENABLED !== "true" || !process.env.OPENAI_API_KEY) {
    return errorResponse("LIVE_DISABLED", "Live AI is not available.", false, requestId, 503);
  }
  if (!hasValidOrigin(request)) {
    return errorResponse("INVALID_REQUEST", "The request origin is not allowed.", false, requestId, 403);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return errorResponse("INVALID_REQUEST", "Content-Type must be application/json.", false, requestId, 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse("INVALID_REQUEST", "The request body is too large.", false, requestId, 413);
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return errorResponse("INVALID_REQUEST", "The request body could not be read.", false, requestId, 400);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return errorResponse("INVALID_REQUEST", "The request body is too large.", false, requestId, 413);
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return errorResponse("INVALID_REQUEST", "The request body is not valid JSON.", false, requestId, 400);
  }
  const parsed = brainRequestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", "The Brain request is invalid.", false, requestId, 400);
  }
  requestId = parsed.data.requestId;

  const now = Date.now();
  const turnTimes = parsed.data.turns.map((turn) => Date.parse(turn.createdAt));
  if (turnTimes.some((time) => time > now + 60_000)) {
    return errorResponse("INVALID_REQUEST", "The Brain request contains an invalid turn time.", false, requestId, 400);
  }
  if (turnTimes.length > 0 && Math.min(...turnTimes) < now - 31 * 60_000) {
    return errorResponse("INVALID_REQUEST", "The Interview Session has expired.", false, requestId, 410);
  }

  try {
    const response = await runBrain(parsed.data);
    return NextResponse.json(response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const mapped =
      error instanceof BrainRunError
        ? error
        : new BrainRunError("INTERNAL_ERROR", "The Brain request failed.", true, { cause: error });
    return errorResponse(mapped.code, mapped.message, mapped.retryable, requestId, statusFor(mapped));
  }
}
