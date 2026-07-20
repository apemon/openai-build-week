import type { BrainHarness, BrainHarnessEvent } from "@/domain/brain-harness";
import type { V3BrainRequest } from "@/domain/v3-schemas";

import { logBrainSubmission } from "./debug-log";
import { BRAIN_TIMEOUT_MS, BrainRunError, mapProviderError } from "./retry-policy";
import { runV3Brain, type V3BrainRunnerOptions } from "./run-v3-brain";
import type { BrainHarnessConfiguration } from "./harness-config";
import { runResponsesNativeBrain } from "./responses-native";

class AsyncEventQueue<T> {
  private values: T[] = [];
  private waiters: Array<() => void> = [];
  private failure: unknown = null;
  private done = false;

  push(value: T): void {
    if (this.done) return;
    this.values.push(value);
    this.waiters.shift()?.();
  }

  close(): void {
    this.done = true;
    this.waiters.splice(0).forEach((resolve) => resolve());
  }

  reject(error: unknown): void {
    this.failure = error;
    this.close();
  }

  async *iterate(): AsyncIterable<T> {
    for (;;) {
      while (this.values.length > 0) yield this.values.shift()!;
      if (this.done) {
        if (this.failure) throw this.failure;
        return;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

function submissionContext(
  input: V3BrainRequest,
  options: Omit<V3BrainRunnerOptions, "signal" | "onLifecycle">,
) {
  return {
    requestId: input.requestId,
    operation: input.operation,
    baseRevision: input.baseRevision,
    turnCount: input.turns.length,
    requestedModel: options.model ?? process.env.OPENAI_BRAIN_MODEL ?? "gpt-5.6",
    timeoutMs: options.timeoutMs ?? BRAIN_TIMEOUT_MS,
    executionMode: "background" as const,
  };
}

function statusForFailure(error: unknown): number {
  switch (mapProviderError(error).code) {
    case "MODEL_TIMEOUT": return 504;
    case "MODEL_REFUSAL":
    case "INVALID_MODEL_OUTPUT": return 422;
    case "RATE_LIMITED": return 429;
    case "INVALID_REQUEST": return 400;
    default: return 502;
  }
}

/** Production default: one GPT-5.6 background Response plus one bounded repair. */
export class OneShotBrainHarness implements BrainHarness {
  constructor(private readonly options: Omit<V3BrainRunnerOptions, "signal" | "onLifecycle"> = {}) {}

  async *run(input: V3BrainRequest, signal: AbortSignal): AsyncIterable<BrainHarnessEvent> {
    const queue = new AsyncEventQueue<BrainHarnessEvent>();
    const startedAt = Date.now();
    const logContext = submissionContext(input, this.options);
    logBrainSubmission({ event: "submitted", ...logContext });
    void runV3Brain(input, {
      ...this.options,
      signal,
      onLifecycle: (event) => queue.push({ type: "lifecycle", event }),
    }).then(
      (response) => {
        logBrainSubmission({
          event: "succeeded",
          ...logContext,
          elapsedMs: Date.now() - startedAt,
          revision: response.revision,
          actualModel: response.provenance.actualModel,
          repairAttempted: response.provenance.repairAttempted,
        });
        queue.push({ type: "result", response });
        queue.close();
      },
      (error) => {
        const mapped = mapProviderError(error);
        logBrainSubmission({
          event: "failed",
          ...logContext,
          elapsedMs: Date.now() - startedAt,
          errorCode: mapped.code,
          retryable: mapped.retryable,
          status: statusForFailure(error),
        });
        queue.reject(error);
      },
    );
    yield* queue.iterate();
  }
}

export class ResponsesNativeBrainHarness implements BrainHarness {
  constructor(private readonly options: Omit<V3BrainRunnerOptions, "signal" | "onLifecycle"> = {}) {}

  async *run(input: V3BrainRequest, signal: AbortSignal): AsyncIterable<BrainHarnessEvent> {
    const queue = new AsyncEventQueue<BrainHarnessEvent>();
    const startedAt = Date.now();
    const logContext = submissionContext(input, this.options);
    logBrainSubmission({ event: "submitted", ...logContext });
    void runResponsesNativeBrain(input, {
      ...this.options,
      signal,
      onLifecycle: (event) => queue.push({ type: "lifecycle", event }),
    }).then(
      (response) => {
        logBrainSubmission({
          event: "succeeded",
          ...logContext,
          elapsedMs: Date.now() - startedAt,
          revision: response.revision,
          actualModel: response.provenance.actualModel,
          repairAttempted: response.provenance.repairAttempted,
        });
        queue.push({ type: "result", response });
        queue.close();
      },
      (error) => {
        const mapped = mapProviderError(error);
        logBrainSubmission({
          event: "failed",
          ...logContext,
          elapsedMs: Date.now() - startedAt,
          errorCode: mapped.code,
          retryable: mapped.retryable,
          status: statusForFailure(error),
        });
        queue.reject(error);
      },
    );
    yield* queue.iterate();
  }
}

export function createLiveBrainHarness(
  configuration: BrainHarnessConfiguration,
  options: Omit<V3BrainRunnerOptions, "signal" | "onLifecycle"> = {},
): BrainHarness {
  switch (configuration.mode) {
    case "one_shot":
      return new OneShotBrainHarness(options);
    case "responses_native":
      return new ResponsesNativeBrainHarness(options);
    case "codex_ephemeral":
      throw new BrainRunError("INVALID_REQUEST", "codex_ephemeral is unavailable on the ordinary Live route.", false);
  }
}
