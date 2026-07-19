import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { brainModelOutputSchema } from "@/domain/schemas";
import type { BrainModelOutput, BrainRequest, BrainResponse } from "@/domain/types";

import { BRAIN_SYSTEM_PROMPT, buildBrainInput, buildRepairInput } from "./prompt";
import {
  BRAIN_TIMEOUT_MS,
  BrainRunError,
  compactValidationErrors,
  isRepairableBrainError,
  mapProviderError,
} from "./retry-policy";
import { validateBrainOutput } from "./semantic-validator";

interface ResponsesParser {
  parse: (body: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

export interface BrainRunnerOptions {
  responses?: ResponsesParser;
  model?: string;
  timeoutMs?: number;
  now?: () => Date;
}

interface ProviderResponse {
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

function createResponsesParser(): ResponsesParser {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client.responses as unknown as ResponsesParser;
}

async function providerAttempt(
  responses: ResponsesParser,
  model: string,
  input: string,
  timeoutMs: number,
  request: BrainRequest,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await responses.parse(
      {
        model,
        reasoning: { effort: "medium" },
        store: false,
        input: [
          { role: "system", content: BRAIN_SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
        text: { format: zodTextFormat(brainModelOutputSchema, "brain_model_output") },
      },
      { signal: controller.signal },
    );
    return validateProviderResponse(response, request);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new BrainRunError("MODEL_TIMEOUT", "The Brain request timed out.", true, { cause: error });
    }
    throw mapProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runBrain(request: BrainRequest, options: BrainRunnerOptions = {}): Promise<BrainResponse> {
  const requestedModel = options.model ?? process.env.OPENAI_BRAIN_MODEL ?? "gpt-5.6";
  const timeoutMs = options.timeoutMs ?? BRAIN_TIMEOUT_MS;
  const responses = options.responses ?? createResponsesParser();
  let repairAttempted = false;
  let result: AttemptResult;

  try {
    result = await providerAttempt(responses, requestedModel, buildBrainInput(request), timeoutMs, request);
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
      request,
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
