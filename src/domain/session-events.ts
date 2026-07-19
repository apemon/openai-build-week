import type { AnswerDraft, BrainResponse, ConversationTurn, InterviewPrompt, RecoverableError, SessionPhase, Specification } from "./types";

export type SessionEvent =
  | { type: "START_SESSION"; textOnly: boolean }
  | { type: "PROMPT_PRESENTED" }
  | { type: "LISTENING_STARTED" }
  | { type: "SPEECH_STARTED" }
  | { type: "SPEECH_STOPPED" }
  | { type: "ANSWER_DRAFT_READY"; draft: AnswerDraft }
  | { type: "ANSWER_DRAFT_EDITED"; text: string }
  | { type: "ANSWER_DRAFT_DISCARDED" }
  | { type: "BRAIN_REQUESTED"; requestId: string; turn: ConversationTurn }
  | { type: "BRAIN_RETRY_REQUESTED"; requestId: string }
  | { type: "BRAIN_RESUME_REQUESTED"; requestId: string }
  | { type: "BRAIN_RESPONSE_RECEIVED"; response: BrainResponse }
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
