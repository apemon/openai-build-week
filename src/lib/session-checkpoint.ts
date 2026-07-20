import { checkpointSchema, sessionStateSchema } from "@/domain/schemas";
import type { SessionCheckpoint, SessionState } from "@/domain/types";
import {
  v3CheckpointSchema,
  type AdaptiveWindowState,
  type RestoredAsyncEntry,
  type V3Checkpoint,
} from "@/domain/v3-schemas";

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
    phase: state.phase === "analyzing" && state.revision === 0 && state.confirmedContextDigest
      ? "connecting"
      : ["reviewing_answer", "analyzing", "clarifying_lookahead", "reviewing_decision_summary", "queued_decision_summary"].includes(state.phase)
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

export interface RestoredV3Checkpoint {
  state: SessionState;
  confirmedQueuedEntries: RestoredAsyncEntry[];
  adaptiveWindow: AdaptiveWindowState;
  migratedFromV2: boolean;
}

export function createV3Checkpoint(
  state: SessionState,
  confirmedQueuedEntries: RestoredAsyncEntry[],
  adaptiveWindow: AdaptiveWindowState,
  now = new Date(),
): V3Checkpoint {
  const safeV2State = createCheckpoint(state, now).state;
  return v3CheckpointSchema.parse({
    schemaVersion: 3,
    savedAt: now.toISOString(),
    state: safeV2State,
    confirmedQueuedEntries,
    adaptiveWindow,
  });
}

export function saveV3Checkpoint(
  storage: Pick<Storage, "setItem">,
  state: SessionState,
  confirmedQueuedEntries: RestoredAsyncEntry[],
  adaptiveWindow: AdaptiveWindowState,
  now = new Date(),
): void {
  storage.setItem(CHECKPOINT_KEY, JSON.stringify(createV3Checkpoint(state, confirmedQueuedEntries, adaptiveWindow, now)));
}

export function restoreV3Checkpoint(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = new Date(),
): RestoredV3Checkpoint | null {
  const raw = storage.getItem(CHECKPOINT_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const parsedV3 = v3CheckpointSchema.safeParse(value);
    if (parsedV3.success) {
      if (Date.parse(parsedV3.data.state.expiresAt) <= now.getTime()) {
        storage.removeItem(CHECKPOINT_KEY);
        return null;
      }
      return {
        state: sessionStateSchema.parse(parsedV3.data.state),
        confirmedQueuedEntries: parsedV3.data.confirmedQueuedEntries,
        adaptiveWindow: parsedV3.data.adaptiveWindow,
        migratedFromV2: false,
      };
    }
    const parsedV2 = checkpointSchema.safeParse(value);
    if (!parsedV2.success || Date.parse(parsedV2.data.state.expiresAt) <= now.getTime()) {
      storage.removeItem(CHECKPOINT_KEY);
      return null;
    }
    return {
      state: sessionStateSchema.parse(parsedV2.data.state),
      confirmedQueuedEntries: [],
      adaptiveWindow: { eligibleOutcomes: [], applicationCap: 1, singletonRecoveryStreak: 0 },
      migratedFromV2: true,
    };
  } catch {
    storage.removeItem(CHECKPOINT_KEY);
    return null;
  }
}
