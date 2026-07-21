import type { ApiError } from "@/domain/types";

import { DEFAULT_BRAIN_TIMEOUT_MS } from "./runtime-config";

export type BrainErrorCode = ApiError["error"]["code"];

export class BrainRunError extends Error {
  readonly code: BrainErrorCode;
  readonly retryable: boolean;

  constructor(code: BrainErrorCode, message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrainRunError";
    this.code = code;
    this.retryable = retryable;
  }
}

export const BRAIN_TIMEOUT_MS = DEFAULT_BRAIN_TIMEOUT_MS;
export const BRAIN_POLL_INTERVAL_MS = 2_000;

export function compactValidationErrors(errors: readonly string[]): string[] {
  return errors.slice(0, 12).map((error) => error.replace(/\s+/g, " ").slice(0, 240));
}

export function isRepairableBrainError(error: unknown): error is BrainRunError {
  return (
    error instanceof BrainRunError &&
    (error.code === "INVALID_MODEL_OUTPUT" || error.code === "MODEL_REFUSAL")
  );
}

export function mapProviderError(error: unknown): BrainRunError {
  if (error instanceof BrainRunError) return error;

  type ProviderErrorCandidate = {
    name?: unknown;
    status?: unknown;
    code?: unknown;
    param?: unknown;
    type?: unknown;
    cause?: unknown;
  };

  const chain: ProviderErrorCandidate[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as ProviderErrorCandidate;
    chain.push(candidate);
    current = candidate.cause;
  }

  const timedOut = chain.some(
    (candidate) =>
      candidate.name === "AbortError" ||
      candidate.name === "APIUserAbortError" ||
      candidate.name === "APIConnectionTimeoutError" ||
      candidate.code === "ABORT_ERR" ||
      candidate.status === 408 ||
      candidate.status === 504,
  );
  if (timedOut) {
    return new BrainRunError("MODEL_TIMEOUT", "The Brain request timed out.", true, { cause: error });
  }

  const candidate = chain[0] ?? null;
  if (candidate?.name === "LengthFinishReasonError" || candidate?.name === "ContentFilterFinishReasonError") {
    return new BrainRunError("INVALID_MODEL_OUTPUT", "The Brain returned an incomplete response.", true, {
      cause: error,
    });
  }
  if (candidate?.status === 429 || candidate?.code === "rate_limit_exceeded") {
    return new BrainRunError("RATE_LIMITED", "The Brain is temporarily rate limited.", true, { cause: error });
  }
  if (candidate?.status === 401 || candidate?.status === 403) {
    return new BrainRunError(
      "INTERNAL_ERROR",
      "The OpenAI project is not authorized for this Brain request.",
      false,
      { cause: error },
    );
  }
  if (candidate?.status === 404) {
    return new BrainRunError(
      "INVALID_REQUEST",
      "The configured Brain model is unavailable to this OpenAI project.",
      false,
      { cause: error },
    );
  }
  if (candidate?.status === 400) {
    const parameter = typeof candidate.param === "string" ? candidate.param : "";
    const providerCode = typeof candidate.code === "string" ? candidate.code : "";
    const safeReason = parameter === "model" || providerCode === "model_not_found"
      ? "The configured Brain model is unavailable to this OpenAI project."
      : parameter === "background"
        ? "The configured Brain model does not accept background execution."
        : parameter === "store"
          ? "The provider rejected the required store:false privacy setting."
          : parameter.startsWith("text.format") || providerCode === "invalid_json_schema"
            ? "The provider rejected the Brain Structured Output schema."
            : parameter === "reasoning.effort" || parameter === "reasoning"
              ? "The configured Brain model does not accept medium reasoning effort."
              : "The provider rejected the configured Brain request.";
    return new BrainRunError(
      "INVALID_REQUEST",
      safeReason,
      false,
      { cause: error },
    );
  }
  return new BrainRunError("INTERNAL_ERROR", "The Brain provider request failed.", true, { cause: error });
}
