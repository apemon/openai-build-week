"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createTextFallbackDecisionSummary } from "@/agents/communicator/text-clarification-fallback";
import { BrainClientError, createBrainRequest, postBrainRequest } from "@/app/brain-client";
import { selectRelevantSourceExcerpts } from "@/app/source-excerpts";
import {
  ContextIntake,
  ContextPreparationProgress,
  ProjectContextDigestReview,
  type ContextIntakeSubmission,
  type ContextPreparationStage,
} from "@/components/context";
import { FinalReview } from "@/components/final-review/FinalReview";
import { PendingWorkReview } from "@/components/final-review/PendingWorkReview";
import { InterviewRoom } from "@/components/interview/InterviewRoom";
import { StartScreen } from "@/components/start/StartScreen";
import { prepareContextLocally } from "@/context";
import { PreparedDemoRunner, playPreparedAudio, type DemoStep } from "@/demo/demo-runner";
import { preparedSampleDocument } from "@/demo/v2-prepared-context";
import { preparedActiveLookahead, PREPARED_STALE_REASON } from "@/demo/v2-prepared-flow";
import { createId } from "@/domain/ids";
import { createInitialState, emptySpecification } from "@/domain/initial-state";
import { apiErrorSchema, contextPreparationResponseSchema, realtimeSessionResponseSchema } from "@/domain/schemas";
import { sessionReducer } from "@/domain/session-reducer";
import type {
  AnswerDraft,
  BrainOperation,
  ClarificationTurn,
  ConversationTurn,
  DecisionSummary,
  NextAction,
  RecoverableError,
  SessionState,
  SpecificationItem,
  TemporaryContextExtraction,
} from "@/domain/types";
import { revalidateLookahead } from "@/domain/v2-invariants";
import { clearCheckpoint, restoreCheckpoint, saveCheckpoint } from "@/lib/session-checkpoint";
import { OpenAIWebRTCTransport } from "@/realtime/OpenAIWebRTCTransport";
import { useCommunicator } from "@/realtime/useCommunicator";

const initialState = createInitialState("live");
type ConfirmableOperation = "answer" | "correct";
type RetryableOperation = Exclude<BrainOperation, "decision_summary">;

function recoverable(message: string, code = "INTERNAL_ERROR", retryable = true): RecoverableError {
  return { code, message, retryable, returnPhase: "presenting_prompt" };
}

function changedSpecificationItems(beforeState: SessionState, after: SessionState["specification"]): string[] {
  const before = new Map(
    Object.values(beforeState.specification).flatMap((value) =>
      Array.isArray(value)
        ? value
          .filter((item): item is SpecificationItem => Boolean(item && typeof item === "object" && "statement" in item))
          .map((item) => [item.id, item.statement] as const)
        : [],
    ),
  );
  return Object.values(after).flatMap((value) =>
    Array.isArray(value)
      ? value
        .filter((item): item is SpecificationItem => Boolean(item && typeof item === "object" && "statement" in item && before.get(item.id) !== item.statement))
        .map((item) => item.id)
      : [],
  );
}

