import { checkpointSchema, sessionStateSchema } from "@/domain/schemas";
import type { SessionCheckpoint, SessionState } from "@/domain/types";

export const CHECKPOINT_KEY = "spec-grill:checkpoint:v1";

export function createCheckpoint(state: SessionState, now = new Date()): SessionCheckpoint {
  const safeState: SessionState = {
    ...state,
    answerDraft: null,
    pendingRequest: null,
    error: null,
    contextPreparation: null,
    temporaryExtractionAvailable: false,
    activeLookahead: null,
    staleLookaheadReason: null,
    staleDecisionSummaries: [],
    processingStage: "idle",
    phase: ["reviewing_answer", "analyzing", "clarifying_lookahead", "reviewing_decision_summary", "queued_decision_summary"].includes(state.phase)
      ? "presenting_prompt"
      : state.phase,
  };
  return checkpointSchema.parse({ schemaVersion: 1, savedAt: now.toISOString(), state: safeState });
}

export function saveCheckpoint(storage: Pick<Storage, "setItem">, state: SessionState, now = new Date()): void {
  storage.setItem(CHECKPOINT_KEY, JSON.stringify(createCheckpoint(state, now)));
}

export function restoreCheckpoint(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = new Date(),
): SessionState | null {
  const raw = storage.getItem(CHECKPOINT_KEY);
  if (!raw) return null;
  try {
    const checkpoint = checkpointSchema.parse(JSON.parse(raw));
    if (Date.parse(checkpoint.state.expiresAt) <= now.getTime()) {
      storage.removeItem(CHECKPOINT_KEY);
      return null;
    }
    return sessionStateSchema.parse(checkpoint.state);
  } catch {
    storage.removeItem(CHECKPOINT_KEY);
    return null;
  }
}

export function clearCheckpoint(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(CHECKPOINT_KEY);
}
