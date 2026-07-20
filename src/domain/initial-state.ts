import type { ConfirmedProjectContextDigest, InterviewPrompt, QuestionRoadmap, SessionMode, SessionState, Specification } from "./types";
import { createId } from "./ids";

export const emptySpecification: Specification = {
  title: "Untitled specification",
  problemStatement: [],
  users: [],
  jobsToBeDone: [],
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  assumptions: [],
  risks: [],
  edgeCases: [],
  openQuestions: [],
  blockers: [],
  acceptanceCriteria: [],
  nextActions: [],
  readiness: { status: "draft", evidence: [], blockerIds: [], openQuestionIds: [] },
};

export const initialInterviewPrompt: InterviewPrompt = {
  id: "PROMPT-INITIAL",
  decisionKey: "initial_request",
  detailedQuestion: "What do you want to build, and what current pain should it solve?",
  spokenQuestion: "What do you want to build?",
  whyItMatters: "This gives the interview a concrete product problem to clarify.",
  confirmedContext: [],
  decisionImpact: ["Sets the scope for the first specification revision."],
  recommendation: null,
  visualAid: null,
};

export function createInitialContextDigest(now = new Date()): ConfirmedProjectContextDigest {
  return {
    id: "DIGEST-INITIAL",
    initialPrompt: "What do you want to build?",
    statements: [{
      id: "CTX-001",
      statement: "The Product Manager wants to define a product to build.",
      sourceReferences: [{ sourceId: "SOURCE-INITIAL", location: "Initial Prompt", page: null, heading: null, paragraph: 1 }],
    }],
    sources: [{ id: "SOURCE-INITIAL", kind: "initial_prompt", filename: null, mimeType: "text/plain", sizeBytes: null, characterCount: 26, pageCount: null }],
    coverage: { coveredLocations: ["Initial Prompt"], omissions: [], warnings: [], requiresAcknowledgement: false },
    confirmedAt: now.toISOString(),
  };
}

export function createEmptyQuestionRoadmap(revision = 0): QuestionRoadmap {
  return {
    id: "ROADMAP-STATE",
    baseRevision: revision,
    dependencyVersion: `DEPENDENCY-${revision}`,
    items: [],
    currentDecisionItemId: null,
    completedItemIds: [],
    unresolvedDependencyIds: [],
    lookaheadApproval: null,
  };
}

export function createInitialState(mode: SessionMode, now = new Date()): SessionState {
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1_000);
  return {
    sessionId: createId("SESSION"),
    mode,
    phase: "start",
    startedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revision: 0,
    turns: [],
    specification: emptySpecification,
    currentPrompt: initialInterviewPrompt,
    contextPreparation: null,
    confirmedContextDigest: null,
    temporaryExtractionAvailable: false,
    questionRoadmap: createEmptyQuestionRoadmap(),
    activeLookahead: null,
    staleLookaheadReason: null,
    staleDecisionSummaries: [],
    processingStage: "idle",
    answerDraft: null,
    lastFinalizedRevision: null,
    finalizedSpecification: null,
    provenance:
      mode === "demo"
        ? { source: "prepared_demo", scenario: "team_billing", validatedAt: now.toISOString() }
        : { source: "live_ai", brainModel: "gpt-5.6", realtimeModel: null },
    pendingRequest: null,
    error: null,
  };
}
