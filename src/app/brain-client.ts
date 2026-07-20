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
