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
  ActiveLookahead,
  QuestionRoadmap,
} from "./types";
import type {
  BrainLifecycleEvent,
  DecisionBatch,
  ExchangeIdentity,
  InterviewJob,
  InterviewWindow,
  NotAppliedReason,
  QuestionPermit,
  RestoredAsyncEntry,
  V3BrainOperation,
  V3BrainResponse,
} from "./v3-schemas";

export type SessionEvent =
  | { type: "START_SESSION"; textOnly: boolean }
  | { type: "CONTEXT_PREPARATION_STARTED"; requestId: string }
  | { type: "CONTEXT_PREPARATION_READY"; preparation: ContextPreparation }
  | { type: "CONTEXT_PREPARATION_FAILED" }
  | { type: "CONTEXT_DIGEST_EDITED"; digest: ProjectContextDigest }
  | { type: "CONTEXT_WARNING_ACKNOWLEDGED"; acknowledged: boolean }
  | { type: "CONTEXT_DIGEST_CONFIRMED"; digest: ConfirmedProjectContextDigest }
  | { type: "TEMPORARY_EXTRACTION_LOST" }
  | { type: "REALTIME_MODEL_CONNECTED"; model: string }
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
  | { type: "BRAIN_RESPONSE_RECEIVED"; response: BrainResponse; batchTurns?: ConversationTurn[] }
  | { type: "BRAIN_NONMUTATING_RESPONSE_RECEIVED"; requestId: string; baseRevision: number }
  | { type: "PROCESSING_STAGE_CHANGED"; stage: ProcessingStage }
  | { type: "LOOKAHEAD_STARTED"; approval: LookaheadApproval }
  | { type: "CLARIFICATION_TURN_ADDED"; turn: ClarificationTurn }
  | { type: "DECISION_SUMMARY_READY"; summary: DecisionSummary }
  | { type: "DECISION_SUMMARY_EDITED"; text: string }
  | { type: "DECISION_SUMMARY_CONFIRMED"; confirmedAt: string }
  | { type: "LOOKAHEAD_QUARANTINED"; reason: string }
  | { type: "DEMO_PROCESSING_STARTED"; stage: ProcessingStage }
  | { type: "DEMO_LOOKAHEAD_PRESENTED"; active: ActiveLookahead }
  | { type: "DEMO_REVISION_APPLIED"; specification: Specification; questionRoadmap: QuestionRoadmap; nextPrompt: InterviewPrompt | null; turn: ConversationTurn }
  | { type: "ENTER_FINAL_REVIEW" }
  | { type: "ABANDON_PENDING_AND_ENTER_FINAL_REVIEW"; reason: string }
  | { type: "FINALIZE" }
  | { type: "RESUME_GRILLING" }
  | { type: "NEXT_ACTIONS_UPDATED"; specification: Specification }
  | { type: "RECOVERABLE_ERROR"; error: RecoverableError }
  | { type: "RETRY_FROM_ERROR" }
  | { type: "RESET_SESSION" }
  | { type: "RESTORE_CHECKPOINT"; state: import("./types").SessionState }
  | { type: "SET_PHASE"; phase: SessionPhase };

/** Frozen V3 reducer boundary. These events are consumed by the V3 reducer
 * extension only after V3.0; V1/V2 events remain available during migration. */
export type V3SessionEvent =
  | { type: "V3_RUNTIME_RESET" }
  | { type: "V3_DEMO_FRAME_LOADED"; interviewWindow: InterviewWindow | null; jobs: InterviewJob[]; activeJobId: string | null; lockedBatch: DecisionBatch | null; activity: { state: import("./v3-schemas").BrainActivityState; acceptedAt: string | null; lastLifecycleAt: string | null } }
  | { type: "V3_BRAIN_ACTION_ACCEPTED"; requestId: string; actionId: string; operation: V3BrainOperation; cancelEpoch: number; acceptedAt: string }
  | { type: "V3_BRAIN_LIFECYCLE_RECEIVED"; event: BrainLifecycleEvent }
  | { type: "V3_BRAIN_STREAM_INTERRUPTED"; requestId: string; actionId: string; cancelEpoch: number; observedAt: string }
  | { type: "V3_BRAIN_TIMED_OUT"; requestId: string; actionId: string; cancelEpoch: number; observedAt: string }
  | { type: "V3_BRAIN_RESPONSE_RECEIVED"; response: V3BrainResponse }
  | { type: "V3_INTERVIEW_WINDOW_AVAILABLE"; window: InterviewWindow }
  | { type: "V3_PERMIT_PRESENTED"; permit: QuestionPermit; identity: ExchangeIdentity; job: InterviewJob }
  | { type: "V3_JOB_UPDATED"; job: InterviewJob }
  | { type: "V3_JOB_CONFIRMED"; jobId: string; confirmedAt: string }
  | { type: "V3_JOB_CONFIRMATION_UNDONE"; jobId: string }
  | { type: "V3_JOB_REVALIDATION_PENDING"; jobId: string }
  | { type: "V3_JOB_NOT_APPLIED"; jobId: string; reason: NotAppliedReason; explanation: string }
  | { type: "V3_QUESTIONS_PAUSED"; nextCancelEpoch: number }
  | { type: "V3_QUESTIONS_RESUMED"; permit: QuestionPermit; identity: ExchangeIdentity }
  | { type: "V3_DECISION_BATCH_LOCKED"; batch: DecisionBatch }
  | { type: "V3_DECISION_BATCH_RETRY_REQUESTED"; batchId: string; requestId: string; actionId: string; cancelEpoch: number }
  | { type: "V3_RESTORED_ENTRIES_LOADED"; entries: RestoredAsyncEntry[] }
  | { type: "V3_CHECKPOINT_RESTORED"; entries: RestoredAsyncEntry[]; adaptiveWindow: import("./v3-schemas").AdaptiveWindowState }
  | { type: "V3_RESTORED_REVALIDATION_REQUESTED"; requestId: string; actionId: string; cancelEpoch: number }
  | { type: "V3_RESTORED_SUBMISSION_REQUESTED"; batch: DecisionBatch }
  | { type: "V3_RESTORED_ENTRIES_DISCARDED" };