export function SpecGrillApp({ liveEnabled }: { liveEnabled: boolean }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const stateRef = useRef(state);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [preparedAudioUnavailable, setPreparedAudioUnavailable] = useState(false);
  const [changedItemIds, setChangedItemIds] = useState<string[]>([]);
  const [remainingLabel, setRemainingLabel] = useState("30:00");
  const [contextStage, setContextStage] = useState<ContextPreparationStage>("validating_input");
  const [contextSourceLabel, setContextSourceLabel] = useState<string | undefined>();
  const [contextInitialValues, setContextInitialValues] = useState<ContextIntakeSubmission | null>(null);
  const [showPendingReview, setShowPendingReview] = useState(false);
  const pendingOperation = useRef<ConfirmableOperation>("answer");
  const lastBrainOperation = useRef<RetryableOperation>("answer");
  const demoRunner = useRef<PreparedDemoRunner | null>(null);
  const pendingDemoStep = useRef<{ step: DemoStep; progress: Promise<void> } | null>(null);
  const preparedAudio = useRef<HTMLAudioElement | null>(null);
  const temporaryExtraction = useRef<TemporaryContextExtraction | null>(null);
  const lastContextInput = useRef<ContextIntakeSubmission | null>(null);
  const voiceRequested = useRef(false);
  const initializedSession = useRef<string | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const activeRequestAbort = useRef<AbortController | null>(null);
  const clarificationInputs = useRef<string[]>([]);
  const realtimeConnected = useRef(false);
  const transport = useMemo(() => new OpenAIWebRTCTransport(), []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const communicator = useCommunicator({
    transport,
    onAnswerDraft: (draft) => dispatch({ type: "ANSWER_DRAFT_READY", draft }),
    onClarificationTranscript: ({ text }) => {
      clarificationInputs.current.push(text);
      dispatch({
        type: "CLARIFICATION_TURN_ADDED",
        turn: { id: createId("CLARIFICATION"), role: "product_manager", text, createdAt: new Date().toISOString() },
      });
    },
    onEvent: (event) => {
      if (event.type === "connected") realtimeConnected.current = true;
      if (event.type === "disconnected" || event.type === "error") realtimeConnected.current = false;
      if (event.type === "speech_started") dispatch({ type: "SPEECH_STARTED" });
      if (event.type === "speech_stopped") dispatch({ type: "SPEECH_STOPPED" });
      if (event.type === "clarification_response_done") {
        dispatch({
          type: "CLARIFICATION_TURN_ADDED",
          turn: { id: createId("CLARIFICATION"), role: "communicator", text: event.text, createdAt: new Date().toISOString() },
        });
      }
      if (event.type === "decision_summary_ready") {
        const active = stateRef.current.activeLookahead;
        if (!active || active.approval.roadmapItemId !== event.roadmapItemId) return;
        dispatch({
          type: "DECISION_SUMMARY_READY",
          summary: {
            id: createId("SUMMARY"),
            roadmapItemId: event.roadmapItemId,
            text: event.text,
            uncertainties: event.uncertainties,
            status: "draft",
            approvedAtRevision: active.approval.approvedAtRevision,
            dependencyVersion: active.approval.dependencyVersion,
            confirmedAt: null,
            staleReason: null,
          },
        });
      }
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
    if (state.confirmedContextDigest || state.revision > 0 || state.phase === "finalized") {
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
    activeRequestAbort.current?.abort();
    disconnectCommunicator();
    preparedAudio.current?.pause();
  }, [disconnectCommunicator]);

  const enterContextIntake = useCallback((mode: "live" | "demo", wantsVoice: boolean) => {
    const next = createInitialState(mode);
    next.phase = "preparing_context";
    voiceRequested.current = wantsVoice;
    realtimeConnected.current = false;
    initializedSession.current = null;
    temporaryExtraction.current = null;
    lastContextInput.current = null;
    setContextInitialValues(null);
    pendingDemoStep.current = null;
    clarificationInputs.current = [];
    if (mode === "demo") demoRunner.current = new PreparedDemoRunner();
    dispatch({ type: "RESTORE_CHECKPOINT", state: next });
  }, []);

  const prepareContext = useCallback(async (input: ContextIntakeSubmission) => {
    const snapshot = stateRef.current;
    const requestId = createId("REQUEST");
    lastContextInput.current = input;
    setContextInitialValues(input);
    setContextSourceLabel(input.file?.name ?? (input.pastedContext.trim() ? "Pasted context" : "Initial Prompt"));
    setContextStage("validating_input");
    dispatch({ type: "CONTEXT_PREPARATION_STARTED", requestId });
    try {
      let response;
      if (snapshot.mode === "demo") {
        const runner = demoRunner.current ?? new PreparedDemoRunner();
        demoRunner.current = runner;
        await runner.runPreparationProgress((stage) => {
          setContextStage(stage === "validating_confirmed_input" ? "validating_input" : stage === "reviewing_contradictions" ? "extracting_text" : stage === "reviewing_dependencies" ? "building_digest" : "validating_digest");
        }, 90);
        response = {
          schemaVersion: 1 as const,
          requestId,
          digest: runner.contextPreparation.draftDigest!,
          temporaryExtraction: runner.contextPreparation.temporaryExtraction,
        };
      } else if (input.file && /\.(pdf|docx)$/i.test(input.file.name)) {
        setContextStage("extracting_text");
        const form = new FormData();
        form.set("schemaVersion", "1");
        form.set("sessionId", snapshot.sessionId);
        form.set("requestId", requestId);
        form.set("initialPrompt", input.initialPrompt);
        form.set("pastedContext", "");
        form.set("file", input.file);
        const result = await fetch("/api/context", { method: "POST", headers: { "X-Request-Id": requestId }, body: form });
        const payload: unknown = await result.json();
        if (!result.ok) {
          const parsed = apiErrorSchema.safeParse(payload);
          throw new Error(parsed.success ? parsed.data.error.message : "The document could not be prepared.");
        }
        setContextStage("building_digest");
        response = contextPreparationResponseSchema.parse(payload);
      } else {
        setContextStage("extracting_text");
        response = await prepareContextLocally({
          schemaVersion: 1,
          sessionId: snapshot.sessionId,
          requestId,
          initialPrompt: input.initialPrompt,
          pastedContext: input.pastedContext,
          file: input.file,
        });
      }
      setContextStage("validating_digest");
      const validated = contextPreparationResponseSchema.parse(response);
      temporaryExtraction.current = validated.temporaryExtraction;
      dispatch({
        type: "CONTEXT_PREPARATION_READY",
        preparation: {
          requestId,
          status: "ready",
          draftDigest: validated.digest,
          temporaryExtraction: validated.temporaryExtraction,
          warningAcknowledged: false,
        },
      });
    } catch (error) {
      temporaryExtraction.current = null;
      dispatch({ type: "CONTEXT_PREPARATION_FAILED" });
      throw error;
    }
  }, []);

  const connectRealtime = useCallback(async (snapshot: SessionState): Promise<void> => {
    if (!voiceRequested.current || !liveEnabled) return;
    const response = await fetch("/api/realtime/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, sessionId: snapshot.sessionId }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(payload);
      throw new Error(parsed.success ? parsed.data.error.message : "Realtime Communicator is unavailable.");
    }
    const session = realtimeSessionResponseSchema.parse(payload);
    const connected = await communicator.connect({
      sessionId: snapshot.sessionId,
      clientSecret: session.clientSecret,
      realtimeModel: session.configuration.realtimeModel,
    });
    if (!connected) throw new Error("Realtime Communicator is unavailable.");
    realtimeConnected.current = true;
    dispatch({ type: "REALTIME_MODEL_CONNECTED", model: session.configuration.realtimeModel });
  }, [communicator, liveEnabled]);

  const submitBrain = useCallback(async (
    snapshot: SessionState,
    operation: BrainOperation,
    turn?: ConversationTurn,
    retry = false,
  ) => {
    if (snapshot.mode !== "live" || activeRequestId.current) return;
    const requestId = createId("REQ");
    activeRequestId.current = requestId;
    const abortController = new AbortController();
    activeRequestAbort.current = abortController;
    if (operation !== "decision_summary") lastBrainOperation.current = operation as RetryableOperation;
    const excerpts = selectRelevantSourceExcerpts(
      temporaryExtraction.current,
      snapshot.questionRoadmap,
      snapshot.currentPrompt?.detailedQuestion ?? null,
    );
    try {
      const request = createBrainRequest(snapshot, requestId, operation, excerpts, turn);
      if (operation === "resume") dispatch({ type: "BRAIN_RESUME_REQUESTED", requestId, actionId: requestId });
      else if (retry) dispatch({ type: "BRAIN_RETRY_REQUESTED", requestId, actionId: requestId, operation });
      else dispatch({ type: "BRAIN_REQUESTED", requestId, actionId: requestId, operation, turn });
      dispatch({ type: "PROCESSING_STAGE_CHANGED", stage: "revising_specification" });
      const approval = snapshot.questionRoadmap.lookaheadApproval;
      if (approval && approval.independentOfOperation === operation && !snapshot.activeLookahead) {
        clarificationInputs.current = [];
        dispatch({ type: "LOOKAHEAD_STARTED", approval });
        communicator.beginClarification(approval);
      }
      communicator.pauseForTextInput();
      const response = await postBrainRequest(request, abortController.signal);
      setChangedItemIds(changedSpecificationItems(snapshot, response.output.specification));
      const activeAtResponse = stateRef.current.activeLookahead;
      const lookaheadWasValid = activeAtResponse
        ? revalidateLookahead(activeAtResponse, response.output.questionRoadmap).valid
        : false;
      dispatch({ type: "BRAIN_RESPONSE_RECEIVED", response });
      if (activeAtResponse && (!lookaheadWasValid || activeAtResponse.decisionSummary?.status === "submitted")) {
        communicator.stopClarification();
      }
      if (!lookaheadWasValid && response.output.nextPrompt && realtimeConnected.current && !voiceMuted) {
        communicator.presentPrompt(response.output.nextPrompt.id, response.output.nextPrompt.spokenQuestion);
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      const clientError = error instanceof BrainClientError ? error : null;
      dispatch({
        type: "RECOVERABLE_ERROR",
        error: recoverable(
          error instanceof Error ? error.message : "The Brain is unavailable.",
          clientError?.code ?? "INVALID_MODEL_OUTPUT",
          clientError?.retryable ?? true,
        ),
      });
    } finally {
      if (activeRequestId.current === requestId) activeRequestId.current = null;
      if (activeRequestAbort.current === abortController) activeRequestAbort.current = null;
    }
  }, [communicator, voiceMuted]);

  useEffect(() => {
    if (state.phase !== "connecting" || !state.confirmedContextDigest || state.revision !== 0 || state.pendingRequest) return;
    if (initializedSession.current === state.sessionId) return;
    initializedSession.current = state.sessionId;
    const initialize = async () => {
      if (state.mode === "demo") {
        const runner = demoRunner.current ?? new PreparedDemoRunner();
        demoRunner.current = runner;
        dispatch({ type: "DEMO_PROCESSING_STARTED", stage: "validating_confirmed_input" });
        await runner.runPreparationProgress((stage) => dispatch({ type: "DEMO_PROCESSING_STARTED", stage }), 90);
        const step = runner.advance(new Date().toISOString());
        dispatch({ type: "DEMO_REVISION_APPLIED", specification: step.specification, questionRoadmap: step.questionRoadmap, nextPrompt: step.nextPrompt, turn: step.turn });
        const nextAudio = runner.currentDecision?.audioSrc;
        if (nextAudio && !voiceMuted) void playDemoPrompt(nextAudio);
        return;
      }
      try {
        await connectRealtime(state);
        await submitBrain(state, "initialize");
      } catch (error) {
        dispatch({ type: "RECOVERABLE_ERROR", error: recoverable(error instanceof Error ? error.message : "Live initialization failed.", "REALTIME_UNAVAILABLE") });
      }
    };
    void initialize();
  }, [connectRealtime, playDemoPrompt, state, submitBrain, voiceMuted]);

  useEffect(() => {
    const summary = state.activeLookahead?.decisionSummary;
    if (state.mode !== "live" || state.phase !== "queued_decision_summary" || state.pendingRequest || summary?.status !== "confirmed_queued") return;
    const turn: ConversationTurn = {
      id: createId("TURN"),
      promptId: state.activeLookahead?.approval.prompt.id ?? null,
      type: "confirmed_decision_summary",
      text: summary.text,
      createdAt: summary.confirmedAt ?? new Date().toISOString(),
    };
    void submitBrain(state, "decision_summary", turn);
  }, [state, submitBrain]);

  const confirmContextDigest = useCallback(() => {
    const snapshot = stateRef.current;
    const digest = snapshot.contextPreparation?.draftDigest;
    if (!digest) return;
    dispatch({ type: "CONTEXT_DIGEST_CONFIRMED", digest: { ...digest, confirmedAt: new Date().toISOString() } });
  }, []);

  const confirmDraft = useCallback(() => {
    const snapshot = stateRef.current;
    if (!snapshot.answerDraft?.text.trim()) return;
    const operation = pendingOperation.current;
    const turn: ConversationTurn = {
      id: createId("TURN"),
      promptId: snapshot.answerDraft.promptId,
      type: operation === "correct" ? "correction" : "confirmed_answer",
      text: snapshot.answerDraft.text.trim(),
      createdAt: new Date().toISOString(),
    };
    void submitBrain(snapshot, operation, turn);
    pendingOperation.current = "answer";
  }, [submitBrain]);

  const deferPrompt = useCallback((note: string) => {
    const snapshot = stateRef.current;
    if (!snapshot.currentPrompt) return;
    const turn: ConversationTurn = {
      id: createId("TURN"),
      promptId: snapshot.currentPrompt.id,
      type: "deferred_prompt",
      text: note.trim() ? `Deferred by the Product Manager. Follow-up note: ${note.trim()}` : "Deferred by the Product Manager without an additional note.",
      createdAt: new Date().toISOString(),
    };
    void submitBrain(snapshot, "defer", turn);
  }, [submitBrain]);

  const usePreparedAnswer = useCallback(() => {
    const runner = demoRunner.current;
    if (!runner || runner.complete || pendingDemoStep.current) return;
    const step = runner.advance(new Date().toISOString());
    const progress = runner.runPreparationProgress((stage) => dispatch({ type: "DEMO_PROCESSING_STARTED", stage }), 180);
    dispatch({ type: "DEMO_PROCESSING_STARTED", stage: "validating_confirmed_input" });
    if (step.index === 1) {
      pendingDemoStep.current = { step, progress };
      dispatch({ type: "DEMO_LOOKAHEAD_PRESENTED", active: preparedActiveLookahead });
      return;
    }
    void progress.then(() => {
      dispatch({ type: "DEMO_REVISION_APPLIED", specification: step.specification, questionRoadmap: step.questionRoadmap, nextPrompt: step.nextPrompt, turn: step.turn });
      const nextAudio = runner.currentDecision?.audioSrc;
      if (nextAudio && !voiceMuted) void playDemoPrompt(nextAudio);
    });
  }, [playDemoPrompt, voiceMuted]);

  const clarifyLookahead = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    clarificationInputs.current.push(trimmed);
    const turn: ClarificationTurn = { id: createId("CLARIFICATION"), role: "product_manager", text: trimmed, createdAt: new Date().toISOString() };
    dispatch({ type: "CLARIFICATION_TURN_ADDED", turn });
    communicator.submitClarificationText(trimmed);
  }, [communicator]);

  const requestDecisionSummary = useCallback(() => {
    if (communicator.requestDecisionSummary()) return;
    const active = stateRef.current.activeLookahead;
    if (!active || clarificationInputs.current.length === 0) return;
    const fallback = createTextFallbackDecisionSummary(active.approval, clarificationInputs.current);
    const summary: DecisionSummary = {
      id: createId("SUMMARY"),
      roadmapItemId: fallback.roadmapItemId,
      text: fallback.text,
      uncertainties: fallback.uncertainties,
      status: "draft",
      approvedAtRevision: active.approval.approvedAtRevision,
      dependencyVersion: active.approval.dependencyVersion,
      confirmedAt: null,
      staleReason: null,
    };
    dispatch({ type: "DECISION_SUMMARY_READY", summary });
  }, [communicator]);

  const confirmDecisionSummary = useCallback(async () => {
    const snapshot = stateRef.current;
    if (!snapshot.activeLookahead?.decisionSummary) return;
    dispatch({ type: "DECISION_SUMMARY_CONFIRMED", confirmedAt: new Date().toISOString() });
    if (snapshot.mode === "demo" && pendingDemoStep.current) {
      const pending = pendingDemoStep.current;
      await pending.progress;
      dispatch({ type: "DEMO_REVISION_APPLIED", specification: pending.step.specification, questionRoadmap: pending.step.questionRoadmap, nextPrompt: pending.step.nextPrompt, turn: pending.step.turn });
      dispatch({ type: "LOOKAHEAD_QUARANTINED", reason: PREPARED_STALE_REASON });
      pendingDemoStep.current = null;
      const nextAudio = demoRunner.current?.currentDecision?.audioSrc;
      if (nextAudio && !voiceMuted) void playDemoPrompt(nextAudio);
    }
  }, [playDemoPrompt, voiceMuted]);

  const correctItem = useCallback((item: SpecificationItem) => {
    pendingOperation.current = "correct";
    const snapshot = stateRef.current;
    dispatch({ type: "ANSWER_DRAFT_READY", draft: { text: `Correction for ${item.id}: `, source: "typed", promptId: snapshot.currentPrompt?.id ?? null, transcriptionItemId: null } });
    communicator.pauseForTextInput();
  }, [communicator]);

  const updateNextActions = useCallback((actions: NextAction[]) => {
    const snapshot = stateRef.current;
    dispatch({ type: "NEXT_ACTIONS_UPDATED", specification: { ...snapshot.specification, nextActions: actions } });
  }, []);

  const exitSession = useCallback(() => {
    activeRequestAbort.current?.abort();
    activeRequestId.current = null;
    temporaryExtraction.current = null;
    communicator.disconnect();
    realtimeConnected.current = false;
    preparedAudio.current?.pause();
    clearCheckpoint(window.sessionStorage);
    dispatch({ type: "RESTORE_CHECKPOINT", state: createInitialState("live") });
  }, [communicator]);

  const resumeGrilling = useCallback(() => {
    const snapshot = stateRef.current;
    if (snapshot.mode === "demo" && snapshot.currentPrompt) {
      const runner = new PreparedDemoRunner();
      for (let revision = 0; revision < snapshot.revision && !runner.complete; revision += 1) runner.advance();
      demoRunner.current = runner;
      pendingDemoStep.current = null;
      dispatch({ type: "RESUME_GRILLING" });
      return;
    }
    if (snapshot.currentPrompt) {
      dispatch({ type: "RESUME_GRILLING" });
      return;
    }
    if (snapshot.mode === "live") {
      void submitBrain(snapshot, "resume");
      return;
    }
    const runner = new PreparedDemoRunner();
    demoRunner.current = runner;
    dispatch({ type: "RESTORE_CHECKPOINT", state: { ...snapshot, phase: "presenting_prompt", revision: snapshot.revision + 1, specification: emptySpecification, currentPrompt: runner.currentPrompt, lastFinalizedRevision: snapshot.revision, finalizedSpecification: snapshot.specification, pendingRequest: null, error: null } });
  }, [submitBrain]);

  const retryFromError = useCallback(() => {
    const snapshot = stateRef.current;
    if (!snapshot.error?.retryable) return;
    if (snapshot.revision === 0 && snapshot.confirmedContextDigest) {
      initializedSession.current = null;
      dispatch({ type: "SET_PHASE", phase: "connecting" });
      return;
    }
    void submitBrain(snapshot, lastBrainOperation.current, undefined, true);
  }, [submitBrain]);

  const reviewSpecification = useCallback(() => {
    const snapshot = stateRef.current;
    if (snapshot.pendingRequest || snapshot.activeLookahead) setShowPendingReview(true);
    else dispatch({ type: "ENTER_FINAL_REVIEW" });
  }, []);

  if (state.phase === "start") {
    return <StartScreen liveEnabled={liveEnabled} liveUnavailableReason="Live AI is disabled or the server key is not configured." onEnableMicrophone={() => enterContextIntake("live", true)} onStartLiveText={() => enterContextIntake("live", false)} onStartPreparedDemo={() => enterContextIntake("demo", false)} />;
  }

  if (state.phase === "preparing_context") {
    if (state.contextPreparation?.status === "extracting") return <ContextPreparationProgress stage={contextStage} mode={state.mode} sourceLabel={contextSourceLabel} />;
    return <ContextIntake mode={state.mode} initialValues={contextInitialValues ?? undefined} preparedSample={state.mode === "demo" ? preparedSampleDocument : undefined} onPrepare={prepareContext} />;
  }

  if (state.phase === "reviewing_context" && state.contextPreparation?.draftDigest) {
    return <ProjectContextDigestReview digest={state.contextPreparation.draftDigest} warningAcknowledged={state.contextPreparation.warningAcknowledged} mode={state.mode} onDigestChange={(digest) => dispatch({ type: "CONTEXT_DIGEST_EDITED", digest })} onWarningAcknowledged={(acknowledged) => dispatch({ type: "CONTEXT_WARNING_ACKNOWLEDGED", acknowledged })} onConfirm={confirmContextDigest} onRetry={() => { dispatch({ type: "CONTEXT_PREPARATION_FAILED" }); }} onReplace={() => { dispatch({ type: "CONTEXT_PREPARATION_FAILED" }); }} onRemove={() => { const previous = lastContextInput.current; if (previous) void prepareContext({ ...previous, pastedContext: "", file: null, preparedSampleId: null }); }} />;
  }

  if (state.phase === "connecting") {
    return <ContextPreparationProgress stage="validating_digest" mode={state.mode} sourceLabel="Confirmed Project Context Digest" />;
  }

  if (showPendingReview) {
    return <PendingWorkReview pendingRequest={state.pendingRequest} activeLookahead={state.activeLookahead} staleSummaries={state.staleDecisionSummaries} onKeepWorking={() => setShowPendingReview(false)} onAbandonAndReview={(reason) => { activeRequestAbort.current?.abort(); pendingDemoStep.current = null; communicator.stopClarification(); dispatch({ type: "ABANDON_PENDING_AND_ENTER_FINAL_REVIEW", reason }); setShowPendingReview(false); }} />;
  }

  if (state.phase === "final_review" || state.phase === "finalized") {
    return <FinalReview specification={state.specification} revision={state.revision} mode={state.mode} finalized={state.phase === "finalized"} brainModel={state.provenance.source === "live_ai" ? state.provenance.brainModel : null} realtimeModel={state.provenance.source === "live_ai" ? state.provenance.realtimeModel : null} staleDecisionSummaries={state.staleDecisionSummaries} onNextActionsChange={updateNextActions} onFinalize={() => dispatch({ type: "FINALIZE" })} onResume={resumeGrilling} onExit={exitSession} />;
  }

  const currentTopic = state.questionRoadmap.items.find((item) => item.id === state.questionRoadmap.currentDecisionItemId)?.topic ?? null;
  return <InterviewRoom state={state} remainingLabel={remainingLabel} microphoneState={communicator.microphoneState} voiceMuted={voiceMuted} changedItemIds={changedItemIds} preparedAudioUnavailable={preparedAudioUnavailable} activeLookahead={state.activeLookahead} processingTopic={currentTopic} staleReason={state.staleLookaheadReason} staleDecisionSummaries={state.staleDecisionSummaries} onToggleVoice={() => { const nextMuted = !voiceMuted; setVoiceMuted(nextMuted); if (nextMuted) { transport.stopPlayback(); preparedAudio.current?.pause(); } }} canResumeMicrophone={communicator.connectionState === "connected"} onResumeMicrophone={() => { communicator.resumeMicrophone(); dispatch({ type: "LISTENING_STARTED" }); }} onAnswerNow={state.mode === "live" && communicator.connectionState === "connected" ? () => { communicator.answerNow(); dispatch({ type: "LISTENING_STARTED" }); } : undefined} onComposerFocus={communicator.pauseForTextInput} onCreateDraft={(draft: AnswerDraft) => { pendingOperation.current = "answer"; communicator.pauseForTextInput(); dispatch({ type: "ANSWER_DRAFT_READY", draft }); }} onEditDraft={(text) => dispatch({ type: "ANSWER_DRAFT_EDITED", text })} onConfirmDraft={confirmDraft} onRecordAgain={() => { if (communicator.connectionState === "connected") { communicator.recordAgain(); dispatch({ type: "LISTENING_STARTED" }); } else dispatch({ type: "ANSWER_DRAFT_DISCARDED" }); }} onDefer={state.mode === "live" ? deferPrompt : undefined} onReviewSpecification={reviewSpecification} onCorrectItem={correctItem} onUsePreparedAnswer={state.mode === "demo" ? usePreparedAnswer : undefined} onClarification={clarifyLookahead} onRequestDecisionSummary={requestDecisionSummary} onDecisionSummaryChange={(text) => dispatch({ type: "DECISION_SUMMARY_EDITED", text })} onConfirmDecisionSummary={confirmDecisionSummary} onReuseStaleSummary={(text) => { if (!state.currentPrompt) return; pendingOperation.current = "answer"; dispatch({ type: "ANSWER_DRAFT_READY", draft: { text, source: "typed", promptId: state.currentPrompt.id, transcriptionItemId: null } }); }} onRetryError={state.mode === "live" && state.error?.retryable ? retryFromError : undefined} onRestartPreparedDemo={state.mode === "live" && state.error ? () => enterContextIntake("demo", false) : undefined} />;
}
