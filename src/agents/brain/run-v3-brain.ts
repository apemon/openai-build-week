import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { parseResponse } from "openai/lib/ResponsesParser";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

import { brainLifecycleEventSchema, v3BrainModelOutputSchema } from "@/domain/v3-schemas";
import type {
  BrainLifecycleEvent,
  V3BrainModelOutput,
  V3BrainRequest,
  V3BrainResponse,
} from "@/domain/v3-schemas";

import { BrainRunError, compactValidationErrors, isRepairableBrainError, mapProviderError } from "./retry-policy";
import { BRAIN_POLL_INTERVAL_MS, BRAIN_TIMEOUT_MS } from "./retry-policy";
import { buildV3BrainInput, buildV3RepairInput, V3_BRAIN_SYSTEM_PROMPT } from "./v3-prompt";
import { validateV3BrainOutput, validateV3BrainRequest } from "./v3-semantic-validator";

export interface V3ResponsesClient {
  create: (body: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
  retrieve: (responseId: string, query?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
  cancel: (responseId: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

export interface V3BrainRunnerOptions {
  responses?: V3ResponsesClient;
  model?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
  onLifecycle?: (event: BrainLifecycleEvent) => void;
  /** Non-authoritative, request-local analysis used only by an experimental
   * adapter. It never becomes provenance or durable state. */
  additionalReferenceContext?: string;
}

interface ProviderResponse {
  id?: unknown;
  model?: unknown;
  status?: unknown;
  output_parsed?: unknown;
  output?: unknown;
}

interface AttemptResult {
  output: V3BrainModelOutput;
  actualModel: string;
}

class InvalidV3ModelOutputError extends BrainRunError {
  readonly rejectedOutput: V3BrainModelOutput | null;
  readonly validationErrors: string[];

  constructor(rejectedOutput: V3BrainModelOutput | null, validationErrors: string[]) {
    super("INVALID_MODEL_OUTPUT", "The Brain returned a semantically invalid response.", true);
    this.rejectedOutput = rejectedOutput;
    this.validationErrors = compactValidationErrors(validationErrors);
  }
}

function createResponsesClient(): V3ResponsesClient {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses as unknown as V3ResponsesClient;
}

function responseStatus(response: unknown): unknown {
  return response && typeof response === "object" ? (response as ProviderResponse).status : undefined;
}

function responseId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const id = (response as ProviderResponse).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (!item || typeof item !== "object") return false;
    const content = (item as { content?: unknown }).content;
    return Array.isArray(content) && content.some((part) =>
      Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "refusal"));
  });
}

function parseTerminalResponse(response: unknown, body: unknown): unknown {
  if (!response || typeof response !== "object") return response;
  const candidate = response as ProviderResponse;
  if (candidate.status !== undefined && candidate.status !== "completed") return response;
  if (!Array.isArray(candidate.output)) return response;
  try {
    return parseResponse(response as Response, body as ResponseCreateParamsNonStreaming);
  } catch {
    throw new InvalidV3ModelOutputError(null, ["Structured output parsing failed."]);
  }
}

