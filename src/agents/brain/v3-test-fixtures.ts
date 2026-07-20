import { createEmptyQuestionRoadmap, createInitialContextDigest, emptySpecification } from "@/domain/initial-state";
import { v3BrainModelOutputSchema, v3BrainRequestSchema } from "@/domain/v3-schemas";

export function validV3BrainRequest() {
  return v3BrainRequestSchema.parse({
    schemaVersion: 1,
    sessionId: "SESSION-001",
    mode: "live",
    requestId: "REQUEST-001",
    baseRevision: 0,
    operation: "answer",
    turns: [{
      id: "TURN-001",
      promptId: "PROMPT-INITIAL",
      type: "confirmed_answer",
      text: "We need team billing for our SaaS.",
      createdAt: "2026-07-21T00:00:00.000Z",
    }],
    confirmedContextDigest: createInitialContextDigest(new Date("2026-07-21T00:00:00.000Z")),
    questionRoadmap: createEmptyQuestionRoadmap(0),
    relevantSourceExcerpts: [],
    currentSpecification: { ...emptySpecification, externalEvidence: [] },
    currentPrompt: null,
    actionId: "ACTION-001",
    cancelEpoch: 0,
    requestedApplicationCap: 3,
    priorInterviewWindow: null,
    restoredEntriesForRevalidation: [],
    decisionBatch: null,
    externalEvidenceBundle: [],
  });
}

export function validV3BrainOutput() {
  return v3BrainModelOutputSchema.parse({
    specification: {
      ...emptySpecification,
      title: "Team billing",
      problemStatement: [{
        id: "PROB-001",
        kind: "problem",
        statement: "The SaaS needs team billing.",
        status: "confirmed",
        sourceTurnIds: ["TURN-001"],
        rationale: "The Product Manager explicitly requested team billing.",
        externalEvidenceIds: [],
      }],
      externalEvidence: [],
    },
    questionRoadmap: {
      id: "ROADMAP-STATE",
      baseRevision: 1,
      dependencyVersion: "DEPENDENCY-1",
      items: [{
        id: "ROADMAP-001",
        decisionKey: "billing_roles",
        topic: "Billing roles",
        status: "unresolved",
        priority: 1,
        dependencyIds: [],
        sourceItemIds: ["PROB-001"],
        staleReason: null,
      }],
      currentDecisionItemId: "ROADMAP-001",
      completedItemIds: [],
      unresolvedDependencyIds: [],
      lookaheadApproval: null,
    },
    nextPrompt: {
      id: "PROMPT-001",
      decisionKey: "billing_roles",
      detailedQuestion: "Which roles can manage team billing?",
      spokenQuestion: "Which roles manage billing?",
      whyItMatters: "Billing permissions affect authorization and support risk.",
      confirmedContext: ["team billing"],
      decisionImpact: ["Defines the authorization boundary."],
      recommendation: null,
      visualAid: null,
    },
    changeSummary: ["Captured the team-billing problem."],
    interviewWindow: {
      id: "WINDOW-001",
      approvedAtRevision: 1,
      dependencyVersion: "DEPENDENCY-1",
      independentOfOperation: "answer",
      applicationCap: 3,
      permits: [],
    },
    priorPermitDispositions: [],
  });
}
