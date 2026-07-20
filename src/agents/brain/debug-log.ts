import type { BrainErrorCode } from "./retry-policy";
import type { BrainOperation } from "@/domain/types";

type BrainSubmissionBase = {
  requestId: string;
  operation: BrainOperation;
  baseRevision: number;
  turnCount: number;
  requestedModel: string;
  timeoutMs: number;
  executionMode: "background";
};

type BrainSubmissionEvent =
  | (BrainSubmissionBase & { event: "submitted" })
  | (BrainSubmissionBase & {
      event: "succeeded";
      elapsedMs: number;
      revision: number;
      actualModel: string;
      repairAttempted: boolean;
    })
  | (BrainSubmissionBase & {
      event: "failed";
      elapsedMs: number;
      errorCode: BrainErrorCode;
      retryable: boolean;
      status: number;
    });

export type BrainProviderTraceCall = "create" | "retrieve" | "cancel" | "validate";
export type BrainProviderTraceDirection = "request" | "response" | "error";
export type BrainProviderStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "incomplete"
  | "cancelled"
  | "unknown";

export type BrainProviderTraceEvent = {
  requestId: string;
  operation: BrainOperation;
  attempt: 1 | 2;
  call: BrainProviderTraceCall;
  direction: BrainProviderTraceDirection;
  sequence: number;
  status?: BrainProviderStatus;
  requestedModel?: string;
  actualModel?: string;
  background?: boolean;
  store?: boolean;
  reasoningEffort?: "medium";
  schemaName?: "brain_model_output";
  elapsedMs?: number;
  outputItemCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  errorCode?: BrainErrorCode;
  hasProviderResponseId?: boolean;
};

function safeModel(value: string): string {
  return /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : "unknown";
}

function safeNonnegativeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function submissionPayload(event: BrainSubmissionEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event: event.event,
    requestId: event.requestId,
    operation: event.operation,
    baseRevision: event.baseRevision,
    turnCount: event.turnCount,
    requestedModel: safeModel(event.requestedModel),
    timeoutMs: event.timeoutMs,
    executionMode: event.executionMode,
  };
  if (event.event === "succeeded") {
    payload.elapsedMs = event.elapsedMs;
    payload.revision = event.revision;
    payload.actualModel = safeModel(event.actualModel);
    payload.repairAttempted = event.repairAttempted;
  } else if (event.event === "failed") {
    payload.elapsedMs = event.elapsedMs;
    payload.errorCode = event.errorCode;
    payload.retryable = event.retryable;
    payload.status = event.status;
  }
  return payload;
}

function providerPayload(event: BrainProviderTraceEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    requestId: event.requestId,
    operation: event.operation,
    attempt: event.attempt,
    call: event.call,
    direction: event.direction,
    sequence: safeNonnegativeInteger(event.sequence),
  };
  if (event.status !== undefined) payload.status = event.status;
  if (event.requestedModel !== undefined) payload.requestedModel = safeModel(event.requestedModel);
  if (event.actualModel !== undefined) payload.actualModel = safeModel(event.actualModel);
  if (event.background !== undefined) payload.background = event.background;
  if (event.store !== undefined) payload.store = event.store;
  if (event.reasoningEffort !== undefined) payload.reasoningEffort = event.reasoningEffort;
  if (event.schemaName !== undefined) payload.schemaName = event.schemaName;
  if (event.elapsedMs !== undefined) payload.elapsedMs = safeNonnegativeInteger(event.elapsedMs);
  if (event.outputItemCount !== undefined) payload.outputItemCount = safeNonnegativeInteger(event.outputItemCount);
  if (event.inputTokens !== undefined) payload.inputTokens = safeNonnegativeInteger(event.inputTokens);
  if (event.outputTokens !== undefined) payload.outputTokens = safeNonnegativeInteger(event.outputTokens);
  if (event.reasoningTokens !== undefined) payload.reasoningTokens = safeNonnegativeInteger(event.reasoningTokens);
  if (event.totalTokens !== undefined) payload.totalTokens = safeNonnegativeInteger(event.totalTokens);
  if (event.errorCode !== undefined) payload.errorCode = event.errorCode;
  if (event.hasProviderResponseId !== undefined) payload.hasProviderResponseId = event.hasProviderResponseId;
  return payload;
}

export function logBrainSubmission(event: BrainSubmissionEvent): void {
  if (process.env.BRAIN_DEBUG_LOGS !== "true") return;

  console.info(
    "[spec-grill:brain]",
    JSON.stringify(submissionPayload(event)),
  );
}

export function logBrainProviderTrace(event: BrainProviderTraceEvent): void {
  if (process.env.BRAIN_DEBUG_LOGS !== "true") return;
  console.info("[spec-grill:brain:provider]", JSON.stringify(providerPayload(event)));
}
