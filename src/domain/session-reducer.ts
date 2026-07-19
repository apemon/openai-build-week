import { createInitialState } from "./initial-state";
import { assertSessionInvariants } from "./invariants";
import type { SessionEvent } from "./session-events";
import type { SessionState } from "./types";

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  let next = state;
  switch (event.type) {
    case "START_SESSION":
      next = { ...state, phase: event.textOnly ? "presenting_prompt" : "connecting", error: null };
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
      if (state.phase !== "reviewing_answer" && event.turn.type !== "deferred_prompt") return state;
      next = {
        ...state,
        phase: "analyzing",
        answerDraft: null,
        turns: [...state.turns, event.turn],
        pendingRequest: { requestId: event.requestId, baseRevision: state.revision },
        error: null,
      };
      break;
    case "BRAIN_RESPONSE_RECEIVED": {
      const { response } = event;
      if (!state.pendingRequest || response.requestId !== state.pendingRequest.requestId || response.baseRevision !== state.revision || response.revision !== state.revision + 1) return state;
      next = {
        ...state,
        phase: response.output.nextPrompt ? "presenting_prompt" : "final_review",
        revision: response.revision,
        specification: response.output.specification,
        currentPrompt: response.output.nextPrompt,
        pendingRequest: null,
        error: null,
      };
      break;
    }
    case "DEMO_REVISION_APPLIED":
      if (state.mode !== "demo") return state;
      next = { ...state, revision: state.revision + 1, turns: [...state.turns, event.turn], specification: event.specification, currentPrompt: event.nextPrompt, phase: event.nextPrompt ? "presenting_prompt" : "final_review" };
      break;
    case "ENTER_FINAL_REVIEW":
      next = { ...state, phase: "final_review", answerDraft: null, pendingRequest: null };
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
      next = { ...state, phase: "recoverable_error", pendingRequest: null, error: event.error };
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
