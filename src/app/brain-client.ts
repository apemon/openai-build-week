import { apiErrorSchema, brainRequestSchema, brainResponseSchema } from "@/domain/schemas";
import type {
  ApiError,
  BrainOperation,
  BrainRequest,
  BrainResponse,
  ConversationTurn,
  ExtractedSourceExcerpt,
  SessionState,
} from "@/domain/types";
import {
  brainStreamEnvelopeSchema,
  v3BrainRequestSchema,
  type BrainLifecycleEvent,
  type DecisionBatch,
  type FrozenExternalEvidence,
  type InterviewWindow,
  type RestoredAsyncEntry,
  type V3BrainOperation,
  type V3BrainRequest,
  type V3BrainResponse,
} from "@/domain/v3-schemas";
import { migrateSpecificationToV3, validateLifecycleSequence } from "@/domain/v3-invariants";

export class BrainClientError extends Error {
  readonly code: ApiError["error"]["code"];
  readonly retryable: boolean;

  constructor(error: ApiError["error"]) {
    super(error.message);
    this.name = "BrainClientError";
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

export function createBrainRequest(
  state: SessionState,
  requestId: string,
  operation: BrainOperation,
  relevantSourceExcerpts: ExtractedSourceExcerpt[],
  turn?: ConversationTurn,
): BrainRequest {
  if (state.mode !== "live") throw new Error("Prepared Demo state cannot create a Live Brain request.");
  if (!state.confirmedContextDigest) throw new Error("Project Context Digest confirmation is required.");

  return brainRequestSchema.parse({
    schemaVersion: 1,
    sessionId: state.sessionId,
    mode: "live",
    requestId,
    baseRevision: state.revision,
    operation,
    turns: turn ? [...state.turns, turn] : state.turns,
    confirmedContextDigest: state.confirmedContextDigest,
    questionRoadmap: state.questionRoadmap,
    relevantSourceExcerpts,
    currentSpecification: state.specification,
    currentPrompt: state.currentPrompt,
  });
}

export async function postBrainRequest(
  request: BrainRequest,
  signal?: AbortSignal,
): Promise<BrainResponse> {
  const response = await fetch("/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": request.requestId },
    body: JSON.stringify(request),
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    if (parsedError.success) throw new BrainClientError(parsedError.data.error);
    throw new Error("The Brain could not validate a new revision.");
  }
  return brainResponseSchema.parse(payload);
}

export interface V3BrainRequestOptions {
  actionId: string;
  cancelEpoch: number;
  requestedApplicationCap: 1 | 3;
  priorInterviewWindow?: InterviewWindow | null;
  restoredEntriesForRevalidation?: RestoredAsyncEntry[];
  decisionBatch?: DecisionBatch | null;
  externalEvidenceBundle?: FrozenExternalEvidence[];
  codexThreadId?: string | null;
  turn?: ConversationTurn;
}

export function createV3BrainRequest(
  state: SessionState,
  requestId: string,
  operation: V3BrainOperation,
  relevantSourceExcerpts: ExtractedSourceExcerpt[],
  options: V3BrainRequestOptions,
): V3BrainRequest {
  if (state.mode !== "live") throw new Error("Prepared Demo state cannot create a Live Brain request.");
  if (!state.confirmedContextDigest) throw new Error("Project Context Digest confirmation is required.");
  return v3BrainRequestSchema.parse({
    schemaVersion: 1,
    sessionId: state.sessionId,
    mode: "live",
    requestId,
    baseRevision: state.revision,
    operation,
    turns: options.turn ? [...state.turns, options.turn] : state.turns,
    confirmedContextDigest: state.confirmedContextDigest,
    questionRoadmap: state.questionRoadmap,
    relevantSourceExcerpts,
    currentSpecification: migrateSpecificationToV3(state.specification),
    currentPrompt: state.currentPrompt ? { ...state.currentPrompt, recommendation: state.currentPrompt.recommendation ? { ...state.currentPrompt.recommendation, externalEvidenceIds: [] } : null } : null,
    actionId: options.actionId,
    cancelEpoch: options.cancelEpoch,
    requestedApplicationCap: options.requestedApplicationCap,
    priorInterviewWindow: options.priorInterviewWindow ?? null,
    restoredEntriesForRevalidation: options.restoredEntriesForRevalidation ?? [],
    decisionBatch: options.decisionBatch ?? null,
    externalEvidenceBundle: options.externalEvidenceBundle ?? [],
    codexThreadId: options.codexThreadId ?? null,
  });
}

export class BrainStreamInterruptedError extends Error {
  constructor(message = "Connection interrupted · Brain state unknown") {
    super(message);
    this.name = "BrainStreamInterruptedError";
  }
}

const MAX_BRAIN_STREAM_BYTES = 2_000_000;
const MAX_BRAIN_STREAM_LINE_BYTES = 100_000;

export async function parseBrainStream(
  response: Response,
  expected: Pick<BrainLifecycleEvent, "requestId" | "actionId" | "baseRevision" | "cancelEpoch">,
  onLifecycle: (event: BrainLifecycleEvent) => void,
): Promise<V3BrainResponse> {
  if (!response.body) throw new BrainStreamInterruptedError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let previous: BrainLifecycleEvent | null = null;
  let terminal: V3BrainResponse | null = null;
  let terminalSeen = false;

  const consumeLine = (line: string): void => {
    if (!line.trim()) return;
    if (new TextEncoder().encode(line).byteLength > MAX_BRAIN_STREAM_LINE_BYTES) {
      throw new BrainStreamInterruptedError("The Brain stream exceeded its safe line limit.");
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new BrainStreamInterruptedError("The Brain stream contained malformed data.");
    }
    const parsed = brainStreamEnvelopeSchema.safeParse(value);
    if (!parsed.success) throw new BrainStreamInterruptedError("The Brain stream failed content-free validation.");
    if (terminalSeen) throw new BrainStreamInterruptedError("The Brain stream continued after its terminal event.");
    const envelope = parsed.data;
    if (envelope.type === "lifecycle") {
      const validation = validateLifecycleSequence(previous, envelope.event, expected);
      if (!validation.valid) throw new BrainStreamInterruptedError(validation.errors[0]);
      previous = envelope.event;
      onLifecycle(envelope.event);
      return;
    }
    terminalSeen = true;
    if (envelope.type === "error") throw new BrainClientError(envelope.error.error);
    if (
      envelope.response.requestId !== expected.requestId
      || envelope.response.baseRevision !== expected.baseRevision
    ) throw new BrainStreamInterruptedError("The Brain result does not match the active action.");
    terminal = envelope.response;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BRAIN_STREAM_BYTES) throw new BrainStreamInterruptedError("The Brain stream exceeded its safe size limit.");
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
  if (!terminal) throw new BrainStreamInterruptedError();
  return terminal;
}

export async function postV3BrainRequest(
  request: V3BrainRequest,
  onLifecycle: (event: BrainLifecycleEvent) => void,
  signal?: AbortSignal,
): Promise<V3BrainResponse> {
  const response = await fetch("/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": request.requestId, Accept: "application/x-ndjson" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    const payload: unknown = await response.json();
    const parsedError = apiErrorSchema.safeParse(payload);
    if (parsedError.success) throw new BrainClientError(parsedError.data.error);
    throw new BrainStreamInterruptedError("The Brain route rejected the request without a valid error envelope.");
  }
  return parseBrainStream(response, request, onLifecycle);
}
