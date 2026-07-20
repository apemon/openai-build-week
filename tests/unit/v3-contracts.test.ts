import { describe, expect, it } from "vitest";

import { createEmptyQuestionRoadmap, emptySpecification, initialInterviewPrompt } from "@/domain/initial-state";
import type { QuestionRoadmap } from "@/domain/types";
import {
  brainLifecycleEventSchema,
  brainStreamEnvelopeSchema,
  decisionBatchSchema,
  interviewWindowSchema,
  v3BrainRequestSchema,
  v3CheckpointSchema,
  type DecisionBatchEntry,
  type AdaptiveWindowState,
  type InterviewWindow,
} from "@/domain/v3-schemas";
import {
  migrateSpecificationToV3,
  orderDecisionBatchEntries,
  updateAdaptiveWindowState,
  validateInterviewWindow,
  validateLifecycleSequence,
  validatePriorPermitDispositions,
} from "@/domain/v3-invariants";
import { createInitialContextDigest } from "@/domain/initial-state";

const now = "2026-07-21T00:00:00.000Z";

function roadmap(): QuestionRoadmap {
  return {
    ...createEmptyQuestionRoadmap(2),
    dependencyVersion: "DEPENDENCY-2",
    items: [
      { id: "ROADMAP-001", decisionKey: "permissions", topic: "Permissions", status: "unresolved", priority: 1, dependencyIds: [], sourceItemIds: [], staleReason: null },
      { id: "ROADMAP-002", decisionKey: "pricing", topic: "Pricing", status: "unresolved", priority: 2, dependencyIds: [], sourceItemIds: [], staleReason: null },
      { id: "ROADMAP-003", decisionKey: "tax", topic: "Tax", status: "unresolved", priority: 3, dependencyIds: ["ROADMAP-002"], sourceItemIds: [], staleReason: null },
    ],
  };
}

function prompt(id: string, decisionKey: string) {
  return {
    ...initialInterviewPrompt,
    id,
    decisionKey,
    recommendation: null,
  };
}

function window(): InterviewWindow {
  return interviewWindowSchema.parse({
    id: "WINDOW-001",
    approvedAtRevision: 2,
    dependencyVersion: "DEPENDENCY-2",
    independentOfOperation: "answer",
    applicationCap: 3,
    permits: [
      { id: "PERMIT-001", windowId: "WINDOW-001", roadmapItemId: "ROADMAP-001", prompt: prompt("PROMPT-PERMISSION", "permissions"), ordinal: 1, approvedAtRevision: 2, dependencyVersion: "DEPENDENCY-2", independentOfOperation: "answer", invalidationItemIds: ["ROADMAP-003"], domainKeys: ["authorization"] },
      { id: "PERMIT-002", windowId: "WINDOW-001", roadmapItemId: "ROADMAP-002", prompt: prompt("PROMPT-PRICING", "pricing"), ordinal: 2, approvedAtRevision: 2, dependencyVersion: "DEPENDENCY-2", independentOfOperation: "answer", invalidationItemIds: [], domainKeys: ["billing"] },
    ],
  });
}

function batchEntry(overrides: Partial<DecisionBatchEntry> = {}): DecisionBatchEntry {
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
    confirmedAt: now,
    revalidatedAtRevision: 2,
    revalidatedDependencyVersion: "DEPENDENCY-2",
    ...overrides,
  } as DecisionBatchEntry;
}

