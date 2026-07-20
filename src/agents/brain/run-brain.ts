import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { parseResponse } from "openai/lib/ResponsesParser";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

import { brainModelOutputSchema } from "@/domain/schemas";
import type { BrainModelOutput, BrainRequest, BrainResponse } from "@/domain/types";

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
}

interface AttemptResult {
  output: BrainModelOutput;
  actualModel: string;
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
): Promise<void> {
  if (!providerResponseId) return;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      responses.cancel(providerResponseId, { signal: controller.signal }),
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve();
        }, CANCEL_TIMEOUT_MS);
      }),
    ]);
  } catch {
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
  externalSignal?: AbortSignal,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  let providerResponseId: string | null = null;
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
    let response = await responses.create(body, { signal: controller.signal });
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
      response = await responses.retrieve(providerResponseId, undefined, {
        signal: controller.signal,
      });
    }

    return validateProviderResponse(parseTerminalResponse(response, body), request);
  } catch (error) {
    if (controller.signal.aborted) {
      await bestEffortCancel(responses, providerResponseId);
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
