import { brainResponseSchema } from "../src/domain/schemas";
import { emptySpecification, initialInterviewPrompt } from "../src/domain/initial-state";

async function main(): Promise<void> {
  if (process.env.RUN_LIVE_AI_SMOKE !== "true") {
    throw new Error("Set RUN_LIVE_AI_SMOKE=true to permit this opt-in Live AI request.");
  }

  const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
  const allowedOrigin = process.env.SMOKE_ORIGIN ?? "http://localhost:3000";
  const now = new Date().toISOString();
  const requestId = "REQ-LIVE-SMOKE";
  const response = await fetch(`${baseUrl}/api/brain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: allowedOrigin,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      sessionId: "SESSION-LIVE-SMOKE",
      mode: "live",
      requestId,
      baseRevision: 0,
      operation: "answer",
      turns: [
        {
          id: "TURN-LIVE-SMOKE",
          promptId: initialInterviewPrompt.id,
          type: "confirmed_answer",
          text: "Build a personal reading list that lets one reader save a title and mark it finished.",
          createdAt: now,
        },
      ],
      currentSpecification: emptySpecification,
      currentPrompt: initialInterviewPrompt,
    }),
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as { error?: { code?: unknown; message?: unknown } } | null;
    const code = typeof error?.error?.code === "string" ? error.error.code : "UNKNOWN_ERROR";
    const message = typeof error?.error?.message === "string" ? error.error.message : "Live Brain smoke failed.";
    throw new Error(`${code}: ${message}`);
  }

  const validated = brainResponseSchema.parse(payload);
  if (validated.requestId !== requestId || validated.revision !== 1) {
    throw new Error("Live Brain smoke returned mismatched request or revision metadata.");
  }

  console.log(
    JSON.stringify({
      validated: true,
      requestedModel: validated.provenance.requestedModel,
      actualModel: validated.provenance.actualModel,
      revision: validated.revision,
      repairAttempted: validated.provenance.repairAttempted,
      hasNextPrompt: validated.output.nextPrompt !== null,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Live Brain smoke failed.");
  process.exitCode = 1;
});
