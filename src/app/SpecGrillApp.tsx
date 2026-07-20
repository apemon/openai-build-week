"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createTextFallbackDecisionSummary } from "@/agents/communicator/text-clarification-fallback";
import { BrainClientError, BrainStreamInterruptedError, createV3BrainRequest, postV3BrainRequest } from "@/app/brain-client";
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
import { DecisionTray, InterviewWindowQuestion, PersistentBrainStatus, TextComposer } from "@/components/interview";
import { StartScreen } from "@/components/start/StartScreen";
import { prepareContextLocally } from "@/context";
import { PreparedDemoRunner, playPreparedAudio, type DemoStep } from "@/demo/demo-runner";
import { preparedSampleDocument } from "@/demo/v2-prepared-context";
import { preparedActiveLookahead, PREPARED_STALE_REASON } from "@/demo/v2-prepared-flow";
import { PREPARED_V3_ACTION_STARTED_AT, PreparedV3DemoRunner, type PreparedV3Frame } from "@/demo/v3-prepared-flow";
import { createId } from "@/domain/ids";
import { createInitialState, emptySpecification } from "@/domain/initial-state";
import { apiErrorSchema, brainResponseSchema, contextPreparationResponseSchema, realtimeSessionResponseSchema } from "@/domain/schemas";
import { sessionReducer } from "@/domain/session-reducer";
import type {
  AnswerDraft,
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
import { orderDecisionBatchEntries } from "@/domain/v3-invariants";
import { createDecisionBatchEntries, createInitialV3RuntimeState, createRestoredAsyncEntries, v3RuntimeReducer } from "@/domain/v3-runtime";
import { interviewJobSchema, type DecisionBatch, type ExchangeIdentity, type InterviewJob, type RestoredAsyncEntry, type V3BrainOperation } from "@/domain/v3-schemas";
import { clearCheckpoint, restoreV3Checkpoint, saveV3Checkpoint } from "@/lib/session-checkpoint";
import { OpenAIWebRTCTransport } from "@/realtime/OpenAIWebRTCTransport";
import { useCommunicator } from "@/realtime/useCommunicator";
import { useV3Communicator } from "@/realtime/useV3Communicator";

const initialState = createInitialState("live");
type ConfirmableOperation = "answer" | "correct";
type RetryableOperation = "initialize" | "answer" | "defer" | "correct" | "resume";

function recoverable(message: string, code = "INTERNAL_ERROR", retryable = true): RecoverableError {
  return { code, message, retryable, returnPhase: "presenting_prompt" };
}

function identityForJob(job: InterviewJob, cancelEpoch: number): ExchangeIdentity {
  return { kind: "permitted", exchangeId: job.exchangeId, promptId: job.permit.prompt.id, permitId: job.permit.id, cancelEpoch };
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
  const [v3Runtime, dispatchV3] = useReducer(v3RuntimeReducer, undefined, () => createInitialV3RuntimeState());
  const stateRef = useRef(state);
  const v3RuntimeRef = useRef(v3Runtime);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [preparedAudioUnavailable, setPreparedAudioUnavailable] = useState(false);
  const [changedItemIds, setChangedItemIds] = useState<string[]>([]);
  const [remainingLabel, setRemainingLabel] = useState("30:00");
  const [contextStage, setContextStage] = useState<ContextPreparationStage>("validating_input");
  const [contextSourceLabel, setContextSourceLabel] = useState<string | undefined>();
  const [contextInitialValues, setContextInitialValues] = useState<ContextIntakeSubmission | null>(null);
  const [showPendingReview, setShowPendingReview] = useState(false);
  const [preparedV3NowMs, setPreparedV3NowMs] = useState<number | undefined>();
  const [preparedV3FrameLabel, setPreparedV3FrameLabel] = useState<string | null>(null);
  const [preparedV3Complete, setPreparedV3Complete] = useState(false);
  const pendingOperation = useRef<ConfirmableOperation>("answer");
  const lastBrainOperation = useRef<RetryableOperation>("answer");
  const demoRunner = useRef<PreparedDemoRunner | null>(null);
  const v3DemoRunner = useRef<PreparedV3DemoRunner | null>(null);
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

  useEffect(() => {
    v3RuntimeRef.current = v3Runtime;
  }, [v3Runtime]);

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
  const v3Communicator = useV3Communicator({
    transport,
    onEvent: (event) => {
      const runtime = v3RuntimeRef.current;
      const active = runtime.jobs.find((job) => job.id === runtime.activeJobId);
      if (!active || event.identity.exchangeId !== active.exchangeId || event.identity.permitId !== active.permit.id) return;
      if (event.type === "clarification_response_done") {
        dispatchV3({
          type: "V3_JOB_UPDATED",
          job: { ...active, status: "clarifying", clarificationTurns: [...active.clarificationTurns, { id: createId("CLARIFICATION"), role: "communicator", text: event.text, createdAt: new Date().toISOString() }] },
        });
      }
      if (event.type === "decision_summary_ready") {
        dispatchV3({
          type: "V3_JOB_UPDATED",
          job: { ...active, status: "summary_draft", decisionSummary: { id: createId("SUMMARY"), roadmapItemId: active.permit.roadmapItemId, text: event.text, uncertainties: event.uncertainties } },
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
    const restored = restoreV3Checkpoint(window.sessionStorage);
    if (restored) {
      dispatch({ type: "RESTORE_CHECKPOINT", state: restored.state });
      dispatchV3({ type: "V3_CHECKPOINT_RESTORED", entries: restored.confirmedQueuedEntries, adaptiveWindow: restored.adaptiveWindow });
    }
  }, []);

  useEffect(() => {
    if (state.confirmedContextDigest || state.revision > 0 || state.phase === "finalized") {
      saveV3Checkpoint(window.sessionStorage, state, createRestoredAsyncEntries(v3Runtime.jobs), v3Runtime.adaptiveWindow);
    }
  }, [state, v3Runtime.adaptiveWindow, v3Runtime.jobs]);

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
    setPreparedV3NowMs(undefined);
    setPreparedV3FrameLabel(null);
    setPreparedV3Complete(false);
    clarificationInputs.current = [];
    if (mode === "demo") demoRunner.current = new PreparedDemoRunner();
    v3DemoRunner.current = mode === "demo" ? new PreparedV3DemoRunner() : null;
    setPreparedV3FrameLabel(v3DemoRunner.current?.current.label ?? null);
    dispatchV3({ type: "V3_RUNTIME_RESET" });
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
    operation: V3BrainOperation,
    turn?: ConversationTurn,
    retry = false,
    decisionBatch: DecisionBatch | null = null,
    restoredEntriesForRevalidation: RestoredAsyncEntry[] = [],
  ) => {
    if (snapshot.mode !== "live" || activeRequestId.current) return;
    const requestId = createId("REQ");
    const actionId = decisionBatch?.actionId ?? createId("ACTION");
    const runtime = v3RuntimeRef.current;
    const cancelEpoch = runtime.cancelEpoch + 1;
    activeRequestId.current = requestId;
    const abortController = new AbortController();
    activeRequestAbort.current = abortController;
    if (["initialize", "answer", "defer", "correct", "resume"].includes(operation)) lastBrainOperation.current = operation as RetryableOperation;
    const excerpts = selectRelevantSourceExcerpts(
      temporaryExtraction.current,
      snapshot.questionRoadmap,
      snapshot.currentPrompt?.detailedQuestion ?? null,
    );
    try {
      const request = createV3BrainRequest(snapshot, requestId, operation, excerpts, {
        actionId,
        cancelEpoch,
        requestedApplicationCap: runtime.adaptiveWindow.applicationCap,
        priorInterviewWindow: runtime.interviewWindow,
        restoredEntriesForRevalidation,
        decisionBatch,
        turn,
      });
      dispatchV3({ type: "V3_BRAIN_ACTION_ACCEPTED", requestId, actionId, operation, cancelEpoch, acceptedAt: new Date().toISOString() });
      if (operation === "resume") dispatch({ type: "BRAIN_RESUME_REQUESTED", requestId, actionId });
      else if (retry) dispatch({ type: "BRAIN_RETRY_REQUESTED", requestId, actionId, operation });
      else dispatch({ type: "BRAIN_REQUESTED", requestId, actionId, operation, turn });
      const usedPermitIds = new Set(runtime.jobs.map((job) => job.permit.id));
      const nextPermit = runtime.interviewWindow?.independentOfOperation === operation
        ? runtime.interviewWindow.permits.find((permit) => !usedPermitIds.has(permit.id))
        : null;
      if (nextPermit && !runtime.activeJobId && !runtime.questionsPaused) {
        const job = interviewJobSchema.parse({
          id: createId("JOB"),
          exchangeId: createId("EXCHANGE"),
          permit: nextPermit,
          status: "approved",
          clarificationTurns: [],
          decisionSummary: null,
          deferral: null,
          confirmedAt: null,
          revalidatedAtRevision: null,
          revalidatedDependencyVersion: null,
          notAppliedReason: null,
          notAppliedExplanation: null,
        });
        const identity = identityForJob(job, cancelEpoch);
        dispatchV3({ type: "V3_PERMIT_PRESENTED", permit: nextPermit, identity, job });
        if (realtimeConnected.current) {
          try {
            v3Communicator.beginExchange(nextPermit, identity);
          } catch {
            // The visible text path remains active when Realtime cannot present the permit.
          }
        }
      }
      dispatch({ type: "PROCESSING_STAGE_CHANGED", stage: "revising_specification" });
      const approval = snapshot.questionRoadmap.lookaheadApproval;
      if (approval && approval.independentOfOperation === operation && !snapshot.activeLookahead) {
        clarificationInputs.current = [];
        dispatch({ type: "LOOKAHEAD_STARTED", approval });
        communicator.beginClarification(approval);
      }
      communicator.pauseForTextInput();
      const response = await postV3BrainRequest(request, (event) => dispatchV3({ type: "V3_BRAIN_LIFECYCLE_RECEIVED", event }), abortController.signal);
      if (runtime.activeJobId) {
        v3Communicator.handleRevisionBarrier(cancelEpoch);
        dispatchV3({ type: "V3_QUESTIONS_PAUSED", nextCancelEpoch: cancelEpoch });
      }
      setChangedItemIds(changedSpecificationItems(snapshot, response.output.specification));
      const activeAtResponse = stateRef.current.activeLookahead;
      const lookaheadWasValid = activeAtResponse
        ? revalidateLookahead(activeAtResponse, response.output.questionRoadmap).valid
        : false;
      if (operation !== "revalidate_restored") {
        const batchTurns: ConversationTurn[] | undefined = decisionBatch?.entries.map((entry) => ({
          id: entry.confirmedTurnId,
          promptId: runtime.jobs.find((job) => job.id === entry.jobId)?.permit.prompt.id ?? null,
          type: entry.kind === "decision_summary" ? "confirmed_decision_summary" : "deferred_prompt",
          text: entry.kind === "decision_summary"
            ? entry.text
            : entry.note?.trim()
              ? `Deferred with note: ${entry.note.trim()}`
              : "Deferred without additional context.",
          createdAt: entry.confirmedAt,
        }));
        dispatch({ type: "BRAIN_RESPONSE_RECEIVED", response: brainResponseSchema.parse(response), batchTurns });
      } else dispatch({ type: "BRAIN_NONMUTATING_RESPONSE_RECEIVED", requestId, baseRevision: response.baseRevision });
      dispatchV3({ type: "V3_BRAIN_RESPONSE_RECEIVED", response });
      if (activeAtResponse && (!lookaheadWasValid || activeAtResponse.decisionSummary?.status === "submitted")) {
        communicator.stopClarification();
      }
      if (!lookaheadWasValid && response.output.nextPrompt && realtimeConnected.current && !voiceMuted) {
        communicator.presentPrompt(response.output.nextPrompt.id, response.output.nextPrompt.spokenQuestion);
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      if (error instanceof BrainStreamInterruptedError) {
        dispatchV3({ type: "V3_BRAIN_STREAM_INTERRUPTED", requestId, actionId, cancelEpoch, observedAt: new Date().toISOString() });
      }
      if (decisionBatch) {
        const batchJobIds = new Set(decisionBatch.entries.map((entry) => entry.jobId));
        for (const job of runtime.jobs) {
          if (batchJobIds.has(job.id)) dispatchV3({ type: "V3_JOB_UPDATED", job: { ...job, status: "apply_failed" } });
        }
      }
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
  }, [communicator, v3Communicator, voiceMuted]);

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

  useEffect(() => {
    if (state.mode !== "live" || state.pendingRequest || activeRequestId.current || v3Runtime.lockedDecisionBatch || v3Runtime.restoredEntries.length > 0) return;
    const entries = orderDecisionBatchEntries(createDecisionBatchEntries(v3Runtime.jobs));
    if (entries.length === 0) return;
    const timestamp = new Date().toISOString();
    const batch: DecisionBatch = {
      id: createId("BATCH"),
      actionId: createId("ACTION"),
      baseRevision: state.revision,
      dependencyVersion: state.questionRoadmap.dependencyVersion,
      createdAt: timestamp,
      lockedAt: timestamp,
      entries,
    };
    dispatchV3({ type: "V3_DECISION_BATCH_LOCKED", batch });
    void submitBrain(state, "decision_batch", undefined, false, batch);
  }, [state, submitBrain, v3Runtime.jobs, v3Runtime.lockedDecisionBatch, v3Runtime.restoredEntries.length]);

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

  const applyPreparedV3Frame = useCallback((frame: PreparedV3Frame) => {
    const snapshot = stateRef.current;
    const final = frame.stage === "final_review" || frame.stage === "export_ready";
    const revision = frame.stage === "batch_revision_applied"
      ? 3
      : final
        ? 8
        : ["authoritative_revision_applied", "jobs_revalidated", "batch_auto_submitted"].includes(frame.stage)
          ? 2
          : Math.max(1, snapshot.revision);
    dispatchV3({
      type: "V3_DEMO_FRAME_LOADED",
      interviewWindow: frame.interviewWindow,
      jobs: [...frame.jobs],
      activeJobId: frame.activeJobId,
      lockedBatch: frame.lockedBatch,
      activity: {
        state: frame.activityState,
        acceptedAt: frame.activityState === "working" || frame.activityState === "taking_longer"
          ? frame.stage === "batch_auto_submitted"
            ? new Date(Date.parse(PREPARED_V3_ACTION_STARTED_AT) + frame.elapsedMs).toISOString()
            : PREPARED_V3_ACTION_STARTED_AT
          : null,
        lastLifecycleAt: frame.lastLifecycleAt,
      },
    });
    setPreparedV3NowMs(Date.parse(PREPARED_V3_ACTION_STARTED_AT) + frame.elapsedMs);
    setPreparedV3FrameLabel(frame.label);
    setPreparedV3Complete(frame.stage === "export_ready");
    dispatch({
      type: "RESTORE_CHECKPOINT",
      state: {
        ...snapshot,
        phase: final ? "final_review" : frame.activityState === "working" || frame.activityState === "taking_longer" ? "analyzing" : "presenting_prompt",
        revision,
        specification: frame.specification,
        processingStage: frame.activityState === "working" || frame.activityState === "taking_longer" ? "revising_specification" : "idle",
        pendingRequest: null,
        error: null,
      },
    });
  }, []);

  const advancePreparedDemo = useCallback(() => {
    const v3Runner = v3DemoRunner.current;
    if (v3Runner && !v3Runner.complete) {
      const frame = v3Runner.advance();
      applyPreparedV3Frame(frame);
      return;
    }
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
  }, [applyPreparedV3Frame, playDemoPrompt, voiceMuted]);

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

  const clarifyPermittedDecision = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const runtime = v3RuntimeRef.current;
    const job = runtime.jobs.find((candidate) => candidate.id === runtime.activeJobId);
    if (!job || !["presenting", "clarifying"].includes(job.status)) return;
    const turn: ClarificationTurn = { id: createId("CLARIFICATION"), role: "product_manager", text: trimmed, createdAt: new Date().toISOString() };
    dispatchV3({ type: "V3_JOB_UPDATED", job: { ...job, status: "clarifying", clarificationTurns: [...job.clarificationTurns, turn] } });
    if (realtimeConnected.current) {
      try {
        transport.submitPermittedClarification(trimmed, identityForJob(job, runtime.cancelEpoch));
      } catch {
        // The text remains locally reviewable and non-authoritative.
      }
    }
  }, [transport]);

  const createPermittedSummary = useCallback(() => {
    const runtime = v3RuntimeRef.current;
    const job = runtime.jobs.find((candidate) => candidate.id === runtime.activeJobId);
    if (!job) return;
    if (realtimeConnected.current && v3Communicator.requestSummary()) return;
    const latest = [...job.clarificationTurns].reverse().find((turn) => turn.role === "product_manager")?.text;
    if (!latest) return;
    dispatchV3({ type: "V3_JOB_UPDATED", job: { ...job, status: "summary_draft", decisionSummary: { id: createId("SUMMARY"), roadmapItemId: job.permit.roadmapItemId, text: latest, uncertainties: [] } } });
  }, [v3Communicator]);

  const updatePermittedSummary = useCallback((jobId: string, text: string) => {
    const runtime = v3RuntimeRef.current;
    const job = runtime.jobs.find((candidate) => candidate.id === jobId);
    if (!job?.decisionSummary || job.status !== "summary_draft") return;
    const bounded = text.slice(0, 4_000);
    v3Communicator.updateSummaryDraft(bounded);
    dispatchV3({ type: "V3_JOB_UPDATED", job: { ...job, decisionSummary: { ...job.decisionSummary, text: bounded } } });
  }, [v3Communicator]);

  const deferPermittedDecision = useCallback((jobId: string, note: string | null) => {
    const job = v3RuntimeRef.current.jobs.find((candidate) => candidate.id === jobId);
    if (!job || !["presenting", "clarifying", "summary_draft", "paused"].includes(job.status)) return;
    dispatchV3({ type: "V3_JOB_UPDATED", job: { ...job, status: "summary_draft", decisionSummary: null, deferral: { id: createId("DEFERRAL"), note } } });
    dispatchV3({ type: "V3_JOB_CONFIRMED", jobId, confirmedAt: new Date().toISOString() });
  }, []);

  const pausePermittedQuestions = useCallback(() => {
    const runtime = v3RuntimeRef.current;
    const nextCancelEpoch = runtime.cancelEpoch + 1;
    v3Communicator.pause(nextCancelEpoch);
    dispatchV3({ type: "V3_QUESTIONS_PAUSED", nextCancelEpoch });
  }, [v3Communicator]);

  const resumePermittedQuestions = useCallback(() => {
    const runtime = v3RuntimeRef.current;
    const job = runtime.jobs.find((candidate) => candidate.id === runtime.activeJobId);
    if (!job || job.status !== "revalidation_pending" || job.revalidatedAtRevision === null) return;
    const identity = identityForJob(job, runtime.cancelEpoch);
    v3Communicator.resumeAfterRevalidation(job.permit, identity);
    dispatchV3({ type: "V3_QUESTIONS_RESUMED", permit: job.permit, identity });
  }, [v3Communicator]);

  const revalidateRestoredDecisions = useCallback(() => {
    const runtime = v3RuntimeRef.current;
    if (runtime.restoredEntries.length === 0 || runtime.restoredRevalidationCompleted || activeRequestId.current) return;
    void submitBrain(stateRef.current, "revalidate_restored", undefined, false, null, runtime.restoredEntries);
  }, [submitBrain]);

  const submitRestoredDecisions = useCallback(() => {
    const runtime = v3RuntimeRef.current;
    if (!runtime.restoredRevalidationCompleted || runtime.lockedDecisionBatch || activeRequestId.current) return;
    const entries = orderDecisionBatchEntries(createDecisionBatchEntries(runtime.jobs));
    if (entries.length === 0) return;
    const timestamp = new Date().toISOString();
    const batch: DecisionBatch = {
      id: createId("BATCH"),
      actionId: createId("ACTION"),
      baseRevision: stateRef.current.revision,
      dependencyVersion: stateRef.current.questionRoadmap.dependencyVersion,
      createdAt: timestamp,
      lockedAt: timestamp,
      entries,
    };
    dispatchV3({ type: "V3_RESTORED_SUBMISSION_REQUESTED", batch });
    void submitBrain(stateRef.current, "decision_batch", undefined, false, batch);
  }, [submitBrain]);

  const reviewSpecification = useCallback(() => {
    const snapshot = stateRef.current;
    if (snapshot.pendingRequest || snapshot.activeLookahead || v3RuntimeRef.current.restoredEntries.length > 0 || v3RuntimeRef.current.jobs.some((job) => !["applied", "not_applied"].includes(job.status))) setShowPendingReview(true);
    else dispatch({ type: "ENTER_FINAL_REVIEW" });
  }, []);

  const activeV3Job = v3Runtime.jobs.find((job) => job.id === v3Runtime.activeJobId) ?? null;
  const futurePermitTopics = (v3Runtime.interviewWindow?.permits ?? [])
    .filter((permit) => permit.id !== activeV3Job?.permit.id && !v3Runtime.jobs.some((job) => job.permit.id === permit.id))
    .map((permit) => ({
      permitId: permit.id,
      topic: state.questionRoadmap.items.find((item) => item.id === permit.roadmapItemId)?.topic ?? permit.prompt.decisionKey,
    }));
  const persistentBrainStatus = v3Runtime.brainActivity.state === "idle" ? null : (
    <PersistentBrainStatus
      activity={{
        state: v3Runtime.brainActivity.state,
        actionId: v3Runtime.brainActivity.actionId,
        acceptedAt: v3Runtime.brainActivity.acceptedAt,
        lastLifecycleAt: v3Runtime.brainActivity.lastLifecycleAt,
        lastSequence: v3Runtime.brainActivity.lastSequence,
      }}
      mode={state.mode}
      nowMs={preparedV3NowMs}
      sticky={false}
      onRetry={state.mode === "live" && state.error?.retryable ? retryFromError : undefined}
    />
  );
  const restoredControls = v3Runtime.restoredEntries.length === 0 ? null : (
    <section aria-labelledby="restored-decisions-title" className="rounded-2xl border border-amber-700 bg-amber-950/20 p-4">
      <h2 id="restored-decisions-title" className="text-lg font-semibold">Restored decisions require fresh authorization</h2>
      <p className="mt-1 text-sm text-stone-300">Nothing restored from this browser session will be sent automatically.</p>
      {v3Runtime.restoredInvalidationReasons.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-800 p-3 text-sm">
          <p className="font-semibold">Not Applied after dependency checking</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{v3Runtime.restoredInvalidationReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!v3Runtime.restoredRevalidationCompleted && <button type="button" disabled={Boolean(state.pendingRequest)} onClick={revalidateRestoredDecisions} className="min-h-11 rounded-xl bg-amber-200 px-4 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">Revalidate restored decisions</button>}
        {v3Runtime.restoredRevalidationCompleted && v3Runtime.jobs.some((job) => job.status === "ready_to_apply") && <button type="button" disabled={Boolean(state.pendingRequest)} onClick={submitRestoredDecisions} className="min-h-11 rounded-xl bg-violet-300 px-4 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">Submit restored decisions</button>}
        {v3Runtime.restoredRevalidationCompleted && <button type="button" disabled={Boolean(state.pendingRequest)} onClick={() => dispatchV3({ type: "V3_RESTORED_ENTRIES_DISCARDED" })} className="min-h-11 rounded-xl border border-stone-600 px-4 font-semibold">Discard restored decisions</button>}
      </div>
    </section>
  );
  const tray = v3Runtime.jobs.length === 0 ? null : (
    <DecisionTray
      jobs={v3Runtime.jobs}
      activeJobId={v3Runtime.activeJobId}
      questionsPaused={v3Runtime.questionsPaused}
      onConfirm={state.mode === "demo" ? () => advancePreparedDemo() : (jobId) => dispatchV3({ type: "V3_JOB_CONFIRMED", jobId, confirmedAt: new Date().toISOString() })}
      onPause={state.mode === "live" ? pausePermittedQuestions : undefined}
      onResume={state.mode === "live" ? resumePermittedQuestions : undefined}
      onDefer={state.mode === "live" ? deferPermittedDecision : undefined}
      onUndo={state.mode === "live" ? (jobId) => dispatchV3({ type: "V3_JOB_CONFIRMATION_UNDONE", jobId }) : undefined}
      onRetry={(jobId) => {
        const runtime = v3RuntimeRef.current;
        const batch = runtime.lockedDecisionBatch;
        if (!batch?.entries.some((entry) => entry.jobId === jobId)) return;
        const requestId = createId("REQ");
        const actionId = batch.actionId;
        const cancelEpoch = runtime.cancelEpoch + 1;
        dispatchV3({ type: "V3_DECISION_BATCH_RETRY_REQUESTED", batchId: batch.id, requestId, actionId, cancelEpoch });
        void submitBrain(stateRef.current, "decision_batch", undefined, true, batch);
      }}
      onReuse={(wording) => {
        if (!state.currentPrompt) return;
        pendingOperation.current = "answer";
        dispatch({ type: "ANSWER_DRAFT_READY", draft: { text: wording, source: "typed", promptId: state.currentPrompt.id, transcriptionItemId: null } });
      }}
    />
  );
  const preparedAdvance = state.mode === "demo" && preparedV3FrameLabel && !preparedV3Complete && !activeV3Job ? (
    <section className="rounded-2xl border border-violet-700 bg-violet-950/20 p-4">
      <p className="text-sm text-stone-300">Prepared fixture · {preparedV3FrameLabel}</p>
      <button type="button" onClick={advancePreparedDemo} className="mt-3 min-h-11 rounded-xl bg-violet-300 px-4 font-semibold text-stone-950">Advance prepared walkthrough</button>
    </section>
  ) : null;
  const decisionTray = restoredControls || tray || preparedAdvance ? <div className="space-y-4">{restoredControls}{tray}{preparedAdvance}</div> : null;
  const hasPermittedWindow = Boolean(v3Runtime.interviewWindow?.permits.length);
  const permittedInterview = state.activeLookahead || (!activeV3Job && !(state.pendingRequest && hasPermittedWindow))
    ? null
    : (
      <InterviewWindowQuestion
        activeJob={activeV3Job}
        futureTopics={futurePermitTopics}
        mode={state.mode}
        externalEvidence={state.specification.externalEvidence ?? []}
      >
        {activeV3Job && ["presenting", "clarifying"].includes(activeV3Job.status) && (
          <div className="space-y-3">
            <TextComposer actionLabel="Add clarification" onReview={clarifyPermittedDecision} />
            {activeV3Job.clarificationTurns.some((turn) => turn.role === "product_manager") && <button type="button" onClick={createPermittedSummary} className="min-h-11 rounded-xl border border-violet-600 px-4 font-semibold">Create Decision Summary</button>}
          </div>
        )}
        {activeV3Job?.status === "summary_draft" && activeV3Job.decisionSummary && (
          <div className="rounded-2xl border border-stone-700 bg-stone-950 p-4">
            <label htmlFor={`v3-summary-${activeV3Job.id}`} className="font-semibold">Editable Decision Summary</label>
            <textarea id={`v3-summary-${activeV3Job.id}`} rows={5} maxLength={4_000} value={activeV3Job.decisionSummary.text} onChange={(event) => updatePermittedSummary(activeV3Job.id, event.target.value)} className="mt-2 w-full rounded-xl border border-stone-600 bg-stone-900 p-3" />
            <p className="mt-2 text-xs text-stone-400">Non-authoritative until you confirm it; confirmation means awaiting dependency check.</p>
          </div>
        )}
        {activeV3Job?.status === "revalidation_pending" && <p className="rounded-xl border border-amber-800 bg-amber-950/20 p-3 text-sm">Revalidation Pending. Confirmation is disabled until the Brain issues a matching fresh permit.</p>}
      </InterviewWindowQuestion>
    );

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
    return <PendingWorkReview pendingRequest={state.pendingRequest} activeLookahead={state.activeLookahead} staleSummaries={state.staleDecisionSummaries} persistentBrainStatus={persistentBrainStatus} decisionTray={decisionTray} onKeepWorking={() => setShowPendingReview(false)} onAbandonAndReview={(reason) => { activeRequestAbort.current?.abort(); pendingDemoStep.current = null; communicator.stopClarification(); for (const job of v3RuntimeRef.current.jobs) { if (!["applied", "not_applied"].includes(job.status)) dispatchV3({ type: "V3_JOB_NOT_APPLIED", jobId: job.id, reason: "abandoned", explanation: reason }); } dispatch({ type: "ABANDON_PENDING_AND_ENTER_FINAL_REVIEW", reason }); setShowPendingReview(false); }} />;
  }

  if (state.phase === "final_review" || state.phase === "finalized") {
    return <FinalReview specification={state.specification} revision={state.revision} mode={state.mode} finalized={state.phase === "finalized"} brainModel={state.provenance.source === "live_ai" ? state.provenance.brainModel : null} realtimeModel={state.provenance.source === "live_ai" ? state.provenance.realtimeModel : null} staleDecisionSummaries={state.staleDecisionSummaries} persistentBrainStatus={persistentBrainStatus} decisionTray={decisionTray} onNextActionsChange={updateNextActions} onFinalize={() => dispatch({ type: "FINALIZE" })} onResume={resumeGrilling} onExit={exitSession} />;
  }

  const currentTopic = state.questionRoadmap.items.find((item) => item.id === state.questionRoadmap.currentDecisionItemId)?.topic ?? null;
  return <InterviewRoom state={state} remainingLabel={remainingLabel} microphoneState={communicator.microphoneState} voiceMuted={voiceMuted} changedItemIds={changedItemIds} preparedAudioUnavailable={preparedAudioUnavailable} activeLookahead={state.activeLookahead} processingTopic={currentTopic} staleReason={state.staleLookaheadReason} staleDecisionSummaries={state.staleDecisionSummaries} persistentBrainStatus={persistentBrainStatus} permittedInterview={permittedInterview} decisionTray={decisionTray} onToggleVoice={() => { const nextMuted = !voiceMuted; setVoiceMuted(nextMuted); if (nextMuted) { transport.stopPlayback(); preparedAudio.current?.pause(); } }} canResumeMicrophone={communicator.connectionState === "connected"} onResumeMicrophone={() => { communicator.resumeMicrophone(); dispatch({ type: "LISTENING_STARTED" }); }} onAnswerNow={state.mode === "live" && communicator.connectionState === "connected" ? () => { communicator.answerNow(); dispatch({ type: "LISTENING_STARTED" }); } : undefined} onComposerFocus={communicator.pauseForTextInput} onCreateDraft={(draft: AnswerDraft) => { pendingOperation.current = "answer"; communicator.pauseForTextInput(); dispatch({ type: "ANSWER_DRAFT_READY", draft }); }} onEditDraft={(text) => dispatch({ type: "ANSWER_DRAFT_EDITED", text })} onConfirmDraft={confirmDraft} onRecordAgain={() => { if (communicator.connectionState === "connected") { communicator.recordAgain(); dispatch({ type: "LISTENING_STARTED" }); } else dispatch({ type: "ANSWER_DRAFT_DISCARDED" }); }} onDefer={state.mode === "live" ? deferPrompt : undefined} onReviewSpecification={reviewSpecification} onCorrectItem={correctItem} onUsePreparedAnswer={state.mode === "demo" ? advancePreparedDemo : undefined} onClarification={clarifyLookahead} onRequestDecisionSummary={requestDecisionSummary} onDecisionSummaryChange={(text) => dispatch({ type: "DECISION_SUMMARY_EDITED", text })} onConfirmDecisionSummary={confirmDecisionSummary} onReuseStaleSummary={(text) => { if (!state.currentPrompt) return; pendingOperation.current = "answer"; dispatch({ type: "ANSWER_DRAFT_READY", draft: { text, source: "typed", promptId: state.currentPrompt.id, transcriptionItemId: null } }); }} onRetryError={state.mode === "live" && state.error?.retryable ? retryFromError : undefined} onRestartPreparedDemo={state.mode === "live" && state.error ? () => enterContextIntake("demo", false) : undefined} />;
}
