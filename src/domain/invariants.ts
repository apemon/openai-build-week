import type { SessionState } from "./types";

export function getInvariantErrors(state: SessionState): string[] {
  const errors: string[] = [];
  if ((state.answerDraft !== null) !== (state.phase === "reviewing_answer")) {
    errors.push("Only reviewing_answer may hold an Answer Draft");
  }
  if (state.phase === "analyzing" && state.pendingRequest === null) {
    errors.push("Analyzing requires a pending request");
  }
  if (state.mode === "demo" && state.provenance.source !== "prepared_demo") {
    errors.push("Demo state requires prepared provenance");
  }
  if (state.mode === "live" && state.provenance.source !== "live_ai") {
    errors.push("Live state requires live provenance");
  }
  return errors;
}

export function assertSessionInvariants(state: SessionState): SessionState {
  const errors = getInvariantErrors(state);
  if (errors.length) throw new Error(errors.join("; "));
  return state;
}
