import { parseBrainStream } from "../src/app/brain-client";
import { createEmptyQuestionRoadmap, createInitialContextDigest, emptySpecification, initialInterviewPrompt } from "../src/domain/initial-state";
import { v3BrainRequestSchema } from "../src/domain/v3-schemas";
import type { V3BrainRequest, V3BrainResponse } from "../src/domain/v3-schemas";

async function submitBrainRequest(
  baseUrl: string,
  allowedOrigin: string,
  requestBody: V3BrainRequest,
): Promise<V3BrainResponse> {
  const response = await fetch(`${baseUrl}/api/brain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: allowedOrigin,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const error = payload as { error?: { code?: unknown; message?: unknown } } | null;
    const code = typeof error?.error?.code === "string" ? error.error.code : "UNKNOWN_ERROR";
    const message = typeof error?.error?.message === "string" ? error.error.message : "Live Brain smoke failed.";
    throw new Error(`${code}: ${message}`);
  }

  return parseBrainStream(response, requestBody, () => undefined);
}

async function main(): Promise<void> {
  if (process.env.RUN_LIVE_AI_SMOKE !== "true") {
    throw new Error("Set RUN_LIVE_AI_SMOKE=true to permit this opt-in Live AI request.");
  }

  const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
  const allowedOrigin = process.env.SMOKE_ORIGIN ?? "http://localhost:3000";
  const now = new Date().toISOString();
  const requestId = "REQ-LIVE-SMOKE";
  const requestBody = v3BrainRequestSchema.parse({
    schemaVersion: 1,
    sessionId: "SESSION-LIVE-SMOKE",
    mode: "live",
    requestId,
    baseRevision: 0,
    operation: "answer",
    turns: [{
      id: "TURN-LIVE-SMOKE",
      promptId: initialInterviewPrompt.id,
      type: "confirmed_answer",
      text: "Build a personal reading list that lets one reader save a title and mark it finished.",
      createdAt: now,
    }],
    confirmedContextDigest: createInitialContextDigest(new Date(now)),
    questionRoadmap: createEmptyQuestionRoadmap(0),
    relevantSourceExcerpts: [],
    currentSpecification: { ...emptySpecification, externalEvidence: [] },
    currentPrompt: null,
    actionId: "ACTION-LIVE-SMOKE",
    cancelEpoch: 0,
    requestedApplicationCap: 1,
    priorInterviewWindow: null,
    restoredEntriesForRevalidation: [],
    decisionBatch: null,
    externalEvidenceBundle: [],
  });
  const lifecycleKinds: string[] = [];
  const response = await fetch(`${baseUrl}/api/brain`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: allowedOrigin },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) throw new Error(`Live Brain smoke request failed with HTTP ${response.status}.`);
  const validated = await parseBrainStream(response, requestBody, (event) => lifecycleKinds.push(event.kind));
  if (validated.requestId !== requestId || validated.revision !== 1) {
    throw new Error("Live Brain smoke returned mismatched request or revision metadata.");
  }
  if (!validated.codexThreadId) {
    throw new Error("Live Brain smoke did not return a persistent Codex thread identity.");
  }

  const resumedRequest = v3BrainRequestSchema.parse({
    ...requestBody,
    requestId: "REQ-LIVE-SMOKE-RESUME",
    actionId: "ACTION-LIVE-SMOKE-RESUME",
    baseRevision: validated.revision,
    operation: "resume",
    currentSpecification: validated.output.specification,
    questionRoadmap: validated.output.questionRoadmap,
    currentPrompt: validated.output.nextPrompt,
    priorInterviewWindow: validated.output.interviewWindow,
    codexThreadId: validated.codexThreadId,
  });
  const resumed = await submitBrainRequest(baseUrl, allowedOrigin, resumedRequest);
  if (resumed.revision !== 2 || resumed.codexThreadId !== validated.codexThreadId) {
    throw new Error("Live Brain smoke did not resume the same persistent Codex thread.");
  }

  console.log(
    JSON.stringify({
      validated: true,
      threadResumed: true,
      requestedModel: validated.provenance.requestedModel,
      actualModel: validated.provenance.actualModel,
      revision: validated.revision,
      repairAttempted: validated.provenance.repairAttempted,
      hasNextPrompt: validated.output.nextPrompt !== null,
      lifecycleEvents: lifecycleKinds.length,
    }),
  );
}

const keepAlive = setInterval(() => undefined, 1_000);
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Live Brain smoke failed.");
  process.exitCode = 1;
}).finally(() => {
  clearInterval(keepAlive);
});
