import { createInitialState } from "./initial-state";
import { assertSessionInvariants } from "./invariants";
import type { SessionEvent } from "./session-events";
import type { SessionState } from "./types";

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  let next = state;
  switch (event.type) {
    case "START_SESSION":
      next = { ...state, phase: "preparing_context", error: null };
      break;
    case "CONTEXT_PREPARATION_STARTED":
      if (state.phase !== "start" && state.phase !== "preparing_context") return state;
      next = {
        ...state,
        phase: "preparing_context",
        contextPreparation: {
          requestId: event.requestId,
          status: "extracting",
          draftDigest: null,
          temporaryExtraction: null,
          warningAcknowledged: false,
        },
        error: null,
      };
      break;
    case "CONTEXT_PREPARATION_READY":
      if (state.contextPreparation?.requestId !== event.preparation.requestId || event.preparation.status !== "ready") return state;
      next = {
        ...state,
        phase: "reviewing_context",
        contextPreparation: event.preparation,
        temporaryExtractionAvailable: event.preparation.temporaryExtraction !== null,
      };
      break;
    case "CONTEXT_DIGEST_EDITED":
      if (state.phase !== "reviewing_context" || !state.contextPreparation) return state;
      next = { ...state, contextPreparation: { ...state.contextPreparation, draftDigest: event.digest } };
      break;
    case "CONTEXT_WARNING_ACKNOWLEDGED":
      if (state.phase !== "reviewing_context" || !state.contextPreparation) return state;
      next = { ...state, contextPreparation: { ...state.contextPreparation, warningAcknowledged: event.acknowledged } };
      break;
    case "CONTEXT_DIGEST_CONFIRMED":
      if (state.phase !== "reviewing_context" || !state.contextPreparation?.draftDigest) return state;
      if (event.digest.coverage.requiresAcknowledgement && !state.contextPreparation.warningAcknowledged) return state;
      next = {
        ...state,
        phase: "connecting",
        confirmedContextDigest: event.digest,
        processingStage: "idle",
        contextPreparation: null,
      };
      break;
    case "TEMPORARY_EXTRACTION_LOST":
      next = { ...state, temporaryExtractionAvailable: false, contextPreparation: null };
      break;
    case "PROMPT_PRESENTED":
      next = { ...state, phase: "presenting_prompt", answerDraft: null, error: null };
      break;
    case "LISTENING_STARTED":
      next = { ...state, phase: "listening", answerDraft: null };
      break;
    case "SPEECH_STARTED":
      next = state.phase === "listening" ? { ...state, phase: "speech_detected" } : state;
      break;
    case "SPEECH_STOPPED":
      next = state.phase === "speech_detected" ? { ...state, phase: "transcribing" } : state;
      break;
    case "ANSWER_DRAFT_READY":
      next = { ...state, phase: "reviewing_answer", answerDraft: event.draft };
      break;
    case "ANSWER_DRAFT_EDITED":
      next = state.answerDraft ? { ...state, answerDraft: { ...state.answerDraft, text: event.text.slice(0, 4_000) } } : state;
      break;
    case "ANSWER_DRAFT_DISCARDED":
      next = { ...state, phase: "presenting_prompt", answerDraft: null };
      break;
    case "BRAIN_REQUESTED":
      if (state.pendingRequest) return state;
      if (event.operation !== "initialize" && event.operation !== "resume" && !event.turn) return state;
      if (event.operation === "answer" || event.operation === "correct") {
        if (state.phase !== "reviewing_answer") return state;
      }
      next = {
        ...state,
        phase: "analyzing",
        answerDraft: null,
        turns: event.turn ? [...state.turns, event.turn] : state.turns,
        pendingRequest: { requestId: event.requestId, baseRevision: state.revision, operation: event.operation, actionId: event.actionId },
        processingStage: "validating_confirmed_input",
        error: null,
      };
      break;
    case "BRAIN_RETRY_REQUESTED":
      if (state.phase !== "recoverable_error") return state;
      next = { ...state, phase: "analyzing", pendingRequest: { requestId: event.requestId, baseRevision: state.revision, operation: event.operation, actionId: event.actionId }, processingStage: "validating_confirmed_input", error: null };
      break;
    case "BRAIN_RESUME_REQUESTED":
      if (state.mode !== "live" || (state.phase !== "final_review" && state.phase !== "finalized")) return state;
      next = { ...state, phase: "analyzing", pendingRequest: { requestId: event.requestId, baseRevision: state.revision, operation: "resume", actionId: event.actionId }, processingStage: "validating_confirmed_input", answerDraft: null, error: null };
      break;
    case "BRAIN_RESPONSE_RECEIVED": {
      const { response } = event;
      if (!state.pendingRequest || response.requestId !== state.pendingRequest.requestId || response.baseRevision !== state.revision || response.revision !== state.revision + 1) return state;
      next = {
        ...state,
        phase: response.output.nextPrompt ? "presenting_prompt" : "final_review",
        revision: response.revision,
        specification: response.output.specification,
        questionRoadmap: response.output.questionRoadmap,
        currentPrompt: response.output.nextPrompt,
        pendingRequest: null,
        processingStage: "idle",
        error: null,
      };
      break;
    }
    case "PROCESSING_STAGE_CHANGED":
      if (state.phase !== "analyzing") return state;
      next = { ...state, processingStage: event.stage };
      break;
    case "LOOKAHEAD_STARTED":
      if (!state.pendingRequest || state.activeLookahead) return state;
      if (state.questionRoadmap.lookaheadApproval?.prompt.id !== event.approval.prompt.id) return state;
      next = {
        ...state,
        phase: "clarifying_lookahead",
        activeLookahead: { approval: event.approval, status: "approved", clarificationTurns: [], decisionSummary: null },
        staleLookaheadReason: null,
      };
      break;
    case "CLARIFICATION_TURN_ADDED":
      if (!state.activeLookahead || state.activeLookahead.status === "queued" || state.activeLookahead.status === "not_applied") return state;
      next = {
        ...state,
        phase: "clarifying_lookahead",
        activeLookahead: {
          ...state.activeLookahead,
          status: "clarifying",
          clarificationTurns: [...state.activeLookahead.clarificationTurns, event.turn],
        },
      };
      break;
    case "DECISION_SUMMARY_READY":
      if (!state.activeLookahead || event.summary.roadmapItemId !== state.activeLookahead.approval.roadmapItemId) return state;
      next = { ...state, phase: "reviewing_decision_summary", activeLookahead: { ...state.activeLookahead, status: "summary_draft", decisionSummary: event.summary } };
      break;
    case "DECISION_SUMMARY_EDITED":
      if (state.phase !== "reviewing_decision_summary" || !state.activeLookahead?.decisionSummary) return state;
      next = { ...state, activeLookahead: { ...state.activeLookahead, decisionSummary: { ...state.activeLookahead.decisionSummary, text: event.text.slice(0, 4_000) } } };
      break;
    case "DECISION_SUMMARY_CONFIRMED":
      if (state.phase !== "reviewing_decision_summary" || !state.activeLookahead?.decisionSummary || state.pendingRequest === null) return state;
      next = {
        ...state,
        phase: "queued_decision_summary",
        activeLookahead: {
          ...state.activeLookahead,
          status: "queued",
          decisionSummary: { ...state.activeLookahead.decisionSummary, status: "confirmed_queued", confirmedAt: event.confirmedAt },
        },
      };
      break;
    case "LOOKAHEAD_QUARANTINED": {
      if (!state.activeLookahead) return state;
      const summary = state.activeLookahead.decisionSummary;
      next = {
        ...state,
        phase: state.pendingRequest ? "analyzing" : state.currentPrompt ? "presenting_prompt" : "final_review",
        activeLookahead: null,
        staleLookaheadReason: event.reason,
        staleDecisionSummaries: summary
          ? [...state.staleDecisionSummaries, { ...summary, status: "not_applied", staleReason: event.reason }]
          : state.staleDecisionSummaries,
      };
      break;
    }
    case "DEMO_REVISION_APPLIED":
      if (state.mode !== "demo") return state;
      next = { ...state, revision: state.revision + 1, turns: [...state.turns, event.turn], specification: event.specification, currentPrompt: event.nextPrompt, phase: event.nextPrompt ? "presenting_prompt" : "final_review" };
      break;
    case "ENTER_FINAL_REVIEW":
      next = { ...state, phase: "final_review", answerDraft: null, pendingRequest: null, processingStage: "idle", activeLookahead: null };
      break;
    case "FINALIZE":
      next = { ...state, phase: "finalized", lastFinalizedRevision: state.revision, finalizedSpecification: state.specification, answerDraft: null };
      break;
    case "RESUME_GRILLING":
      next = { ...state, phase: "presenting_prompt", currentPrompt: state.currentPrompt ?? null };
      break;
    case "NEXT_ACTIONS_UPDATED":
      next = { ...state, specification: event.specification };
      break;
    case "RECOVERABLE_ERROR":
      next = { ...state, phase: "recoverable_error", pendingRequest: null, processingStage: "idle", error: event.error };
      break;
    case "RETRY_FROM_ERROR":
      next = state.error ? { ...state, phase: state.error.returnPhase, error: null } : state;
      break;
    case "RESTORE_CHECKPOINT":
      next = event.state;
      break;
    case "RESET_SESSION":
      next = createInitialState(state.mode);
      break;
    case "SET_PHASE":
      next = { ...state, phase: event.phase, answerDraft: event.phase === "reviewing_answer" ? state.answerDraft : null };
      break;
  }
  return assertSessionInvariants(next);
}
