import type {
  AnswerDraft,
  BrainOperation,
  BrainResponse,
  ClarificationTurn,
  ContextPreparation,
  DecisionSummary,
  InterviewPrompt,
  LookaheadApproval,
  ProcessingStage,
  ProjectContextDigest,
  RecoverableError,
  SessionPhase,
  Specification,
  ConversationTurn,
  ConfirmedProjectContextDigest,
} from "./types";

export type SessionEvent =
  | { type: "START_SESSION"; textOnly: boolean }
  | { type: "CONTEXT_PREPARATION_STARTED"; requestId: string }
  | { type: "CONTEXT_PREPARATION_READY"; preparation: ContextPreparation }
  | { type: "CONTEXT_DIGEST_EDITED"; digest: ProjectContextDigest }
  | { type: "CONTEXT_WARNING_ACKNOWLEDGED"; acknowledged: boolean }
  | { type: "CONTEXT_DIGEST_CONFIRMED"; digest: ConfirmedProjectContextDigest }
  | { type: "TEMPORARY_EXTRACTION_LOST" }
  | { type: "PROMPT_PRESENTED" }
  | { type: "LISTENING_STARTED" }
  | { type: "SPEECH_STARTED" }
  | { type: "SPEECH_STOPPED" }
  | { type: "ANSWER_DRAFT_READY"; draft: AnswerDraft }
  | { type: "ANSWER_DRAFT_EDITED"; text: string }
  | { type: "ANSWER_DRAFT_DISCARDED" }
  | { type: "BRAIN_REQUESTED"; requestId: string; actionId: string; operation: BrainOperation; turn?: ConversationTurn }
  | { type: "BRAIN_RETRY_REQUESTED"; requestId: string; actionId: string; operation: BrainOperation }
  | { type: "BRAIN_RESUME_REQUESTED"; requestId: string; actionId: string }
  | { type: "BRAIN_RESPONSE_RECEIVED"; response: BrainResponse }
  | { type: "PROCESSING_STAGE_CHANGED"; stage: ProcessingStage }
  | { type: "LOOKAHEAD_STARTED"; approval: LookaheadApproval }
  | { type: "CLARIFICATION_TURN_ADDED"; turn: ClarificationTurn }
  | { type: "DECISION_SUMMARY_READY"; summary: DecisionSummary }
  | { type: "DECISION_SUMMARY_EDITED"; text: string }
  | { type: "DECISION_SUMMARY_CONFIRMED"; confirmedAt: string }
  | { type: "LOOKAHEAD_QUARANTINED"; reason: string }
  | { type: "DEMO_REVISION_APPLIED"; specification: Specification; nextPrompt: InterviewPrompt | null; turn: ConversationTurn }
  | { type: "ENTER_FINAL_REVIEW" }
  | { type: "FINALIZE" }
  | { type: "RESUME_GRILLING" }
  | { type: "NEXT_ACTIONS_UPDATED"; specification: Specification }
  | { type: "RECOVERABLE_ERROR"; error: RecoverableError }
  | { type: "RETRY_FROM_ERROR" }
  | { type: "RESET_SESSION" }
  | { type: "RESTORE_CHECKPOINT"; state: import("./types").SessionState }
  | { type: "SET_PHASE"; phase: SessionPhase };
