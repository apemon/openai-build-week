import { describe, expect, it } from "vitest";

import { createEmptyQuestionRoadmap, createInitialContextDigest, createInitialState, initialInterviewPrompt } from "@/domain/initial-state";
import { sessionReducer } from "@/domain/session-reducer";
import type { BrainResponse, DecisionSummary, LookaheadApproval, QuestionRoadmap, SessionState } from "@/domain/types";
import { teamBillingSnapshots } from "@/demo/team-billing-snapshots";

const now = "2026-07-20T00:00:00.000Z";

function approval(revision = 0, dependencyVersion = `DEPENDENCY-${revision}`): LookaheadApproval {
  return {
    roadmapItemId: "ROADMAP-001",
    prompt: { ...initialInterviewPrompt, id: "PROMPT-LOOKAHEAD", decisionKey: "permissions" },
    approvedAtRevision: revision,
    dependencyVersion,
    independentOfOperation: "answer",
  };
}

function roadmap(revision = 0, withApproval = true): QuestionRoadmap {
  const dependencyVersion = `DEPENDENCY-${revision}`;
  return {
    id: "ROADMAP-STATE",
    baseRevision: revision,
    dependencyVersion,
    items: [{
      id: "ROADMAP-001",
      decisionKey: "permissions",
      topic: "Billing permissions",
      status: "unresolved",
      priority: 1,
      dependencyIds: [],
      sourceItemIds: [],
      staleReason: withApproval ? null : "The provider decision now blocks permissions.",
    }],
    currentDecisionItemId: null,
    completedItemIds: [],
    unresolvedDependencyIds: [],
    lookaheadApproval: withApproval ? approval(revision, dependencyVersion) : null,
  };
}

function summary(): DecisionSummary {
  return {
    id: "SUMMARY-001",
    roadmapItemId: "ROADMAP-001",
    text: "Workspace Owners manage billing.",
    uncertainties: [],
    status: "draft",
    approvedAtRevision: 0,
    dependencyVersion: "DEPENDENCY-0",
    confirmedAt: null,
    staleReason: null,
  };
}

function analyzingWithLookahead(): SessionState {
  let state: SessionState = {
    ...createInitialState("live", new Date(now)),
    phase: "analyzing",
    confirmedContextDigest: createInitialContextDigest(new Date(now)),
    questionRoadmap: roadmap(),
    pendingRequest: { requestId: "REQUEST-001", baseRevision: 0, operation: "answer", actionId: "ACTION-001" },
    processingStage: "reviewing_dependencies",
  };
  state = sessionReducer(state, { type: "LOOKAHEAD_STARTED", approval: approval() });
  state = sessionReducer(state, { type: "DECISION_SUMMARY_READY", summary: summary() });
  return sessionReducer(state, { type: "DECISION_SUMMARY_CONFIRMED", confirmedAt: now });
}

function response(nextRoadmap: QuestionRoadmap): BrainResponse {
  return {
    schemaVersion: 1,
    requestId: "REQUEST-001",
    baseRevision: 0,
    revision: 1,
    provenance: { source: "live_ai", agent: "brain", requestedModel: "gpt-5.6", actualModel: "gpt-5.6", validatedAt: now, repairAttempted: false },
    output: { specification: teamBillingSnapshots[0], questionRoadmap: nextRoadmap, nextPrompt: initialInterviewPrompt, changeSummary: ["Applied confirmed input."] },
  };
}

