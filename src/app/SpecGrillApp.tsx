"use client";

import { useReducer, useRef } from "react";
import { FinalReview } from "@/components/final-review/FinalReview";
import { InterviewRoom } from "@/components/interview/InterviewRoom";
import { StartScreen } from "@/components/start/StartScreen";
import { PreparedDemoRunner } from "@/demo/demo-runner";
import { createInitialState } from "@/domain/initial-state";
import { sessionReducer } from "@/domain/session-reducer";

export function SpecGrillApp({ liveEnabled }: { liveEnabled: boolean }) {
  const [state, dispatch] = useReducer(sessionReducer, createInitialState("live"));
  const runner = useRef<PreparedDemoRunner | null>(null);
  const startDemo = () => {
    runner.current = new PreparedDemoRunner();
    const next = createInitialState("demo");
    next.phase = "presenting_prompt";
    next.currentPrompt = runner.current.currentPrompt;
    dispatch({ type: "RESTORE_CHECKPOINT", state: next });
  };
  if (state.phase === "start") {
    return <StartScreen liveEnabled={false && liveEnabled} liveUnavailableReason="Live integration follows the deterministic demo milestone." onEnableMicrophone={() => {}} onStartLiveText={() => {}} onStartPreparedDemo={startDemo} />;
  }
  if (state.phase === "final_review" || state.phase === "finalized") {
    return <FinalReview specification={state.specification} revision={state.revision} mode="demo" finalized={state.phase === "finalized"} onNextActionsChange={(nextActions) => dispatch({ type: "NEXT_ACTIONS_UPDATED", specification: { ...state.specification, nextActions } })} onFinalize={() => dispatch({ type: "FINALIZE" })} onResume={startDemo} onExit={() => dispatch({ type: "RESTORE_CHECKPOINT", state: createInitialState("live") })} />;
  }
  return <InterviewRoom state={state} remainingLabel="30:00" microphoneState="off" voiceMuted={false} onToggleVoice={() => {}} onResumeMicrophone={() => {}} onCreateDraft={() => {}} onEditDraft={() => {}} onConfirmDraft={() => {}} onRecordAgain={() => {}} onReviewSpecification={() => dispatch({ type: "ENTER_FINAL_REVIEW" })} onCorrectItem={() => {}} onUsePreparedAnswer={() => { const step = runner.current!.advance(new Date().toISOString()); dispatch({ type: "DEMO_REVISION_APPLIED", specification: step.specification, nextPrompt: step.nextPrompt, turn: step.turn }); }} />;
}
