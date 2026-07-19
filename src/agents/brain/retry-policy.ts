import type { ApiError } from "@/domain/types";

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

export const BRAIN_TIMEOUT_MS = 30_000;

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
  if (error instanceof DOMException && error.name === "AbortError") {
    return new BrainRunError("MODEL_TIMEOUT", "The Brain request timed out.", true, { cause: error });
  }

  const candidate = error as { name?: unknown; status?: unknown; code?: unknown } | null;
  if (
    candidate?.name === "AbortError" ||
    candidate?.name === "APIUserAbortError" ||
    candidate?.name === "APIConnectionTimeoutError" ||
    candidate?.status === 408 ||
    candidate?.status === 504
  ) {
    return new BrainRunError("MODEL_TIMEOUT", "The Brain request timed out.", true, { cause: error });
  }
  if (candidate?.name === "LengthFinishReasonError" || candidate?.name === "ContentFilterFinishReasonError") {
    return new BrainRunError("INVALID_MODEL_OUTPUT", "The Brain returned an incomplete response.", true, {
      cause: error,
    });
  }
  if (candidate?.status === 429 || candidate?.code === "rate_limit_exceeded") {
    return new BrainRunError("RATE_LIMITED", "The Brain is temporarily rate limited.", true, { cause: error });
  }
  return new BrainRunError("INTERNAL_ERROR", "The Brain provider request failed.", true, { cause: error });
}
