import { describe, expect, it } from "vitest";

import { teamBillingPrompts, teamBillingSnapshots } from "@/demo/team-billing-snapshots";
import { createEmptyQuestionRoadmap } from "@/domain/initial-state";
import { createInitialV3RuntimeState, v3RuntimeReducer } from "@/domain/v3-runtime";
import { migrateSpecificationToV3 } from "@/domain/v3-invariants";
import { interviewJobSchema, type ExchangeIdentity, type InterviewWindow, type V3BrainResponse } from "@/domain/v3-schemas";

const timestamp = "2026-07-21T00:00:00.000Z";
const window: InterviewWindow = {
  id: "WINDOW-SEQUENTIAL-1",
  approvedAtRevision: 1,
  dependencyVersion: "DEPENDENCY-1",
  independentOfOperation: "answer",
  applicationCap: 3,
  permits: [
    {
      id: "PERMIT-101",
      windowId: "WINDOW-SEQUENTIAL-1",
      roadmapItemId: "ROADMAP-003",
      prompt: teamBillingPrompts[2],
      ordinal: 1,
      approvedAtRevision: 1,
      dependencyVersion: "DEPENDENCY-1",
      independentOfOperation: "answer",
      invalidationItemIds: [],
      domainKeys: ["billing_basis"],
    },
    {
      id: "PERMIT-102",
      windowId: "WINDOW-SEQUENTIAL-1",
      roadmapItemId: "ROADMAP-004",
      prompt: teamBillingPrompts[3],
      ordinal: 2,
      approvedAtRevision: 1,
      dependencyVersion: "DEPENDENCY-1",
      independentOfOperation: "answer",
      invalidationItemIds: [],
      domainKeys: ["seat_lifecycle"],
    },
  ],
};

function identity(index: 0 | 1, cancelEpoch: number): ExchangeIdentity {
  const permit = window.permits[index];
  return {
    kind: "permitted",
    exchangeId: `EXCHANGE-SEQUENTIAL-${index + 1}`,
    promptId: permit.prompt.id,
    permitId: permit.id,
    cancelEpoch,
  };
}

function job(index: 0 | 1, cancelEpoch: number) {
  const permit = window.permits[index];
  return interviewJobSchema.parse({
    id: `JOB-SEQUENTIAL-${index + 1}`,
    exchangeId: identity(index, cancelEpoch).exchangeId,
    permit,
    status: "approved",
    clarificationTurns: [],
    decisionSummary: null,
    deferral: null,
    confirmedAt: null,
    revalidatedAtRevision: null,
    revalidatedDependencyVersion: null,
    notAppliedReason: null,
    notAppliedExplanation: null,
  });
}

