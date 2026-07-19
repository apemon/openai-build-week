import { apiErrorSchema, realtimeSessionResponseSchema } from "@/domain/schemas";
import type { RealtimeSessionResponse } from "@/domain/types";

import type { CommunicatorSessionConfig } from "./CommunicatorTransport";

export class RealtimeSessionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "RealtimeSessionError";
    this.code = code;
    this.retryable = retryable;
  }
}

export async function requestRealtimeSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<RealtimeSessionResponse> {
  const response = await fetch("/api/realtime/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, sessionId }),
    cache: "no-store",
    signal,
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    if (parsedError.success) {
      throw new RealtimeSessionError(
        parsedError.data.error.code,
        parsedError.data.error.message,
        parsedError.data.error.retryable,
      );
    }
    throw new RealtimeSessionError(
      "REALTIME_UNAVAILABLE",
      "Realtime Communicator is unavailable.",
      true,
    );
  }

  const parsed = realtimeSessionResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new RealtimeSessionError(
      "INVALID_REQUEST",
      "The Realtime session response was invalid.",
      true,
    );
  }
  return parsed.data;
}

export function toCommunicatorSessionConfig(
  sessionId: string,
  response: RealtimeSessionResponse,
): CommunicatorSessionConfig {
  return {
    sessionId,
    clientSecret: response.clientSecret,
    realtimeModel: response.configuration.realtimeModel,
  };
}