describe("V2 ordering and authority verification", () => {
  it("applies the authoritative revision first, then leaves a still-valid confirmed summary queued", () => {
    const state = analyzingWithLookahead();
    const revised = sessionReducer(state, { type: "BRAIN_RESPONSE_RECEIVED", response: response(roadmap(1)) });
    expect(revised.revision).toBe(1);
    expect(revised.specification).toBe(teamBillingSnapshots[0]);
    expect(revised.phase).toBe("queued_decision_summary");
    expect(revised.activeLookahead?.decisionSummary?.status).toBe("confirmed_queued");
    expect(revised.turns).toHaveLength(0);
  });

  it("allows the confirmed summary to become a Brain turn only after successful revalidation", () => {
    const revised = sessionReducer(analyzingWithLookahead(), { type: "BRAIN_RESPONSE_RECEIVED", response: response(roadmap(1)) });
    const turn = { id: "TURN-SUMMARY", promptId: "PROMPT-LOOKAHEAD", type: "confirmed_decision_summary" as const, text: summary().text, createdAt: now };
    const submitted = sessionReducer(revised, { type: "BRAIN_REQUESTED", requestId: "REQUEST-002", actionId: "ACTION-002", operation: "decision_summary", turn });
    expect(submitted.pendingRequest).toMatchObject({ operation: "decision_summary", baseRevision: 1 });
    expect(submitted.turns).toEqual([turn]);
    expect(submitted.activeLookahead?.decisionSummary?.status).toBe("submitted");
  });

  it("keeps a revalidated draft reviewable when the main response wins the race, then queues it on explicit confirmation", () => {
    let state: SessionState = {
      ...createInitialState("live", new Date(now)),
      phase: "analyzing",
      confirmedContextDigest: createInitialContextDigest(new Date(now)),
      questionRoadmap: roadmap(),
      pendingRequest: { requestId: "REQUEST-001", baseRevision: 0, operation: "answer", actionId: "ACTION-001" },
      processingStage: "reviewing_dependencies",
    };
    state = sessionReducer(state, { type: "LOOKAHEAD_STARTED", approval: approval() });
    state = sessionReducer(state, { type: "DECISION_SUMMARY_READY", summary: summary() });
    state = sessionReducer(state, { type: "BRAIN_RESPONSE_RECEIVED", response: response(roadmap(1)) });
    expect(state.phase).toBe("reviewing_decision_summary");
    expect(state.pendingRequest).toBeNull();
    expect(state.activeLookahead?.decisionSummary?.status).toBe("draft");

    state = sessionReducer(state, { type: "DECISION_SUMMARY_CONFIRMED", confirmedAt: now });
    expect(state.phase).toBe("queued_decision_summary");
    expect(state.activeLookahead?.decisionSummary?.status).toBe("confirmed_queued");

    const turn = { id: "TURN-RACE-SUMMARY", promptId: "PROMPT-LOOKAHEAD", type: "confirmed_decision_summary" as const, text: summary().text, createdAt: now };
    state = sessionReducer(state, { type: "BRAIN_REQUESTED", requestId: "REQUEST-002", actionId: "ACTION-002", operation: "decision_summary", turn });
    expect(state.pendingRequest).toMatchObject({ operation: "decision_summary", baseRevision: 1 });
    expect(state.turns).toEqual([turn]);
  });

  it("quarantines stale queued wording as not applied without changing the authoritative revision", () => {
    const revised = sessionReducer(analyzingWithLookahead(), { type: "BRAIN_RESPONSE_RECEIVED", response: response(roadmap(1, false)) });
    expect(revised.revision).toBe(1);
    expect(revised.specification).toBe(teamBillingSnapshots[0]);
    expect(revised.activeLookahead).toBeNull();
    expect(revised.staleDecisionSummaries).toEqual([
      expect.objectContaining({ status: "not_applied", staleReason: "The provider decision now blocks permissions." }),
    ]);
  });

  it("requires explicit abandonment before Final Review and rejects a late response afterward", () => {
    const pending = analyzingWithLookahead();
    expect(sessionReducer(pending, { type: "ENTER_FINAL_REVIEW" })).toBe(pending);
    const abandoned = sessionReducer(pending, { type: "ABANDON_PENDING_AND_ENTER_FINAL_REVIEW", reason: "Explicitly abandoned for review." });
    expect(abandoned.phase).toBe("final_review");
    expect(abandoned.pendingRequest).toBeNull();
    expect(abandoned.staleDecisionSummaries[0]).toMatchObject({ status: "not_applied" });

    const afterLateResponse = sessionReducer(abandoned, { type: "BRAIN_RESPONSE_RECEIVED", response: response(createEmptyQuestionRoadmap(1)) });
    expect(afterLateResponse).toBe(abandoned);
    expect(afterLateResponse.revision).toBe(0);
  });

  it("cannot activate a second lookahead while one is active", () => {
    const state = analyzingWithLookahead();
    const second = { ...approval(), roadmapItemId: "ROADMAP-002", prompt: { ...initialInterviewPrompt, id: "PROMPT-SECOND" } };
    expect(sessionReducer(state, { type: "LOOKAHEAD_STARTED", approval: second })).toBe(state);
  });
});