describe("V3.1 sequential permit promotion and revision barrier", () => {
  it("promotes permit two after permit one confirmation without replacing the active Brain action", () => {
    let runtime = v3RuntimeReducer(createInitialV3RuntimeState({
      eligibleOutcomes: ["applied", "applied", "applied"],
      applicationCap: 3,
      singletonRecoveryStreak: 0,
    }), {
      type: "V3_BRAIN_ACTION_ACCEPTED",
      requestId: "REQUEST-AUTHORITATIVE",
      actionId: "ACTION-AUTHORITATIVE",
      operation: "answer",
      cancelEpoch: 1,
      acceptedAt: timestamp,
    });
    runtime = v3RuntimeReducer(runtime, {
      type: "V3_BRAIN_LIFECYCLE_RECEIVED",
      event: {
        schemaVersion: 1,
        requestId: "REQUEST-AUTHORITATIVE",
        actionId: "ACTION-AUTHORITATIVE",
        baseRevision: 1,
        cancelEpoch: 1,
        attempt: 1,
        sequence: 0,
        observedAt: timestamp,
        kind: "request_accepted",
      },
    });
    runtime = v3RuntimeReducer(runtime, { type: "V3_INTERVIEW_WINDOW_AVAILABLE", window });
    runtime = v3RuntimeReducer(runtime, {
      type: "V3_PERMIT_PRESENTED",
      permit: window.permits[0],
      identity: identity(0, 1),
      job: job(0, 1),
    });
    runtime = v3RuntimeReducer(runtime, {
      type: "V3_JOB_UPDATED",
      job: {
        ...runtime.jobs[0],
        status: "summary_draft",
        decisionSummary: {
          id: "SUMMARY-SEQUENTIAL-1",
          roadmapItemId: window.permits[0].roadmapItemId,
          text: "Charge monthly per active seat.",
          uncertainties: [],
        },
      },
    });
    runtime = v3RuntimeReducer(runtime, {
      type: "V3_JOB_CONFIRMED",
      jobId: "JOB-SEQUENTIAL-1",
      confirmedAt: timestamp,
    });
    runtime = v3RuntimeReducer(runtime, {
      type: "V3_PERMIT_PRESENTED",
      permit: window.permits[1],
      identity: identity(1, 2),
      job: job(1, 2),
    });

    expect(runtime.jobs.map(({ permit, status }) => [permit.ordinal, status])).toEqual([
      [1, "confirmed_queued"],
      [2, "presenting"],
    ]);
    expect(runtime.activeJobId).toBe("JOB-SEQUENTIAL-2");
    expect(runtime.brainActivity).toMatchObject({
      state: "working",
      requestId: "REQUEST-AUTHORITATIVE",
      actionId: "ACTION-AUTHORITATIVE",
    });

    const duplicateAction = v3RuntimeReducer(runtime, {
      type: "V3_BRAIN_ACTION_ACCEPTED",
      requestId: "REQUEST-MUST-NOT-REPLACE",
      actionId: "ACTION-MUST-NOT-REPLACE",
      operation: "answer",
      cancelEpoch: 3,
      acceptedAt: timestamp,
    });
    expect(duplicateAction.brainActivity.requestId).toBe("REQUEST-AUTHORITATIVE");

    runtime = v3RuntimeReducer(runtime, { type: "V3_QUESTIONS_PAUSED", nextCancelEpoch: 3 });
    const freshWindow: InterviewWindow = {
      ...window,
      id: "WINDOW-SEQUENTIAL-2",
      approvedAtRevision: 2,
      dependencyVersion: "DEPENDENCY-2",
      permits: window.permits.map((permit, index) => ({
        ...permit,
        id: `PERMIT-20${index + 1}`,
        windowId: "WINDOW-SEQUENTIAL-2",
        approvedAtRevision: 2,
        dependencyVersion: "DEPENDENCY-2",
      })),
    };
    const response: V3BrainResponse = {
      schemaVersion: 1,
      requestId: "REQUEST-AUTHORITATIVE",
      baseRevision: 1,
      revision: 2,
      provenance: {
        source: "live_ai",
        agent: "brain",
        requestedModel: "gpt-5.6",
        actualModel: "gpt-5.6",
        validatedAt: timestamp,
        repairAttempted: false,
      },
      output: {
        specification: migrateSpecificationToV3(teamBillingSnapshots[1]),
        questionRoadmap: createEmptyQuestionRoadmap(2),
        nextPrompt: teamBillingPrompts[2],
        changeSummary: ["Applied the authoritative answer."],
        interviewWindow: freshWindow,
        priorPermitDispositions: window.permits.map((permit, index) => ({
          priorWindowId: window.id,
          priorPermitId: permit.id,
          roadmapItemId: permit.roadmapItemId,
          status: "reissued" as const,
          freshPermitId: freshWindow.permits[index].id,
          revalidatedAtRevision: 2,
          dependencyVersion: "DEPENDENCY-2",
        })),
      },
    };
    runtime = v3RuntimeReducer(runtime, { type: "V3_BRAIN_RESPONSE_RECEIVED", response });

    expect(runtime.jobs.find(({ id }) => id === "JOB-SEQUENTIAL-2")?.status).toBe("revalidation_pending");
    expect(runtime.activeJobId).toBe("JOB-SEQUENTIAL-2");
  });
});
