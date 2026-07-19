import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "@/domain/initial-state";
import { sessionReducer } from "@/domain/session-reducer";
import type { BrainResponse, ConversationTurn, SessionState } from "@/domain/types";
import { teamBillingSnapshots } from "@/demo/team-billing-snapshots";
import { CHECKPOINT_KEY, createCheckpoint, restoreCheckpoint } from "@/lib/session-checkpoint";

const turn: ConversationTurn = {
  id: "TURN-TEST",
  promptId: "PROMPT-INITIAL",
  type: "confirmed_answer",
  text: "Build team billing.",
  createdAt: "2026-07-20T00:01:00.000Z",
};

function reviewingState(): SessionState {
  const state = createInitialState("live", new Date("2026-07-20T00:00:00.000Z"));
  return {
    ...state,
    phase: "reviewing_answer",
    answerDraft: {
      text: "Build team billing.",
      source: "typed",
      promptId: "PROMPT-INITIAL",
      transcriptionItemId: null,
    },
  };
}

function response(requestId = "REQ-TEST", baseRevision = 0): BrainResponse {
  return {
    schemaVersion: 1,
    requestId,
    baseRevision,
    revision: baseRevision + 1,
    provenance: {
      source: "live_ai",
      agent: "brain",
      requestedModel: "gpt-5.6",
      actualModel: "gpt-5.6",
      validatedAt: "2026-07-20T00:02:00.000Z",
      repairAttempted: false,
    },
    output: {
      specification: teamBillingSnapshots[0],
      nextPrompt: null,
      changeSummary: ["Captured the requested product."],
    },
  };
}

describe("session reducer verification", () => {
  it("rejects illegal speech transitions", () => {
    const state = createInitialState("live", new Date("2026-07-20T00:00:00.000Z"));
    expect(sessionReducer(state, { type: "SPEECH_STARTED" })).toBe(state);
  });

  it("rejects stale or mismatched Brain responses atomically", () => {
    const pending = sessionReducer(reviewingState(), {
      type: "BRAIN_REQUESTED",
      requestId: "REQ-TEST",
      turn,
    });
    const stale = sessionReducer(pending, {
      type: "BRAIN_RESPONSE_RECEIVED",
      response: response("REQ-OTHER"),
    });
    expect(stale).toBe(pending);
    expect(stale.revision).toBe(0);
    expect(stale.specification.title).toBe("Untitled specification");
  });

  it("preserves the last valid Specification on a recoverable failure", () => {
    const valid = {
      ...createInitialState("live", new Date("2026-07-20T00:00:00.000Z")),
      phase: "presenting_prompt" as const,
      revision: 1,
      specification: teamBillingSnapshots[0],
    };
    const failed = sessionReducer(valid, {
      type: "RECOVERABLE_ERROR",
      error: {
        code: "INVALID_MODEL_OUTPUT",
        message: "The Brain returned an invalid revision.",
        retryable: true,
        returnPhase: "presenting_prompt",
      },
    });
    expect(failed.phase).toBe("recoverable_error");
    expect(failed.revision).toBe(1);
    expect(failed.specification).toBe(valid.specification);
  });

  it("keeps a finalized snapshot when grilling resumes", () => {
    const review = {
      ...createInitialState("demo", new Date("2026-07-20T00:00:00.000Z")),
      phase: "final_review" as const,
      revision: 8,
      specification: teamBillingSnapshots.at(-1)!,
      currentPrompt: null,
    };
    const finalized = sessionReducer(review, { type: "FINALIZE" });
    const resumed = sessionReducer(finalized, { type: "RESUME_GRILLING" });
    expect(resumed.phase).toBe("presenting_prompt");
    expect(resumed.lastFinalizedRevision).toBe(8);
    expect(resumed.finalizedSpecification).toEqual(teamBillingSnapshots.at(-1));
  });

  it("requests a Live resume without inventing a Conversation Turn", () => {
    const finalized = {
      ...createInitialState("live", new Date("2026-07-20T00:00:00.000Z")),
      phase: "finalized" as const,
      revision: 3,
      turns: [turn],
      specification: teamBillingSnapshots[0],
      currentPrompt: null,
      lastFinalizedRevision: 3,
      finalizedSpecification: teamBillingSnapshots[0],
    };
    const pending = sessionReducer(finalized, { type: "BRAIN_RESUME_REQUESTED", requestId: "REQ-RESUME" });
    expect(pending.phase).toBe("analyzing");
    expect(pending.pendingRequest).toEqual({ requestId: "REQ-RESUME", baseRevision: 3 });
    expect(pending.turns).toEqual([turn]);
  });
});

describe("session checkpoint verification", () => {
  it("strips an Answer Draft and transient request/error state", () => {
    const checkpoint = createCheckpoint(reviewingState(), new Date("2026-07-20T00:03:00.000Z"));
    const serialized = JSON.stringify(checkpoint);
    expect(checkpoint.state.phase).toBe("presenting_prompt");
    expect(checkpoint.state.answerDraft).toBeNull();
    expect(checkpoint.state.pendingRequest).toBeNull();
    expect(checkpoint.state.error).toBeNull();
    expect(serialized).not.toContain("Build team billing.");
    expect(serialized).not.toContain("clientSecret");
  });

  it("deletes expired checkpoints instead of partially restoring them", () => {
    const checkpoint = createCheckpoint(
      createInitialState("live", new Date("2026-07-20T00:00:00.000Z")),
      new Date("2026-07-20T00:01:00.000Z"),
    );
    const storage = {
      getItem: vi.fn(() => JSON.stringify(checkpoint)),
      removeItem: vi.fn(),
    };
    expect(restoreCheckpoint(storage, new Date("2026-07-20T00:31:00.000Z"))).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(CHECKPOINT_KEY);
  });

  it("deletes malformed checkpoints", () => {
    const storage = { getItem: vi.fn(() => "{not-json"), removeItem: vi.fn() };
    expect(restoreCheckpoint(storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(CHECKPOINT_KEY);
  });
});
