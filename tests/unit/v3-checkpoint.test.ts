import { describe, expect, it, vi } from "vitest";

import { createInitialContextDigest, createInitialState } from "@/domain/initial-state";
import { createCheckpoint, createV3Checkpoint, restoreV3Checkpoint } from "@/lib/session-checkpoint";
import type { RestoredAsyncEntry } from "@/domain/v3-schemas";

const now = new Date("2026-07-21T00:00:00.000Z");

function session() {
  return {
    ...createInitialState("live", now),
    phase: "presenting_prompt" as const,
    confirmedContextDigest: createInitialContextDigest(now),
  };
}

function restoredEntry(): RestoredAsyncEntry {
  return {
    kind: "decision_summary",
    jobId: "JOB-001",
    exchangeId: "EXCHANGE-001",
    permitId: "PERMIT-001",
    roadmapItemId: "ROADMAP-001",
    permitOrdinal: 1,
    confirmedTurnId: "TURN-ASYNC-001",
    text: "Owners manage billing.",
    uncertainties: [],
    confirmedAt: now.toISOString(),
    revalidatedAtRevision: 0,
    revalidatedDependencyVersion: "DEPENDENCY-0",
    windowId: "WINDOW-001",
    approvalRevision: 0,
    approvalDependencyVersion: "DEPENDENCY-0",
  };
}

describe("V3 checkpoint privacy and migration", () => {
  it("stores only bounded confirmed entries and the content-free adaptive tuple", () => {
    const unsafeState = {
      ...session(),
      phase: "reviewing_answer" as const,
      answerDraft: { text: "LEAK_SENTINEL_TRANSCRIPT", source: "transcription" as const, promptId: "PROMPT-INITIAL", transcriptionItemId: "provider-item-secret" },
      pendingRequest: { requestId: "REQUEST-SECRET", baseRevision: 0, operation: "answer" as const, actionId: "ACTION-SECRET" },
      error: { code: "INTERNAL_ERROR", message: "LEAK_SENTINEL_RAW_ERROR", retryable: true, returnPhase: "presenting_prompt" as const },
    };
    const checkpoint = createV3Checkpoint(unsafeState, [restoredEntry()], { eligibleOutcomes: ["applied"], applicationCap: 3, singletonRecoveryStreak: 0 }, now);
    expect(checkpoint.schemaVersion).toBe(3);
    expect(checkpoint.confirmedQueuedEntries).toHaveLength(1);
    expect(JSON.stringify(checkpoint)).not.toContain("clarificationTurns");
    expect(JSON.stringify(checkpoint)).not.toContain("lifecycle");
    expect(JSON.stringify(checkpoint)).not.toContain("LEAK_SENTINEL_TRANSCRIPT");
    expect(JSON.stringify(checkpoint)).not.toContain("provider-item-secret");
    expect(JSON.stringify(checkpoint)).not.toContain("LEAK_SENTINEL_RAW_ERROR");
    expect(checkpoint.state.pendingRequest).toBeNull();
    expect(checkpoint.state.answerDraft).toBeNull();
  });

  it("migrates only a validated safe V2 checkpoint with conservative adaptive state", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify(createCheckpoint(session(), now))),
      removeItem: vi.fn(),
    };
    expect(restoreV3Checkpoint(storage, now)).toMatchObject({
      confirmedQueuedEntries: [],
      adaptiveWindow: { applicationCap: 1, singletonRecoveryStreak: 0 },
      migratedFromV2: true,
    });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("binds a validated Codex thread ID to the sanitized checkpoint", () => {
    const checkpoint = createV3Checkpoint(
      session(),
      [],
      { eligibleOutcomes: [], applicationCap: 1, singletonRecoveryStreak: 0 },
      now,
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
    );

    expect(checkpoint.codexThreadId).toBe("0199a213-81c0-7800-8aa1-bbab2a035a53");
    const storage = { getItem: vi.fn(() => JSON.stringify(checkpoint)), removeItem: vi.fn() };
    expect(restoreV3Checkpoint(storage, now)?.codexThreadId).toBe(checkpoint.codexThreadId);
  });

  it("rejects malformed V3 shapes rather than partially restoring wording", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ schemaVersion: 3, confirmedQueuedEntries: [{ text: "unsafe partial" }] })), removeItem: vi.fn() };
    expect(restoreV3Checkpoint(storage, now)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalled();
  });
});
