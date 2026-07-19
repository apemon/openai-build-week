"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { FinalReview } from "@/components/final-review/FinalReview";
import { InterviewRoom } from "@/components/interview/InterviewRoom";
import { StartScreen } from "@/components/start/StartScreen";
import { PreparedDemoRunner, playPreparedAudio } from "@/demo/demo-runner";
import { createId } from "@/domain/ids";
import { createInitialState, emptySpecification } from "@/domain/initial-state";
import { apiErrorSchema, brainResponseSchema, realtimeSessionResponseSchema } from "@/domain/schemas";
import { sessionReducer } from "@/domain/session-reducer";
import type { AnswerDraft, ConversationTurn, NextAction, RecoverableError, SpecificationItem } from "@/domain/types";
import { clearCheckpoint, restoreCheckpoint, saveCheckpoint } from "@/lib/session-checkpoint";
import { OpenAIWebRTCTransport } from "@/realtime/OpenAIWebRTCTransport";
import { useCommunicator } from "@/realtime/useCommunicator";

const initialState = createInitialState("live");

function recoverable(message: string, code = "INTERNAL_ERROR", retryable = true): RecoverableError {
  return { code, message, retryable, returnPhase: "presenting_prompt" };
}

export function SpecGrillApp({ liveEnabled }: { liveEnabled: boolean }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [preparedAudioUnavailable, setPreparedAudioUnavailable] = useState(false);
  const [changedItemIds, setChangedItemIds] = useState<string[]>([]);
  const [remainingLabel, setRemainingLabel] = useState("30:00");
  const pendingOperation = useRef<"answer" | "correct">("answer");
  const lastBrainOperation = useRef<"answer" | "defer" | "correct" | "resume">("answer");
  const demoRunner = useRef<PreparedDemoRunner | null>(null);
  const preparedAudio = useRef<HTMLAudioElement | null>(null);
  const transport = useMemo(() => new OpenAIWebRTCTransport(), []);

  const communicator = useCommunicator({
    transport,
    onAnswerDraft: (draft) => dispatch({ type: "ANSWER_DRAFT_READY", draft }),
    onEvent: (event) => {
      if (event.type === "speech_started") dispatch({ type: "SPEECH_STARTED" });
      if (event.type === "speech_stopped") dispatch({ type: "SPEECH_STOPPED" });
    },
  });
  const disconnectCommunicator = communicator.disconnect;

  const playDemoPrompt = useCallback((src: string) => {
    preparedAudio.current?.pause();
    return playPreparedAudio(src, (value) => {
      const audio = new Audio(value);
      preparedAudio.current = audio;
      return audio;
    }).then((played) => setPreparedAudioUnavailable(!played));
  }, []);

  useEffect(() => {
    const restored = restoreCheckpoint(window.sessionStorage);
    if (restored) dispatch({ type: "RESTORE_CHECKPOINT", state: restored });
  }, []);

  useEffect(() => {
    if (state.revision > 0 || state.phase === "finalized") {
      saveCheckpoint(window.sessionStorage, state);
    }
  }, [state]);

  useEffect(() => {
    if (state.phase === "start") return;
    const update = () => {
      const remaining = Math.max(0, Date.parse(state.expiresAt) - Date.now());
      const minutes = Math.floor(remaining / 60_000);
      const seconds = Math.floor((remaining % 60_000) / 1_000);
      setRemainingLabel(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [state.expiresAt, state.phase]);

  useEffect(() => () => {
    disconnectCommunicator();
    preparedAudio.current?.pause();
  }, [disconnectCommunicator]);

  const beginLive = useCallback((textOnly: boolean) => {
    const next = createInitialState("live");
    next.phase = textOnly ? "presenting_prompt" : "connecting";
    dispatch({ type: "RESTORE_CHECKPOINT", state: next });
  }, []);

  const startLiveVoice = useCallback(async () => {
    if (!liveEnabled) return;
    const next = createInitialState("live");
    next.phase = "connecting";
    dispatch({ type: "RESTORE_CHECKPOINT", state: next });
    try {
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, sessionId: next.sessionId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const error = apiErrorSchema.safeParse(payload);
        throw new Error(error.success ? error.data.error.message : "Realtime Communicator is unavailable.");
      }
      const session = realtimeSessionResponseSchema.parse(payload);
      const connected = await communicator.connect({
        sessionId: next.sessionId,
        clientSecret: session.clientSecret,
        realtimeModel: session.configuration.realtimeModel,
      });
      if (!connected) throw new Error("Realtime Communicator is unavailable.");
      next.phase = "presenting_prompt";
      next.provenance = { source: "live_ai", brainModel: "gpt-5.6", realtimeModel: session.configuration.realtimeModel };
      dispatch({ type: "RESTORE_CHECKPOINT", state: next });
      communicator.presentPrompt(next.currentPrompt!.id, next.currentPrompt!.spokenQuestion);
    } catch (error) {
      dispatch({ type: "RECOVERABLE_ERROR", error: recoverable(error instanceof Error ? error.message : "Realtime Communicator is unavailable.", "REALTIME_UNAVAILABLE") });
    }
  }, [communicator, liveEnabled]);

  const startDemo = useCallback(() => {
    const runner = new PreparedDemoRunner();
    demoRunner.current = runner;
    const next = createInitialState("demo");
    next.phase = "presenting_prompt";
    next.currentPrompt = runner.currentPrompt;
    dispatch({ type: "RESTORE_CHECKPOINT", state: next });
    const firstAudio = runner.currentDecision?.audioSrc;
    if (firstAudio && !voiceMuted) void playDemoPrompt(firstAudio);
  }, [playDemoPrompt, voiceMuted]);

  const submitLive = useCallback(async (operation: "answer" | "defer" | "correct", turn: ConversationTurn) => {
    if (state.mode !== "live" || state.phase === "analyzing") return;
    const requestId = createId("REQ");
    const baseRevision = state.revision;
    lastBrainOperation.current = operation;
    dispatch({ type: "BRAIN_REQUESTED", requestId, turn });
    communicator.pauseForTextInput();
    try {
      const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          sessionId: state.sessionId,
          mode: "live",
          requestId,
          baseRevision,
          operation,
          turns: [...state.turns, turn],
          currentSpecification: state.specification,
          currentPrompt: state.currentPrompt,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(payload);
        if (parsedError.success) throw new Error(parsedError.data.error.message);
        throw new Error("The Brain could not validate a new revision.");
      }
      const parsed = brainResponseSchema.parse(payload);
      const before = new Map(Object.values(state.specification).flatMap((value) => Array.isArray(value) ? value.filter((item): item is SpecificationItem => Boolean(item && typeof item === "object" && "statement" in item)).map((item) => [item.id, item.statement] as const) : []));
      const changed = Object.values(parsed.output.specification).flatMap((value) => Array.isArray(value) ? value.filter((item): item is SpecificationItem => Boolean(item && typeof item === "object" && "statement" in item && before.get(item.id) !== item.statement)).map((item) => item.id) : []);
      setChangedItemIds(changed);
      dispatch({ type: "BRAIN_RESPONSE_RECEIVED", response: parsed });
      if (state.turns.length + 1 === 10) dispatch({ type: "ENTER_FINAL_REVIEW" });
      else if (parsed.output.nextPrompt && communicator.connectionState === "connected" && !voiceMuted) communicator.presentPrompt(parsed.output.nextPrompt.id, parsed.output.nextPrompt.spokenQuestion);
    } catch (error) {
      dispatch({ type: "RECOVERABLE_ERROR", error: recoverable(error instanceof Error ? error.message : "The Brain is unavailable.", "INVALID_MODEL_OUTPUT") });
    }
  }, [communicator, state, voiceMuted]);

  const submitWithoutNewTurn = useCallback(async (operation: "answer" | "defer" | "correct" | "resume") => {
    if (state.mode !== "live" || state.phase === "analyzing") return;
    const requestId = createId("REQ");
    lastBrainOperation.current = operation;
    dispatch({ type: operation === "resume" ? "BRAIN_RESUME_REQUESTED" : "BRAIN_RETRY_REQUESTED", requestId });
    try {
      const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, sessionId: state.sessionId, mode: "live", requestId, baseRevision: state.revision, operation, turns: state.turns, currentSpecification: state.specification, currentPrompt: state.currentPrompt }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error.message : "The Brain could not validate a new revision.");
      }
      const parsed = brainResponseSchema.parse(payload);
      dispatch({ type: "BRAIN_RESPONSE_RECEIVED", response: parsed });
      if (parsed.output.nextPrompt && communicator.connectionState === "connected" && !voiceMuted) communicator.presentPrompt(parsed.output.nextPrompt.id, parsed.output.nextPrompt.spokenQuestion);
    } catch (error) {
      dispatch({ type: "RECOVERABLE_ERROR", error: recoverable(error instanceof Error ? error.message : "The Brain is unavailable.", "INVALID_MODEL_OUTPUT") });
    }
  }, [communicator, state, voiceMuted]);

  const confirmDraft = useCallback(() => {
    if (!state.answerDraft?.text.trim()) return;
    const type = pendingOperation.current === "correct" ? "correction" : "confirmed_answer";
    const turn: ConversationTurn = { id: createId("TURN"), promptId: state.answerDraft.promptId, type, text: state.answerDraft.text.trim(), createdAt: new Date().toISOString() };
    void submitLive(pendingOperation.current, turn);
    pendingOperation.current = "answer";
  }, [state.answerDraft, submitLive]);

  const deferPrompt = useCallback((note: string) => {
    if (!state.currentPrompt) return;
    const turn: ConversationTurn = { id: createId("TURN"), promptId: state.currentPrompt.id, type: "deferred_prompt", text: note.trim() ? `Deferred by the Product Manager. Follow-up note: ${note.trim()}` : "Deferred by the Product Manager without an additional note.", createdAt: new Date().toISOString() };
    void submitLive("defer", turn);
  }, [state.currentPrompt, submitLive]);

  const usePreparedAnswer = useCallback(() => {
    const runner = demoRunner.current;
    if (!runner || runner.complete) return;
    const step = runner.advance(new Date().toISOString());
    dispatch({ type: "DEMO_REVISION_APPLIED", specification: step.specification, nextPrompt: step.nextPrompt, turn: step.turn });
    const nextAudio = runner.currentDecision?.audioSrc;
    if (nextAudio && !voiceMuted) void playDemoPrompt(nextAudio);
  }, [playDemoPrompt, voiceMuted]);

  const correctItem = useCallback((item: SpecificationItem) => {
    pendingOperation.current = "correct";
    dispatch({ type: "ANSWER_DRAFT_READY", draft: { text: `Correction for ${item.id}: `, source: "typed", promptId: state.currentPrompt?.id ?? null, transcriptionItemId: null } });
    communicator.pauseForTextInput();
  }, [communicator, state.currentPrompt?.id]);

  const updateNextActions = useCallback((actions: NextAction[]) => {
    dispatch({ type: "NEXT_ACTIONS_UPDATED", specification: { ...state.specification, nextActions: actions } });
  }, [state.specification]);

  const exitSession = useCallback(() => {
    communicator.disconnect();
    preparedAudio.current?.pause();
    clearCheckpoint(window.sessionStorage);
    dispatch({ type: "RESTORE_CHECKPOINT", state: createInitialState("live") });
  }, [communicator]);

  const resumeGrilling = useCallback(() => {
    if (state.currentPrompt) {
      dispatch({ type: "RESUME_GRILLING" });
      return;
    }
    if (state.mode === "live") {
      void submitWithoutNewTurn("resume");
      return;
    }
    const runner = new PreparedDemoRunner();
    demoRunner.current = runner;
    dispatch({ type: "RESTORE_CHECKPOINT", state: { ...state, phase: "presenting_prompt", revision: state.revision + 1, specification: emptySpecification, currentPrompt: runner.currentPrompt, lastFinalizedRevision: state.revision, finalizedSpecification: state.specification, pendingRequest: null, error: null } });
  }, [state, submitWithoutNewTurn]);

  const retryFromError = useCallback(() => {
    if (state.error?.code === "REALTIME_UNAVAILABLE") void startLiveVoice();
    else void submitWithoutNewTurn(lastBrainOperation.current);
  }, [startLiveVoice, state.error?.code, submitWithoutNewTurn]);

  if (state.phase === "start") {
    return <StartScreen liveEnabled={liveEnabled} liveUnavailableReason="Live AI is disabled or the server key is not configured." onEnableMicrophone={startLiveVoice} onStartLiveText={() => beginLive(true)} onStartPreparedDemo={startDemo} />;
  }

  if (state.phase === "final_review" || state.phase === "finalized") {
    return <FinalReview specification={state.specification} revision={state.revision} mode={state.mode} finalized={state.phase === "finalized"} brainModel={state.provenance.source === "live_ai" ? state.provenance.brainModel : null} realtimeModel={state.provenance.source === "live_ai" ? state.provenance.realtimeModel : null} onNextActionsChange={updateNextActions} onFinalize={() => dispatch({ type: "FINALIZE" })} onResume={resumeGrilling} onExit={exitSession} />;
  }

  return <InterviewRoom state={state} remainingLabel={remainingLabel} microphoneState={communicator.microphoneState} voiceMuted={voiceMuted} changedItemIds={changedItemIds} preparedAudioUnavailable={preparedAudioUnavailable} onToggleVoice={() => { const nextMuted = !voiceMuted; setVoiceMuted(nextMuted); if (nextMuted) { transport.stopPlayback(); preparedAudio.current?.pause(); } }} canResumeMicrophone={communicator.connectionState === "connected"} onResumeMicrophone={() => { communicator.resumeMicrophone(); dispatch({ type: "LISTENING_STARTED" }); }} onAnswerNow={state.mode === "live" && communicator.connectionState === "connected" ? () => { communicator.answerNow(); dispatch({ type: "LISTENING_STARTED" }); } : undefined} onComposerFocus={communicator.pauseForTextInput} onCreateDraft={(draft: AnswerDraft) => { pendingOperation.current = "answer"; communicator.pauseForTextInput(); dispatch({ type: "ANSWER_DRAFT_READY", draft }); }} onEditDraft={(text) => dispatch({ type: "ANSWER_DRAFT_EDITED", text })} onConfirmDraft={confirmDraft} onRecordAgain={() => { if (communicator.connectionState === "connected") { communicator.recordAgain(); dispatch({ type: "LISTENING_STARTED" }); } else dispatch({ type: "ANSWER_DRAFT_DISCARDED" }); }} onDefer={state.mode === "live" ? deferPrompt : undefined} onReviewSpecification={() => dispatch({ type: "ENTER_FINAL_REVIEW" })} onCorrectItem={correctItem} onUsePreparedAnswer={state.mode === "demo" ? usePreparedAnswer : undefined} onRetryError={state.mode === "live" && state.error?.retryable ? retryFromError : undefined} onRestartPreparedDemo={state.mode === "live" && state.error ? startDemo : undefined} />;
}
