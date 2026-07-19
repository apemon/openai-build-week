import type { InterviewPrompt, SessionMode, SessionState, Specification } from "./types";
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
