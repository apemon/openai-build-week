import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { parseResponse } from "openai/lib/ResponsesParser";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

import { brainModelOutputSchema } from "@/domain/schemas";
import type { BrainModelOutput, BrainRequest, BrainResponse } from "@/domain/types";

import {
  logBrainProviderTrace,
  type BrainProviderStatus,
} from "./debug-log";
import { BRAIN_SYSTEM_PROMPT, buildBrainInput, buildRepairInput } from "./prompt";
import {
  BRAIN_POLL_INTERVAL_MS,
  BRAIN_TIMEOUT_MS,
  BrainRunError,
  compactValidationErrors,
  isRepairableBrainError,
  mapProviderError,
} from "./retry-policy";
import { validateBrainOutput, validateBrainRequest } from "./semantic-validator";

interface ResponsesClient {
  create: (body: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
  retrieve: (
    responseId: string,
    query?: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  cancel: (responseId: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

export interface BrainRunnerOptions {
  responses?: ResponsesClient;
  model?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
}

interface ProviderResponse {
  id?: unknown;
  model?: unknown;
  status?: unknown;
  output_parsed?: unknown;
  output?: unknown;
  usage?: unknown;
}

interface AttemptResult {
  output: BrainModelOutput;
  actualModel: string;
}

interface TraceContext {
  requestId: string;
  operation: BrainRequest["operation"];
  attempt: 1 | 2;
}

interface SafeUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (!item || typeof item !== "object") return false;
    const content = (item as { content?: unknown }).content;
    return Array.isArray(content) && content.some((part) => {
      return Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "refusal");
    });
  });
}

