import { describe, expect, it } from "vitest";

import { createEmptyQuestionRoadmap, createInitialState, emptySpecification } from "@/domain/initial-state";
import { sessionReducer } from "@/domain/session-reducer";
import type { BrainResponse, ConversationTurn } from "@/domain/types";
import { orderDecisionBatchEntries } from "@/domain/v3-invariants";
import type { DecisionBatchEntry } from "@/domain/v3-schemas";

const at = "2026-07-21T00:00:00.000Z";

function entry(jobId: string, ordinal: 1 | 2 | 3, confirmedAt = at): DecisionBatchEntry {
  return {
    kind: "decision_summary",
    jobId,
    exchangeId: `EXCHANGE-${jobId}`,
    permitId: `PERMIT-${jobId.slice(-3)}`,
    roadmapItemId: `ROADMAP-${jobId.slice(-3)}`,
    permitOrdinal: ordinal,
    confirmedTurnId: `TURN-${jobId}`,
    text: `Confirmed wording for ${jobId}.`,
    uncertainties: [],
    confirmedAt,
    revalidatedAtRevision: 2,
    revalidatedDependencyVersion: "DEPENDENCY-2",
  };
}

function response(requestId: string, baseRevision: number): BrainResponse {
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
      validatedAt: at,
      repairAttempted: false,
    },
    output: {
      specification: { ...emptySpecification, title: "Validated atomic batch revision" },
      questionRoadmap: createEmptyQuestionRoadmap(baseRevision + 1),
      nextPrompt: null,
      changeSummary: ["Applied the exact Decision Batch."],
    },
  };
}

describe("V3 Decision Batch ordering and atomic durability", () => {
  it("orders exact membership by permit ordinal, confirmation time, and stable ID", () => {
    const entries = orderDecisionBatchEntries([
      entry("JOB-003", 2),
      entry("JOB-002", 1, "2026-07-21T00:00:01.000Z"),
      entry("JOB-001", 1),
    ]);
    expect(entries.map((candidate) => candidate.jobId)).toEqual(["JOB-001", "JOB-002", "JOB-003"]);
  });

  it("keeps request-local turns and the last valid Specification unchanged on failure", () => {
    const state = { ...createInitialState("live", new Date(at)), revision: 2, specification: { ...emptySpecification, title: "Last valid Specification" }, phase: "presenting_prompt" as const };
    const pending = sessionReducer(state, { type: "BRAIN_REQUESTED", requestId: "REQUEST-BATCH", actionId: "ACTION-BATCH", operation: "decision_batch" });
    expect(pending.turns).toEqual([]);
    const failed = sessionReducer(pending, { type: "RECOVERABLE_ERROR", error: { code: "MODEL_TIMEOUT", message: "Timed out.", retryable: true, returnPhase: "presenting_prompt" } });
    expect(failed.revision).toBe(2);
    expect(failed.specification.title).toBe("Last valid Specification");
    expect(failed.turns).toEqual([]);
  });

  it("appends all locked turns only with the matching complete validated revision", () => {
    const state = { ...createInitialState("live", new Date(at)), revision: 2, phase: "presenting_prompt" as const };
    const pending = sessionReducer(state, { type: "BRAIN_REQUESTED", requestId: "REQUEST-BATCH", actionId: "ACTION-BATCH", operation: "decision_batch" });
    const batchTurns: ConversationTurn[] = [
      { id: "TURN-ASYNC-001", promptId: "PROMPT-001", type: "confirmed_decision_summary", text: "Owners manage billing.", createdAt: at },
      { id: "TURN-ASYNC-002", promptId: "PROMPT-002", type: "deferred_prompt", text: "Deferred without additional context.", createdAt: at },
    ];
    const applied = sessionReducer(pending, { type: "BRAIN_RESPONSE_RECEIVED", response: response("REQUEST-BATCH", 2), batchTurns });
    expect(applied.revision).toBe(3);
    expect(applied.specification.title).toBe("Validated atomic batch revision");
    expect(applied.turns).toEqual(batchTurns);

    const stale = sessionReducer(pending, { type: "BRAIN_RESPONSE_RECEIVED", response: response("REQUEST-OLD", 2), batchTurns });
    expect(stale).toEqual(pending);
  });
});
