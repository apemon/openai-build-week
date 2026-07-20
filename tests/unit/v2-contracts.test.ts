import { describe, expect, it } from "vitest";

import { initialInterviewPrompt, createEmptyQuestionRoadmap, createInitialContextDigest, createInitialState } from "@/domain/initial-state";
import { projectContextDigestSchema, questionRoadmapSchema } from "@/domain/schemas";
import { sessionReducer } from "@/domain/session-reducer";
import type { ActiveLookahead, ContextPreparation, DecisionSummary, LookaheadApproval, QuestionRoadmap } from "@/domain/types";
import { revalidateLookahead, validateProjectContextDigest, validateQuestionRoadmap } from "@/domain/v2-invariants";
import { createCheckpoint } from "@/lib/session-checkpoint";
import { MAX_BRAIN_EXCERPT_CHARACTERS, selectRelevantSourceExcerpts } from "@/app/source-excerpts";

const timestamp = "2026-07-20T00:00:00.000Z";

function approval(revision = 0, dependencyVersion = "DEPENDENCY-0"): LookaheadApproval {
  return {
    roadmapItemId: "ROADMAP-001",
    prompt: { ...initialInterviewPrompt, id: "PROMPT-LOOKAHEAD", decisionKey: "permissions" },
    approvedAtRevision: revision,
    dependencyVersion,
    independentOfOperation: "answer",
  };
}

function roadmap(revision = 0): QuestionRoadmap {
  const dependencyVersion = `DEPENDENCY-${revision}`;
  return questionRoadmapSchema.parse({
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
      staleReason: null,
    }],
    currentDecisionItemId: null,
    completedItemIds: [],
    unresolvedDependencyIds: [],
    lookaheadApproval: approval(revision, dependencyVersion),
  });
}

function preparation(): ContextPreparation {
  const digest = {
    ...createInitialContextDigest(new Date(timestamp)),
    confirmedAt: null,
    coverage: {
      coveredLocations: ["Initial Prompt"],
      omissions: ["Page 2 could not be extracted."],
      warnings: ["Partial extraction"],
      requiresAcknowledgement: true,
    },
  };
  return {
    requestId: "REQUEST-CONTEXT",
    status: "ready",
    draftDigest: projectContextDigestSchema.parse(digest),
    temporaryExtraction: {
      sourceId: "SOURCE-INITIAL",
      complete: false,
      warnings: ["Partial extraction"],
      excerpts: [{
        id: "EXCERPT-001",
        sourceId: "SOURCE-INITIAL",
        text: "The source statement.",
        reference: { sourceId: "SOURCE-INITIAL", location: "Initial Prompt", page: null, heading: null, paragraph: 1 },
      }],
    },
    warningAcknowledged: false,
  };
}

describe("V2 frozen contracts", () => {
  it("sends only a bounded relevant excerpt subset on routine Brain turns", () => {
    const currentRoadmap = roadmap();
    currentRoadmap.currentDecisionItemId = "ROADMAP-001";
    const extraction = {
      sourceId: "SOURCE-INITIAL",
      complete: true,
      warnings: [],
      excerpts: Array.from({ length: 10 }, (_, index) => ({
        id: `EXCERPT-${index + 1}`,
        sourceId: "SOURCE-INITIAL",
        text: `${index === 8 ? "Billing permissions owners " : "Background notes "}${"x".repeat(9_000)}`,
        reference: { sourceId: "SOURCE-INITIAL", location: `Paragraph ${index + 1}`, page: null, heading: null, paragraph: index + 1 },
      })),
    };
    const selected = selectRelevantSourceExcerpts(extraction, currentRoadmap, "Who manages billing permissions?");
    expect(selected[0].id).toBe("EXCERPT-9");
    expect(selected).toHaveLength(6);
    expect(selected.reduce((total, excerpt) => total + excerpt.text.length, 0)).toBeLessThanOrEqual(MAX_BRAIN_EXCERPT_CHARACTERS);
    expect(selected.reduce((total, excerpt) => total + excerpt.text.length, 0)).toBeLessThan(extraction.excerpts.reduce((total, excerpt) => total + excerpt.text.length, 0));
  });

  it("validates statement-level context provenance and explicit gap acknowledgement", () => {
    const digest = preparation().draftDigest!;
    expect(validateProjectContextDigest(digest)).toEqual({ valid: true, errors: [] });

    const invalid = structuredClone(digest);
    invalid.statements[0].sourceReferences[0].sourceId = "SOURCE-MISSING";
    invalid.coverage.requiresAcknowledgement = false;
    expect(validateProjectContextDigest(invalid).errors.join("\n")).toMatch(/unknown context source|explicit acknowledgement/);
  });

  it("rejects oversized pasted context without silently truncating", () => {
    const fields = {
      schemaVersion: 1,
      sessionId: "SESSION-001",
      requestId: "REQUEST-001",
      initialPrompt: "Build team billing.",
      pastedContext: "x".repeat(100_001),
    };
    expect(import("@/domain/schemas").then(({ contextPreparationFieldsSchema }) => contextPreparationFieldsSchema.safeParse(fields).success)).resolves.toBe(false);
  });

  it("allows only a dependency-independent, revision-bound Lookahead approval", () => {
    expect(validateQuestionRoadmap(roadmap())).toEqual({ valid: true, errors: [] });
    const invalid = roadmap();
    invalid.items.push({
      id: "ROADMAP-002",
      decisionKey: "provider",
      topic: "Billing provider",
      status: "unresolved",
      priority: 2,
      dependencyIds: ["ROADMAP-001"],
      sourceItemIds: [],
      staleReason: null,
    });
    invalid.lookaheadApproval = { ...approval(), roadmapItemId: "ROADMAP-002" };
    expect(validateQuestionRoadmap(invalid).errors).toContain("Lookahead approval has unresolved dependencies");
  });

  it("revalidates Lookahead work only against a fresh Brain approval", () => {
    const active: ActiveLookahead = { approval: approval(), status: "clarifying", clarificationTurns: [], decisionSummary: null };
    expect(revalidateLookahead(active, roadmap(1))).toMatchObject({ valid: true });
    const stale = roadmap(1);
    stale.lookaheadApproval = null;
    stale.items[0].staleReason = "Permissions now depend on the provider decision.";
    expect(revalidateLookahead(active, stale)).toEqual({ valid: false, reason: "Permissions now depend on the provider decision." });
  });
});