function validateProviderResponse(response: unknown, request: V3BrainRequest): AttemptResult {
  if (!response || typeof response !== "object") {
    throw new BrainRunError("INVALID_MODEL_OUTPUT", "The Brain returned no response.", true);
  }
  const candidate = response as ProviderResponse;
  if (containsRefusal(candidate.output)) throw new BrainRunError("MODEL_REFUSAL", "The Brain refused the request.", true);
  if (candidate.status === "incomplete") {
    throw new BrainRunError("INVALID_MODEL_OUTPUT", "The Brain returned an incomplete response.", true);
  }
  if (candidate.status !== undefined && candidate.status !== "completed") {
    throw new BrainRunError("INTERNAL_ERROR", "The Brain provider request did not complete.", true);
  }
  const parsed = v3BrainModelOutputSchema.safeParse(candidate.output_parsed);
  if (!parsed.success) {
    throw new InvalidV3ModelOutputError(
      null,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`),
    );
  }
  const semantic = validateV3BrainOutput(request, parsed.data);
  if (!semantic.valid) throw new InvalidV3ModelOutputError(parsed.data, semantic.errors);
  return {
    output: parsed.data,
    actualModel: typeof candidate.model === "string" && candidate.model.length > 0 ? candidate.model : "unknown",
  };
}

function waitForPoll(intervalMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
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

const CANCEL_TIMEOUT_MS = 2_000;

async function bestEffortCancel(responses: V3ResponsesClient, id: string | null): Promise<void> {
  if (!id) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CANCEL_TIMEOUT_MS);
  try {
    await responses.cancel(id, { signal: controller.signal });
  } catch {
    // Provider cancellation is cleanup only and is never used as correctness evidence.
  } finally {
    clearTimeout(timeout);
  }
}

function lifecycleEmitter(request: V3BrainRequest, options: V3BrainRunnerOptions) {
  let sequence = 0;
  const now = options.now ?? (() => new Date());
  return (kind: BrainLifecycleEvent["kind"], attempt: 1 | 2): void => {
    const event = brainLifecycleEventSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      actionId: request.actionId,
      baseRevision: request.baseRevision,
      cancelEpoch: request.cancelEpoch,
      attempt,
      sequence,
      observedAt: now().toISOString(),
      kind,
    });
    sequence += 1;
    options.onLifecycle?.(event);
  };
}

async function providerAttempt(
  responses: V3ResponsesClient,
  model: string,
  input: string,
  request: V3BrainRequest,
  attempt: 1 | 2,
  emit: (kind: BrainLifecycleEvent["kind"], attempt: 1 | 2) => void,
  options: V3BrainRunnerOptions,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? BRAIN_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let id: string | null = null;
  let providerTerminalEmitted = false;
  try {
    controller.signal.throwIfAborted();
    const body = {
      model,
      reasoning: { effort: "medium" as const },
      background: true,
      store: false,
      input: [
        { role: "system" as const, content: V3_BRAIN_SYSTEM_PROMPT },
        { role: "user" as const, content: input },
      ],
      text: { format: zodTextFormat(v3BrainModelOutputSchema, "v3_brain_model_output") },
    };
    let response = await responses.create(body, { signal: controller.signal });
    id = responseId(response);
    const initialStatus = responseStatus(response);
    if (initialStatus === "queued") emit("provider_queued", attempt);
    else if (initialStatus === "in_progress") emit("provider_in_progress", attempt);

    while (responseStatus(response) === "queued" || responseStatus(response) === "in_progress") {
      if (!id) throw new BrainRunError("INTERNAL_ERROR", "The Brain provider response had no identifier.", true);
      await waitForPoll(options.pollIntervalMs ?? BRAIN_POLL_INTERVAL_MS, controller.signal);
      response = await responses.retrieve(id, undefined, { signal: controller.signal });
      if (responseStatus(response) === "queued") emit("provider_queued", attempt);
      else if (responseStatus(response) === "in_progress") emit("provider_in_progress", attempt);
    }
    emit("provider_attempt_terminal", attempt);
    providerTerminalEmitted = true;
    emit("validating_output", attempt);
    return validateProviderResponse(parseTerminalResponse(response, body), request);
  } catch (error) {
    if (!providerTerminalEmitted) emit("provider_attempt_terminal", attempt);
    if (controller.signal.aborted) {
      emit("cancellation_requested", attempt);
      await bestEffortCancel(responses, id);
      throw new BrainRunError("MODEL_TIMEOUT", "The Brain request timed out.", true, { cause: error });
    }
    throw mapProviderError(error);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function runV3Brain(
  request: V3BrainRequest,
  options: V3BrainRunnerOptions = {},
): Promise<V3BrainResponse> {
  const validation = validateV3BrainRequest(request);
  if (!validation.valid) throw new BrainRunError("INVALID_REQUEST", "The Brain request failed semantic validation.", false);
  const emit = lifecycleEmitter(request, options);
  emit("request_accepted", 1);
  const requestedModel = options.model ?? process.env.OPENAI_BRAIN_MODEL ?? "gpt-5.6";
  const responses = options.responses ?? createResponsesClient();
  let repairAttempted = false;
  let result: AttemptResult;
  const primaryInput = options.additionalReferenceContext
    ? `${buildV3BrainInput(request)}\n\nNon-authoritative bounded internal analysis (critique only; never Product Manager authority):\n${options.additionalReferenceContext}`
    : buildV3BrainInput(request);
  try {
    result = await providerAttempt(
      responses,
      requestedModel,
      primaryInput,
      request,
      1,
      emit,
      options,
    );
  } catch (error) {
    if (!isRepairableBrainError(error)) throw error;
    repairAttempted = true;
    emit("repair_started", 2);
    result = await providerAttempt(
      responses,
      requestedModel,
      `${buildV3RepairInput(
        request,
        error instanceof InvalidV3ModelOutputError ? error.rejectedOutput : null,
        error instanceof InvalidV3ModelOutputError ? error.validationErrors : [error.message],
      )}${options.additionalReferenceContext
        ? `\n\nNon-authoritative bounded internal analysis:\n${options.additionalReferenceContext}`
        : ""}`,
      request,
      2,
      emit,
      options,
    );
  }
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    baseRevision: request.baseRevision,
    revision: request.operation === "revalidate_restored" ? request.baseRevision : request.baseRevision + 1,
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