describe("V3.0 frozen contracts", () => {
  it("migrates V1/V2 Specifications without inventing evidence", () => {
    const migrated = migrateSpecificationToV3(emptySpecification);
    expect(migrated.externalEvidence).toEqual([]);
    expect(migrated.problemStatement).toEqual([]);
  });

  it("accepts a pairwise-independent two-permit window", () => {
    expect(validateInterviewWindow(window(), roadmap(), { revision: 2, dependencyVersion: "DEPENDENCY-2", operation: "answer", applicationCap: 3 })).toEqual({ valid: true, errors: [] });
  });

  it("rejects coupled, mismatched, and self-invalidating permits as one window", () => {
    const coupledRoadmap = roadmap();
    coupledRoadmap.items[1].dependencyIds = ["ROADMAP-001"];
    const candidate = window();
    candidate.permits[0].invalidationItemIds = ["ROADMAP-001"];
    candidate.permits[1].independentOfOperation = "defer";
    const errors = validateInterviewWindow(candidate, coupledRoadmap, { revision: 2, dependencyVersion: "DEPENDENCY-2", operation: "answer", applicationCap: 3 }).errors.join("\n");
    expect(errors).toMatch(/dependency-coupled/);
    expect(errors).toMatch(/cannot invalidate itself/);
    expect(errors).toMatch(/operation does not match/);
  });

  it("requires an exact prior-permit disposition set and compatible reissues", () => {
    const prior = window();
    const fresh = { ...window(), id: "WINDOW-002", permits: window().permits.map((permit, index) => ({ ...permit, id: `PERMIT-00${index + 3}`, windowId: "WINDOW-002" })) };
    const valid = prior.permits.map((permit, index) => ({
      priorWindowId: prior.id,
      priorPermitId: permit.id,
      roadmapItemId: permit.roadmapItemId,
      status: "reissued" as const,
      freshPermitId: fresh.permits[index].id,
      revalidatedAtRevision: 3,
      dependencyVersion: "DEPENDENCY-3",
    }));
    expect(validatePriorPermitDispositions(prior, fresh, valid)).toEqual({ valid: true, errors: [] });
    expect(validatePriorPermitDispositions(prior, fresh, valid.slice(0, 1)).errors).toContain("PERMIT-002: missing prior permit disposition");
  });

  it("enforces operation-conditional Decision Batch request fields", () => {
    const specification = migrateSpecificationToV3(emptySpecification);
    const base = {
      schemaVersion: 1,
      sessionId: "SESSION-001",
      mode: "live",
      requestId: "REQUEST-001",
      baseRevision: 2,
      turns: [],
      confirmedContextDigest: createInitialContextDigest(new Date(now)),
      questionRoadmap: roadmap(),
      relevantSourceExcerpts: [],
      currentSpecification: specification,
      currentPrompt: null,
      actionId: "ACTION-001",
      cancelEpoch: 1,
      requestedApplicationCap: 3,
      priorInterviewWindow: window(),
      restoredEntriesForRevalidation: [],
      externalEvidenceBundle: [],
    };
    expect(v3BrainRequestSchema.safeParse({ ...base, operation: "decision_batch", decisionBatch: null }).success).toBe(false);
    const batch = decisionBatchSchema.parse({ id: "BATCH-001", actionId: "ACTION-001", baseRevision: 2, dependencyVersion: "DEPENDENCY-2", createdAt: now, lockedAt: now, entries: [batchEntry()] });
    expect(v3BrainRequestSchema.safeParse({ ...base, operation: "decision_batch", decisionBatch: batch }).success).toBe(true);
    expect(v3BrainRequestSchema.safeParse({ ...base, operation: "answer", decisionBatch: batch }).success).toBe(false);
  });

  it("keeps lifecycle envelopes strict, content-free, and monotonic", () => {
    const first = brainLifecycleEventSchema.parse({ schemaVersion: 1, requestId: "REQUEST-001", actionId: "ACTION-001", baseRevision: 2, cancelEpoch: 1, attempt: 1, sequence: 1, observedAt: now, kind: "request_accepted" });
    const second = { ...first, sequence: 2, kind: "provider_queued" as const };
    expect(validateLifecycleSequence(first, second, first)).toEqual({ valid: true, errors: [] });
    expect(validateLifecycleSequence(second, first, first).valid).toBe(false);
    expect(brainStreamEnvelopeSchema.safeParse({ type: "lifecycle", event: { ...first, prompt: "secret content" } }).success).toBe(false);
  });

  it("shrinks after two invalidations and restores only after two singleton applications", () => {
    const state: AdaptiveWindowState = { eligibleOutcomes: [], applicationCap: 3, singletonRecoveryStreak: 0 };
    let next = updateAdaptiveWindowState(state, "dependency_invalidated", false);
    next = updateAdaptiveWindowState(next, "applied", false);
    next = updateAdaptiveWindowState(next, "dependency_invalidated", false);
    expect(next).toMatchObject({ applicationCap: 1, singletonRecoveryStreak: 0 });
    next = updateAdaptiveWindowState(next, "applied", true);
    expect(next.applicationCap).toBe(1);
    next = updateAdaptiveWindowState(next, "applied", true);
    expect(next.applicationCap).toBe(3);
  });

  it("orders batch entries by permit ordinal, confirmation time, then stable ID", () => {
    const ordered = orderDecisionBatchEntries([
      batchEntry({ jobId: "JOB-003", permitId: "PERMIT-003", roadmapItemId: "ROADMAP-003", permitOrdinal: 2 }),
      batchEntry({ jobId: "JOB-002", permitId: "PERMIT-002", roadmapItemId: "ROADMAP-002", permitOrdinal: 1, confirmedAt: "2026-07-21T00:00:01.000Z" }),
      batchEntry({ jobId: "JOB-001", permitOrdinal: 1 }),
    ]);
    expect(ordered.map((entry) => entry.jobId)).toEqual(["JOB-001", "JOB-002", "JOB-003"]);
  });

  it("freezes checkpoint v3 to confirmed queued entries plus content-free adaptive state", () => {
    const result = v3CheckpointSchema.safeParse({ schemaVersion: 3, savedAt: now, state: {}, confirmedQueuedEntries: [], adaptiveWindow: { eligibleOutcomes: [], applicationCap: 1, singletonRecoveryStreak: 0 } });
    expect(result.success).toBe(false);
    expect(v3CheckpointSchema.shape.confirmedQueuedEntries.safeParse(Array.from({ length: 4 }, (_, index) => batchEntry({ jobId: `JOB-00${index + 1}` }))).success).toBe(false);
  });
});