describe("V2 reducer authority and stale-work boundaries", () => {
  it("blocks partial-extraction confirmation until the warning is acknowledged", () => {
    let state = createInitialState("live", new Date(timestamp));
    state = sessionReducer(state, { type: "CONTEXT_PREPARATION_STARTED", requestId: "REQUEST-CONTEXT" });
    state = sessionReducer(state, { type: "CONTEXT_PREPARATION_READY", preparation: preparation() });
    const confirmed = { ...state.contextPreparation!.draftDigest!, confirmedAt: timestamp };
    expect(sessionReducer(state, { type: "CONTEXT_DIGEST_CONFIRMED", digest: confirmed })).toBe(state);
    state = sessionReducer(state, { type: "CONTEXT_WARNING_ACKNOWLEDGED", acknowledged: true });
    state = sessionReducer(state, { type: "CONTEXT_DIGEST_CONFIRMED", digest: confirmed });
    expect(state.phase).toBe("connecting");
    expect(state.confirmedContextDigest?.confirmedAt).toBe(timestamp);
  });

  it("gives duplicate actions immediate idempotent state feedback", () => {
    let state = createInitialState("live", new Date(timestamp));
    state = { ...state, phase: "reviewing_answer", answerDraft: { text: "Owner only.", source: "typed", promptId: "PROMPT-INITIAL", transcriptionItemId: null } };
    const turn = { id: "TURN-001", promptId: "PROMPT-INITIAL", type: "confirmed_answer" as const, text: "Owner only.", createdAt: timestamp };
    state = sessionReducer(state, { type: "BRAIN_REQUESTED", requestId: "REQUEST-001", actionId: "ACTION-001", operation: "answer", turn });
    const duplicate = sessionReducer(state, { type: "BRAIN_REQUESTED", requestId: "REQUEST-002", actionId: "ACTION-002", operation: "answer", turn });
    expect(duplicate).toBe(state);
    expect(state.pendingRequest?.actionId).toBe("ACTION-001");
    expect(state.turns).toHaveLength(1);
  });

  it("permits one active Lookahead and quarantines a stale confirmed summary without mutating the Specification", () => {
    let state = createInitialState("live", new Date(timestamp));
    state = {
      ...state,
      phase: "analyzing",
      confirmedContextDigest: createInitialContextDigest(new Date(timestamp)),
      questionRoadmap: roadmap(),
      pendingRequest: { requestId: "REQUEST-001", baseRevision: 0, operation: "answer", actionId: "ACTION-001" },
      processingStage: "revising_specification",
    };
    state = sessionReducer(state, { type: "LOOKAHEAD_STARTED", approval: approval() });
    const first = state.activeLookahead;
    expect(sessionReducer(state, { type: "LOOKAHEAD_STARTED", approval: approval() }).activeLookahead).toBe(first);

    const summary: DecisionSummary = {
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
    state = sessionReducer(state, { type: "DECISION_SUMMARY_READY", summary });
    state = sessionReducer(state, { type: "DECISION_SUMMARY_CONFIRMED", confirmedAt: timestamp });
    const specification = state.specification;
    state = sessionReducer(state, { type: "LOOKAHEAD_QUARANTINED", reason: "A dependency changed." });
    expect(state.specification).toBe(specification);
    expect(state.activeLookahead).toBeNull();
    expect(state.staleDecisionSummaries[0]).toMatchObject({ status: "not_applied", staleReason: "A dependency changed." });
  });

  it("checkpoints the confirmed digest but drops extraction, queued work, and processing state", () => {
    const state = {
      ...createInitialState("live", new Date(timestamp)),
      phase: "presenting_prompt" as const,
      confirmedContextDigest: createInitialContextDigest(new Date(timestamp)),
      temporaryExtractionAvailable: true,
      questionRoadmap: createEmptyQuestionRoadmap(),
    };
    const checkpoint = createCheckpoint(state, new Date(timestamp));
    expect(checkpoint.state.confirmedContextDigest).toEqual(state.confirmedContextDigest);
    expect(checkpoint.state.temporaryExtractionAvailable).toBe(false);
    expect(checkpoint.state.contextPreparation).toBeNull();
    expect(checkpoint.state.activeLookahead).toBeNull();
    expect(checkpoint.state.processingStage).toBe("idle");
  });
});