function validateProviderResponse(response: unknown, request: BrainRequest): AttemptResult {
  if (!response || typeof response !== "object") {
    throw new BrainRunError("INVALID_MODEL_OUTPUT", "The Brain returned no response.", true);
  }
  const candidate = response as ProviderResponse;
  if (containsRefusal(candidate.output)) {
    throw new BrainRunError("MODEL_REFUSAL", "The Brain refused the request.", true);
  }
  if (candidate.status === "incomplete") {
    throw new BrainRunError("INVALID_MODEL_OUTPUT", "The Brain returned an incomplete response.", true);
  }
  if (candidate.status !== undefined && candidate.status !== "completed") {
    throw new BrainRunError("INTERNAL_ERROR", "The Brain provider request did not complete.", true);
  }

  const parsed = brainModelOutputSchema.safeParse(candidate.output_parsed);
  if (!parsed.success) {
    throw new InvalidModelOutputError(
      null,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`),
    );
  }
  const semantic = validateBrainOutput(request, parsed.data);
  if (!semantic.valid) {
    throw new InvalidModelOutputError(parsed.data, semantic.errors);
  }

  return {
    output: parsed.data,
    actualModel: typeof candidate.model === "string" && candidate.model.length > 0 ? candidate.model : "unknown",
  };
}

class InvalidModelOutputError extends BrainRunError {
  readonly rejectedOutput: BrainModelOutput | null;
  readonly validationErrors: string[];

  constructor(rejectedOutput: BrainModelOutput | null, validationErrors: string[]) {
    super("INVALID_MODEL_OUTPUT", "The Brain returned a semantically invalid response.", true);
    this.rejectedOutput = rejectedOutput;
    this.validationErrors = compactValidationErrors(validationErrors);
  }
}

function createResponsesClient(): ResponsesClient {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client.responses as unknown as ResponsesClient;
}

function waitForPoll(intervalMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function responseStatus(response: unknown): unknown {
  return response && typeof response === "object"
    ? (response as ProviderResponse).status
    : undefined;
}

function responseId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const id = (response as ProviderResponse).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function safeProviderStatus(response: unknown): BrainProviderStatus {
  const status = responseStatus(response);
  return status === "queued"
    || status === "in_progress"
    || status === "completed"
    || status === "failed"
    || status === "incomplete"
    || status === "cancelled"
    ? status
    : "unknown";
}

function safeProviderModel(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const model = (response as ProviderResponse).model;
  return typeof model === "string" ? model : undefined;
}

function safeOutputItemCount(response: unknown): number {
  if (!response || typeof response !== "object") return 0;
  const output = (response as ProviderResponse).output;
  return Array.isArray(output) ? output.length : 0;
}

function safeUsage(response: unknown): SafeUsage {
  if (!response || typeof response !== "object") return {};
  const usage = (response as ProviderResponse).usage;
  if (!usage || typeof usage !== "object") return {};
  const candidate = usage as Record<string, unknown>;
  const outputDetails = candidate.output_tokens_details;
  const reasoningTokens = outputDetails && typeof outputDetails === "object"
    ? (outputDetails as Record<string, unknown>).reasoning_tokens
    : undefined;
  const result: SafeUsage = {};
  if (typeof candidate.input_tokens === "number") result.inputTokens = candidate.input_tokens;
  if (typeof candidate.output_tokens === "number") result.outputTokens = candidate.output_tokens;
  if (typeof reasoningTokens === "number") result.reasoningTokens = reasoningTokens;
  if (typeof candidate.total_tokens === "number") result.totalTokens = candidate.total_tokens;
  return result;
}

function traceResponse(
  trace: TraceContext,
  call: "create" | "retrieve" | "cancel",
  sequence: number,
  response: unknown,
  elapsedMs: number,
): void {
  logBrainProviderTrace({
    ...trace,
    call,
    direction: "response",
    sequence,
    status: safeProviderStatus(response),
    actualModel: safeProviderModel(response),
    elapsedMs,
    outputItemCount: safeOutputItemCount(response),
    hasProviderResponseId: responseId(response) !== null,
    ...safeUsage(response),
  });
}

function traceError(
  trace: TraceContext,
  call: "create" | "retrieve" | "cancel" | "validate",
  sequence: number,
  error: unknown,
  elapsedMs: number,
): void {
  logBrainProviderTrace({
    ...trace,
    call,
    direction: "error",
    sequence,
    elapsedMs,
    errorCode: mapProviderError(error).code,
  });
}

function parseTerminalResponse(response: unknown, body: unknown): unknown {
  if (!response || typeof response !== "object") return response;
  const candidate = response as ProviderResponse;
  if (candidate.status !== undefined && candidate.status !== "completed") return response;
  if (!Array.isArray(candidate.output)) return response;
  try {
    return parseResponse(
      response as Response,
      body as ResponseCreateParamsNonStreaming,
    );
  } catch {
    throw new InvalidModelOutputError(null, ["Structured output parsing failed."]);
  }
}

const CANCEL_TIMEOUT_MS = 2_000;

async function bestEffortCancel(
  responses: ResponsesClient,
  providerResponseId: string | null,
  trace: TraceContext,
  sequence: number,
): Promise<void> {
  if (!providerResponseId) return;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  logBrainProviderTrace({
    ...trace,
    call: "cancel",
    direction: "request",
    sequence,
    hasProviderResponseId: true,
  });
  try {
    const outcome = await Promise.race([
      responses.cancel(providerResponseId, { signal: controller.signal }).then((response) => ({
        kind: "response" as const,
        response,
      })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve({ kind: "timeout" });
        }, CANCEL_TIMEOUT_MS);
      }),
    ]);
    if (outcome.kind === "timeout") {
      traceError(trace, "cancel", sequence, new DOMException("aborted", "AbortError"), Date.now() - startedAt);
    } else {
      traceResponse(trace, "cancel", sequence, outcome.response, Date.now() - startedAt);
    }
  } catch (error) {
    traceError(trace, "cancel", sequence, error, Date.now() - startedAt);
    // Cancellation is cleanup only; preserve the application timeout result.
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function providerAttempt(
  responses: ResponsesClient,
  model: string,
  input: string,
  timeoutMs: number,
  pollIntervalMs: number,
  request: BrainRequest,
  attempt: 1 | 2,
  externalSignal?: AbortSignal,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  let providerResponseId: string | null = null;
  let sequence = 0;
  const trace: TraceContext = {
    requestId: request.requestId,
    operation: request.operation,
    attempt,
  };
  try {
    controller.signal.throwIfAborted();
    const body = {
      model,
      reasoning: { effort: "medium" as const },
      background: true,
      store: false,
      input: [
        { role: "system" as const, content: BRAIN_SYSTEM_PROMPT },
        { role: "user" as const, content: input },
      ],
      text: { format: zodTextFormat(brainModelOutputSchema, "brain_model_output") },
    };
    logBrainProviderTrace({
      ...trace,
      call: "create",
      direction: "request",
      sequence,
      requestedModel: model,
      background: true,
      store: false,
      reasoningEffort: "medium",
      schemaName: "brain_model_output",
      hasProviderResponseId: false,
    });
    const createStartedAt = Date.now();
    let response: unknown;
    try {
      response = await responses.create(body, { signal: controller.signal });
      traceResponse(trace, "create", sequence, response, Date.now() - createStartedAt);
    } catch (error) {
      traceError(trace, "create", sequence, error, Date.now() - createStartedAt);
      throw error;
    }
    providerResponseId = responseId(response);

    while (responseStatus(response) === "queued" || responseStatus(response) === "in_progress") {
      if (!providerResponseId) {
        throw new BrainRunError(
          "INTERNAL_ERROR",
          "The Brain provider response had no identifier.",
          true,
        );
      }
      await waitForPoll(pollIntervalMs, controller.signal);
      sequence += 1;
      logBrainProviderTrace({
        ...trace,
        call: "retrieve",
        direction: "request",
        sequence,
        hasProviderResponseId: true,
      });
      const retrieveStartedAt = Date.now();
      try {
        response = await responses.retrieve(providerResponseId, undefined, {
          signal: controller.signal,
        });
        traceResponse(trace, "retrieve", sequence, response, Date.now() - retrieveStartedAt);
      } catch (error) {
        traceError(trace, "retrieve", sequence, error, Date.now() - retrieveStartedAt);
        throw error;
      }
    }

    logBrainProviderTrace({
      ...trace,
      call: "validate",
      direction: "request",
      sequence,
      status: safeProviderStatus(response),
      hasProviderResponseId: providerResponseId !== null,
    });
    const validateStartedAt = Date.now();
    try {
      const result = validateProviderResponse(parseTerminalResponse(response, body), request);
      logBrainProviderTrace({
        ...trace,
        call: "validate",
        direction: "response",
        sequence,
        status: "completed",
        actualModel: result.actualModel,
        elapsedMs: Date.now() - validateStartedAt,
        hasProviderResponseId: providerResponseId !== null,
      });
      return result;
    } catch (error) {
      traceError(trace, "validate", sequence, error, Date.now() - validateStartedAt);
      throw error;
    }
  } catch (error) {
    if (controller.signal.aborted) {
      await bestEffortCancel(responses, providerResponseId, trace, sequence + 1);
      throw new BrainRunError("MODEL_TIMEOUT", "The Brain request timed out.", true, { cause: error });
    }
    throw mapProviderError(error);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function runBrain(request: BrainRequest, options: BrainRunnerOptions = {}): Promise<BrainResponse> {
  const requestValidation = validateBrainRequest(request);
  if (!requestValidation.valid) {
    throw new BrainRunError("INVALID_REQUEST", "The Brain request failed semantic validation.", false);
  }
  const requestedModel = options.model ?? process.env.OPENAI_BRAIN_MODEL ?? "gpt-5.6";
  const timeoutMs = options.timeoutMs ?? BRAIN_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? BRAIN_POLL_INTERVAL_MS;
  const responses = options.responses ?? createResponsesClient();
  let repairAttempted = false;
  let result: AttemptResult;

  try {
    result = await providerAttempt(
      responses,
      requestedModel,
      buildBrainInput(request),
      timeoutMs,
      pollIntervalMs,
      request,
      1,
      options.signal,
    );
  } catch (error) {
    if (!isRepairableBrainError(error)) throw error;
    repairAttempted = true;
    const rejectedOutput = error instanceof InvalidModelOutputError ? error.rejectedOutput : null;
    const validationErrors =
      error instanceof InvalidModelOutputError ? error.validationErrors : [error.message];
    result = await providerAttempt(
      responses,
      requestedModel,
      buildRepairInput(request, rejectedOutput, validationErrors),
      timeoutMs,
      pollIntervalMs,
      request,
      2,
      options.signal,
    );
  }

  return {
    schemaVersion: 1,
    requestId: request.requestId,
    baseRevision: request.baseRevision,
    revision: request.baseRevision + 1,
    provenance: {
      source: "live_ai",
      agent: "brain",
      requestedModel,
      actualModel: result.actualModel,
      validatedAt: (options.now ?? (() => new Date()))().toISOString(),
      repairAttempted,
    },
    output: result.output,
  };
}
