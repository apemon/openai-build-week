import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { parseResponse } from "openai/lib/ResponsesParser";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { z } from "zod";

import { brainLifecycleEventSchema } from "@/domain/v3-schemas";
import type { BrainLifecycleEvent, V3BrainRequest, V3BrainResponse } from "@/domain/v3-schemas";

import { BrainRunError, mapProviderError } from "./retry-policy";
import { BRAIN_POLL_INTERVAL_MS, BRAIN_TIMEOUT_MS } from "./retry-policy";
import { runV3Brain, type V3ResponsesClient } from "./run-v3-brain";
import { buildV3BrainInput } from "./v3-prompt";

const analystSchema = z.object({
  contradictions: z.array(z.string().trim().min(1).max(500)).max(20),
  dependencyFindings: z.array(z.string().trim().min(1).max(500)).max(30),
  missingDecisions: z.array(z.string().trim().min(1).max(500)).max(30),
  provenanceRisks: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

const criticSchema = z.object({
  corrections: z.array(z.string().trim().min(1).max(500)).max(30),
  authorityWarnings: z.array(z.string().trim().min(1).max(500)).max(20),
  permitCouplingRisks: z.array(z.string().trim().min(1).max(500)).max(20),
  acceptanceCriterionGaps: z.array(z.string().trim().min(1).max(500)).max(30),
}).strict();

interface ProviderResponse {
  id?: unknown;
  status?: unknown;
  output?: unknown;
  output_parsed?: unknown;
}

export interface ResponsesNativeOptions {
  responses?: V3ResponsesClient;
  model?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => Date;
  onLifecycle?: (event: BrainLifecycleEvent) => void;
  signal?: AbortSignal;
}

function client(): V3ResponsesClient {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses as unknown as V3ResponsesClient;
}

function status(value: unknown): unknown {
  return value && typeof value === "object" ? (value as ProviderResponse).status : undefined;
}

function id(value: unknown): string | null {
  const candidate = value && typeof value === "object" ? (value as ProviderResponse).id : null;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

async function cancelInternalPass(responses: V3ResponsesClient, responseId: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    await responses.cancel(responseId, { signal: controller.signal });
  } catch {
    // Best-effort cleanup is not correctness evidence.
  } finally {
    clearTimeout(timeout);
  }
}

async function internalPass<T extends z.ZodType>(
  responses: V3ResponsesClient,
  model: string,
  schema: T,
  schemaName: string,
  system: string,
  input: string,
  controller: AbortController,
  pollIntervalMs: number,
  observeStatus: (kind: "provider_queued" | "provider_in_progress") => void,
): Promise<z.infer<T>> {
  const body = {
    model,
    reasoning: { effort: "medium" as const },
    background: true,
    store: false,
    input: [{ role: "system" as const, content: system }, { role: "user" as const, content: input }],
    text: { format: zodTextFormat(schema, schemaName) },
  };
  let responseId: string | null = null;
  try {
    let response = await responses.create(body, { signal: controller.signal });
    responseId = id(response);
    while (status(response) === "queued" || status(response) === "in_progress") {
      observeStatus(status(response) === "queued" ? "provider_queued" : "provider_in_progress");
      if (!responseId) throw new BrainRunError("INTERNAL_ERROR", "The experimental provider response had no identifier.", true);
      await wait(pollIntervalMs, controller.signal);
      response = await responses.retrieve(responseId, undefined, { signal: controller.signal });
    }
    if (status(response) !== undefined && status(response) !== "completed") {
      throw new BrainRunError("INVALID_MODEL_OUTPUT", "An experimental Brain pass did not complete.", true);
    }
    let parsedResponse = response;
    if (Array.isArray((response as ProviderResponse).output)) {
      try {
        parsedResponse = parseResponse(response as Response, body as ResponseCreateParamsNonStreaming);
      } catch {
        throw new BrainRunError("INVALID_MODEL_OUTPUT", "An experimental Brain pass returned invalid output.", true);
      }
    }
    const parsed = schema.safeParse((parsedResponse as ProviderResponse).output_parsed);
    if (!parsed.success) throw new BrainRunError("INVALID_MODEL_OUTPUT", "An experimental Brain pass returned invalid output.", true);
    return parsed.data;
  } catch (error) {
    if (controller.signal.aborted && responseId) {
      await cancelInternalPass(responses, responseId);
    }
    throw error;
  }
}

/** Experimental three-pass Responses adapter. Internal analysis is bounded,
 * non-authoritative, never rendered, and discarded with the request. */
export async function runResponsesNativeBrain(
  request: V3BrainRequest,
  options: ResponsesNativeOptions = {},
): Promise<V3BrainResponse> {
  const responses = options.responses ?? client();
  const model = options.model ?? process.env.OPENAI_BRAIN_MODEL ?? "gpt-5.6";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? BRAIN_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const now = options.now ?? (() => new Date());
  let sequence = 0;
  const emit = (kind: BrainLifecycleEvent["kind"], attempt: 1 | 2 = 1): void => {
    options.onLifecycle?.(brainLifecycleEventSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      actionId: request.actionId,
      baseRevision: request.baseRevision,
      cancelEpoch: request.cancelEpoch,
      attempt,
      sequence: sequence++,
      observedAt: now().toISOString(),
      kind,
    }));
  };
  emit("request_accepted");
  try {
    const confirmedState = buildV3BrainInput(request);
    const analyst = await internalPass(
      responses,
      model,
      analystSchema,
      "brain_native_analyst",
      "Identify contradictions, dependencies, missing decisions, and provenance risks. Return concise findings only. Never make stakeholder decisions.",
      confirmedState,
      controller,
      options.pollIntervalMs ?? BRAIN_POLL_INTERVAL_MS,
      emit,
    );
    const critic = await internalPass(
      responses,
      model,
      criticSchema,
      "brain_native_critic",
      "Critique the bounded analyst findings against the confirmed state. Flag authority, coupling, and testability problems. Return no Specification.",
      `${confirmedState}\n\nNon-authoritative analyst findings:\n${JSON.stringify(analyst)}`,
      controller,
      options.pollIntervalMs ?? BRAIN_POLL_INTERVAL_MS,
      emit,
    );
    const response = await runV3Brain(request, {
      responses,
      model,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: controller.signal,
      now,
      additionalReferenceContext: JSON.stringify({ analyst, critic }),
      onLifecycle: (event) => {
        if (event.kind !== "request_accepted") emit(event.kind, event.attempt);
      },
    });
    return {
      ...response,
      provenance: {
        source: "experimental_evaluation",
        agent: "brain",
        harnessMode: "responses_native",
        publicSearchEnabled: false,
        localOnly: true,
        requestedModel: response.provenance.requestedModel,
        actualModel: response.provenance.actualModel,
        validatedAt: response.provenance.validatedAt,
        repairAttempted: response.provenance.repairAttempted,
      },
    };
  } catch (error) {
    if (controller.signal.aborted) {
      emit("cancellation_requested");
      throw new BrainRunError("MODEL_TIMEOUT", "The experimental Brain request timed out.", true, { cause: error });
    }
    throw mapProviderError(error);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
