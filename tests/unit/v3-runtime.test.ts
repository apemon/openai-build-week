import { describe, expect, it } from "vitest";

import { createInitialV3RuntimeState, deriveBrainActivity, getV3RuntimeInvariantErrors, v3RuntimeReducer } from "@/domain/v3-runtime";
import { interviewJobSchema, interviewWindowSchema } from "@/domain/v3-schemas";
import { initialInterviewPrompt } from "@/domain/initial-state";

const now = "2026-07-21T00:00:00.000Z";

const window = interviewWindowSchema.parse({
  id: "WINDOW-001", approvedAtRevision: 0, dependencyVersion: "DEPENDENCY-0", independentOfOperation: "answer", applicationCap: 1,
  permits: [{ id: "PERMIT-001", windowId: "WINDOW-001", roadmapItemId: "ROADMAP-001", prompt: { ...initialInterviewPrompt, id: "PROMPT-PERMIT", externalEvidenceIds: undefined }, ordinal: 1, approvedAtRevision: 0, dependencyVersion: "DEPENDENCY-0", independentOfOperation: "answer", invalidationItemIds: [], domainKeys: [] }],
});

function job() {
  return interviewJobSchema.parse({
    id: "JOB-001", exchangeId: "EXCHANGE-001", permit: window.permits[0], status: "approved", clarificationTurns: [],
    decisionSummary: { id: "SUMMARY-001", roadmapItemId: "ROADMAP-001", text: "Owners control billing.", uncertainties: [] },
    deferral: null, confirmedAt: null, revalidatedAtRevision: null, revalidatedDependencyVersion: null, notAppliedReason: null, notAppliedExplanation: null,
  });
}

describe("V3 runtime ordering", () => {
  it("accepts one active permitted question and makes confirmation idempotent", () => {
    let state = createInitialV3RuntimeState();
    state = v3RuntimeReducer(state, { type: "V3_INTERVIEW_WINDOW_AVAILABLE", window });
    state = v3RuntimeReducer(state, { type: "V3_PERMIT_PRESENTED", permit: window.permits[0], job: job(), identity: { kind: "permitted", exchangeId: "EXCHANGE-001", promptId: "PROMPT-PERMIT", permitId: "PERMIT-001", cancelEpoch: 0 } });
    state = v3RuntimeReducer(state, { type: "V3_JOB_UPDATED", job: { ...state.jobs[0], status: "summary_draft" } });
    state = v3RuntimeReducer(state, { type: "V3_JOB_CONFIRMED", jobId: "JOB-001", confirmedAt: now });
    const duplicate = v3RuntimeReducer(state, { type: "V3_JOB_CONFIRMED", jobId: "JOB-001", confirmedAt: now });
    expect(duplicate).toEqual(state);
    expect(state.jobs[0]).toMatchObject({ status: "confirmed_queued", confirmedAt: now });
    expect(state.activeJobId).toBeNull();
  });

  it("keeps one-question and cap invariants explicit", () => {
    const state = createInitialV3RuntimeState();
    expect(getV3RuntimeInvariantErrors(state)).toEqual([]);
    expect(() => interviewWindowSchema.parse({ ...window, applicationCap: 1, permits: [...window.permits, { ...window.permits[0], id: "PERMIT-002", ordinal: 2 }] })).toThrow();
  });

  it("uses lifecycle freshness before the taking-longer threshold", () => {
    let state = createInitialV3RuntimeState();
    state = v3RuntimeReducer(state, { type: "V3_BRAIN_ACTION_ACCEPTED", requestId: "REQUEST-001", actionId: "ACTION-001", operation: "answer", cancelEpoch: 1, acceptedAt: now });
    expect(deriveBrainActivity(state, Date.parse(now) + 9_999)).toBe("working");
    expect(deriveBrainActivity(state, Date.parse(now) + 10_000)).toBe("needs_attention");
    state = { ...state, brainActivity: { ...state.brainActivity, lastLifecycleAt: "2026-07-21T00:00:25.000Z" } };
    expect(deriveBrainActivity(state, Date.parse(now) + 30_000)).toBe("taking_longer");
  });
});
