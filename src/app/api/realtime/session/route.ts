import { z } from "zod";

import type { ApiError, RealtimeSessionResponse } from "@/domain/types";
import {
  createLockedRealtimeSession,
  REALTIME_CLIENT_SECRET_TTL_SECONDS,
  REALTIME_MODEL,
  REALTIME_VOICE,
  TRANSCRIPTION_MODEL,
} from "@/realtime/realtime-session";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const realtimeSessionRequestSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().regex(/^[A-Z][A-Z0-9_-]{1,63}$/),
});

const providerClientSecretSchema = z.object({
  value: z.string().min(1).max(1_000),
  expires_at: z.number().int().positive().max(4_102_444_800),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const configuration = readConfiguration();
  if (!configuration) {
    return apiError(
      503,
      "LIVE_DISABLED",
      "Live AI is not configured. Prepared Demo remains available.",
      false,
      requestId,
    );
  }

  const originError = validateOrigin(request, configuration.allowedOrigin);
  if (originError) {
    return apiError(403, "INVALID_REQUEST", originError, false, requestId);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return apiError(415, "INVALID_REQUEST", "A JSON request is required.", false, requestId);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return apiError(413, "INVALID_REQUEST", "The request is too large.", false, requestId);
  }

  const rawBody = await request.text().catch(() => "");
  if (!rawBody || new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return apiError(400, "INVALID_REQUEST", "The request body is invalid.", false, requestId);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError(400, "INVALID_REQUEST", "The request body is invalid.", false, requestId);
  }

  const parsedRequest = realtimeSessionRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return apiError(400, "INVALID_REQUEST", "The request body is invalid.", false, requestId);
  }

  const lockedSession = createLockedRealtimeSession(
    configuration.realtimeModel,
    configuration.transcriptionModel,
    configuration.voice,
  );

  let providerResponse: Response;
  try {
    providerResponse = await fetch(OPENAI_CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": parsedRequest.data.sessionId,
      },
      body: JSON.stringify({
        expires_after: {
          anchor: "created_at",
          seconds: REALTIME_CLIENT_SECRET_TTL_SECONDS,
        },
        session: lockedSession,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return apiError(
      503,
      "REALTIME_UNAVAILABLE",
      "Realtime Communicator is temporarily unavailable.",
      true,
      requestId,
    );
  }

  if (!providerResponse.ok) {
    if (providerResponse.status === 429) {
      return apiError(429, "RATE_LIMITED", "Live voice is at capacity. Try again shortly.", true, requestId);
    }
    return apiError(
      503,
      "REALTIME_UNAVAILABLE",
      "Realtime Communicator is temporarily unavailable.",
      true,
      requestId,
    );
  }

  const providerPayload: unknown = await providerResponse.json().catch(() => null);
  const parsedProviderPayload = providerClientSecretSchema.safeParse(providerPayload);
  if (!parsedProviderPayload.success) {
    return apiError(
      503,
      "REALTIME_UNAVAILABLE",
      "Realtime Communicator is temporarily unavailable.",
      true,
      requestId,
    );
  }

  const response: RealtimeSessionResponse = {
    schemaVersion: 1,
    clientSecret: parsedProviderPayload.data.value,
    expiresAt: new Date(parsedProviderPayload.data.expires_at * 1_000).toISOString(),
    configuration: {
      realtimeModel: configuration.realtimeModel,
      transcriptionModel: configuration.transcriptionModel,
      voice: configuration.voice,
    },
  };

  return Response.json(response, {
    status: 200,
    headers: securityHeaders(),
  });
}

interface RealtimeRouteConfiguration {
  apiKey: string;
  allowedOrigin: string;
  realtimeModel: string;
  transcriptionModel: string;
  voice: string;
}

function readConfiguration(): RealtimeRouteConfiguration | null {
  if (process.env.LIVE_AI_ENABLED !== "true") return null;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const configuredOrigin = process.env.ALLOWED_ORIGIN?.trim();
  const realtimeModel = process.env.OPENAI_REALTIME_MODEL?.trim() || REALTIME_MODEL;
  const transcriptionModel =
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || TRANSCRIPTION_MODEL;
  const voice = REALTIME_VOICE;
  if (!apiKey || !configuredOrigin) return null;
  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(configuredOrigin).origin;
  } catch {
    return null;
  }
  if ([realtimeModel, transcriptionModel, voice].some((value) => value.length > 100)) return null;
  return {
    apiKey,
    allowedOrigin: normalizeOrigin(allowedOrigin),
    realtimeModel,
    transcriptionModel,
    voice,
  };
}

function validateOrigin(request: Request, allowedOrigin: string): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return "The request origin is required.";
  try {
    return normalizeOrigin(new URL(origin).origin) === allowedOrigin
      ? null
      : "The request origin is not allowed.";
  } catch {
    return "The request origin is invalid.";
  }
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

function apiError(
  status: number,
  code: ApiError["error"]["code"],
  message: string,
  retryable: boolean,
  requestId: string,
): Response {
  const body: ApiError = { error: { code, message, retryable, requestId } };
  return Response.json(body, { status, headers: securityHeaders() });
}

function securityHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}
