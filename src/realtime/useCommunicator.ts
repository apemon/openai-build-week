"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AnswerDraft, LookaheadApproval } from "@/domain/types";

import type {
  ClarificationCommunicatorTransport,
  CommunicatorEvent,
  CommunicatorSessionConfig,
  CommunicatorTransport,
  MicrophoneState,
} from "./CommunicatorTransport";

export type CommunicatorConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "text_fallback";

export interface CommunicatorHookError {
  code: string;
  retryable: boolean;
}

export interface UseCommunicatorOptions {
  transport: CommunicatorTransport;
  onAnswerDraft?: (draft: AnswerDraft) => void;
  onClarificationTranscript?: (input: {
    roadmapItemId: string;
    text: string;
    source: "transcription";
  }) => void;
  onEvent?: (event: CommunicatorEvent) => void;
}

export interface CommunicatorDecisionSummaryDraft {
  roadmapItemId: string;
  text: string;
  uncertainties: string[];
}

export interface UseCommunicatorResult {
  connectionState: CommunicatorConnectionState;
  microphoneState: MicrophoneState;
  transcriptPreview: string;
  answerDraft: AnswerDraft | null;
  activeClarificationItemId: string | null;
  clarificationTranscriptPreview: string;
  decisionSummaryDraft: CommunicatorDecisionSummaryDraft | null;
  error: CommunicatorHookError | null;
  textFallbackAvailable: boolean;
  connect: (config: CommunicatorSessionConfig) => Promise<boolean>;
  reconnect: (config: CommunicatorSessionConfig) => Promise<boolean>;
  disconnect: () => void;
  presentPrompt: (promptId: string, spokenQuestion: string) => boolean;
  answerNow: () => void;
  pauseForTextInput: () => void;
  resumeMicrophone: () => void;
  recordAgain: () => void;
  clearAnswerDraft: () => void;
  beginClarification: (approval: LookaheadApproval) => boolean;
  submitClarificationText: (text: string) => boolean;
  requestDecisionSummary: () => boolean;
  stopClarification: () => void;
}

export function useCommunicator({
  transport,
  onAnswerDraft,
  onClarificationTranscript,
  onEvent,
}: UseCommunicatorOptions): UseCommunicatorResult {
  const [connectionState, setConnectionState] = useState<CommunicatorConnectionState>("idle");
  const [microphoneState, setMicrophoneState] = useState<MicrophoneState>("off");
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [answerDraft, setAnswerDraft] = useState<AnswerDraft | null>(null);
  const [activeClarificationItemId, setActiveClarificationItemId] = useState<string | null>(null);
  const [clarificationTranscriptPreview, setClarificationTranscriptPreview] = useState("");
  const [decisionSummaryDraft, setDecisionSummaryDraft] = useState<CommunicatorDecisionSummaryDraft | null>(null);
  const [error, setError] = useState<CommunicatorHookError | null>(null);
  const activePromptId = useRef<string | null>(null);
  const activeItemId = useRef<string | null>(null);
  const activeClarificationItemIdRef = useRef<string | null>(null);
  const transcriptByItemId = useRef(new Map<string, string>());
  const completedItemIds = useRef(new Set<string>());
  const microphonePausedForTextInput = useRef(false);
  const onAnswerDraftRef = useRef(onAnswerDraft);
  const onClarificationTranscriptRef = useRef(onClarificationTranscript);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onAnswerDraftRef.current = onAnswerDraft;
    onClarificationTranscriptRef.current = onClarificationTranscript;
    onEventRef.current = onEvent;
  }, [onAnswerDraft, onClarificationTranscript, onEvent]);

  useEffect(() => {
    return transport.subscribe((event) => {
      onEventRef.current?.(event);
      switch (event.type) {
        case "connected":
          setConnectionState("connected");
          setMicrophoneState(transport.getMicrophoneState());
          setError(null);
          break;
        case "disconnected":
          setMicrophoneState("off");
          if (event.retryable) {
            setConnectionState("text_fallback");
            setError({ code: "REALTIME_DISCONNECTED", retryable: true });
          } else {
            setConnectionState("idle");
          }
          break;
        case "prompt_playback_started":
          setMicrophoneState("off");
          break;
        case "prompt_playback_done":
          if (microphonePausedForTextInput.current) {
            transport.setMicrophoneEnabled(false);
            setMicrophoneState("off");
          } else {
            setMicrophoneState(transport.getMicrophoneState());
          }
          break;
        case "speech_started":
          activeItemId.current = event.itemId;
          transcriptByItemId.current.set(event.itemId, "");
          setTranscriptPreview("");
          setMicrophoneState("speech_detected");
          break;
        case "speech_stopped":
          if (activeItemId.current === event.itemId) setMicrophoneState("transcribing");
          break;
        case "transcript_delta": {
          if (completedItemIds.current.has(event.itemId)) break;
          const next = `${transcriptByItemId.current.get(event.itemId) ?? ""}${event.delta}`.slice(
            0,
            4_000,
          );
          transcriptByItemId.current.set(event.itemId, next);
          if (activeItemId.current === event.itemId) {
            if (activeClarificationItemIdRef.current) {
              setClarificationTranscriptPreview(next);
            } else {
              setTranscriptPreview(next);
            }
          }
          break;
        }
        case "transcript_completed": {
          if (completedItemIds.current.has(event.itemId)) break;
          completedItemIds.current.add(event.itemId);
          transcriptByItemId.current.delete(event.itemId);
          if (activeItemId.current !== event.itemId) break;

          const clarificationItemId = activeClarificationItemIdRef.current;
          if (clarificationItemId) {
            const text = event.transcript.trim().slice(0, 4_000);
            activeItemId.current = null;
            setTranscriptPreview("");
            setClarificationTranscriptPreview("");
            transport.setMicrophoneEnabled(false);
            setMicrophoneState("off");
            if (!text) break;
            onClarificationTranscriptRef.current?.({
              roadmapItemId: clarificationItemId,
              text,
              source: "transcription",
            });
            const clarificationTransport = getClarificationTransport(transport);
            try {
              clarificationTransport?.submitClarificationText(clarificationItemId, text);
            } catch {
              setClarificationTranscriptPreview(text);
              setConnectionState("text_fallback");
              setError({ code: "REALTIME_UNAVAILABLE", retryable: true });
            }
            break;
          }

          transport.setMicrophoneEnabled(false);
          const draft: AnswerDraft = {
            text: event.transcript.slice(0, 4_000),
            source: "transcription",
            promptId: activePromptId.current,
            transcriptionItemId: event.itemId,
          };
          activeItemId.current = null;
          setTranscriptPreview("");
          setAnswerDraft(draft);
          setMicrophoneState("reviewing_answer");
          onAnswerDraftRef.current?.(draft);
          break;
        }
        case "decision_summary_ready":
          if (event.roadmapItemId !== activeClarificationItemIdRef.current) break;
          setDecisionSummaryDraft({
            roadmapItemId: event.roadmapItemId,
            text: event.text,
            uncertainties: event.uncertainties,
          });
          transport.setMicrophoneEnabled(false);
          setMicrophoneState("off");
          break;
        case "error":
          transport.setMicrophoneEnabled(false);
          setMicrophoneState("off");
          setConnectionState("text_fallback");
          setError({ code: event.code, retryable: event.retryable });
          break;
      }
    });
  }, [transport]);

  const connectWithState = useCallback(
    async (config: CommunicatorSessionConfig, reconnecting: boolean): Promise<boolean> => {
      setConnectionState(reconnecting ? "reconnecting" : "connecting");
      setError(null);
      try {
        await transport.connect(config);
        return true;
      } catch {
        transport.setMicrophoneEnabled(false);
        setMicrophoneState("off");
        setConnectionState("text_fallback");
        setError({ code: "REALTIME_UNAVAILABLE", retryable: true });
        return false;
      }
    },
    [transport],
  );

  const connect = useCallback(
    (config: CommunicatorSessionConfig) => connectWithState(config, false),
    [connectWithState],
  );
  const reconnect = useCallback(
    (config: CommunicatorSessionConfig) => connectWithState(config, true),
    [connectWithState],
  );

  const disconnect = useCallback(() => {
    transport.disconnect();
    activePromptId.current = null;
    activeItemId.current = null;
    transcriptByItemId.current.clear();
    completedItemIds.current.clear();
    microphonePausedForTextInput.current = false;
    setTranscriptPreview("");
    setAnswerDraft(null);
    activeClarificationItemIdRef.current = null;
    setActiveClarificationItemId(null);
    setClarificationTranscriptPreview("");
    setDecisionSummaryDraft(null);
    setMicrophoneState("off");
  }, [transport]);

  const presentPrompt = useCallback(
    (promptId: string, spokenQuestion: string): boolean => {
      microphonePausedForTextInput.current = false;
      activePromptId.current = promptId;
      setAnswerDraft(null);
      setTranscriptPreview("");
      try {
        transport.speakPrompt(promptId, spokenQuestion);
        setMicrophoneState("off");
        return true;
      } catch {
        setConnectionState("text_fallback");
        setError({ code: "REALTIME_UNAVAILABLE", retryable: true });
        return false;
      }
    },
    [transport],
  );

  const answerNow = useCallback(() => {
    microphonePausedForTextInput.current = false;
    transport.stopPlayback();
    transport.setMicrophoneEnabled(true);
    setMicrophoneState(transport.getMicrophoneState());
  }, [transport]);

  const pauseForTextInput = useCallback(() => {
    microphonePausedForTextInput.current = true;
    try {
      transport.stopPlayback();
    } catch {
      // Track gating remains authoritative if playback cancellation races a disconnect.
    }
    transport.setMicrophoneEnabled(false);
    setMicrophoneState("off");
  }, [transport]);

  const resumeMicrophone = useCallback(() => {
    microphonePausedForTextInput.current = false;
    setAnswerDraft(null);
    setTranscriptPreview("");
    transport.setMicrophoneEnabled(true);
    setMicrophoneState(transport.getMicrophoneState());
  }, [transport]);

  const recordAgain = useCallback(() => {
    microphonePausedForTextInput.current = false;
    activeItemId.current = null;
    setAnswerDraft(null);
    setTranscriptPreview("");
    transport.setMicrophoneEnabled(true);
    setMicrophoneState(transport.getMicrophoneState());
  }, [transport]);

  const clearAnswerDraft = useCallback(() => {
    setAnswerDraft(null);
    setTranscriptPreview("");
    transport.setMicrophoneEnabled(false);
    setMicrophoneState("off");
  }, [transport]);

  const beginClarification = useCallback((approval: LookaheadApproval): boolean => {
    const clarificationTransport = getClarificationTransport(transport);
    if (!clarificationTransport) {
      setConnectionState("text_fallback");
      setError({ code: "REALTIME_CLARIFICATION_UNAVAILABLE", retryable: false });
      return false;
    }
    try {
      clarificationTransport.beginClarification(approval);
      activeClarificationItemIdRef.current = approval.roadmapItemId;
      setActiveClarificationItemId(approval.roadmapItemId);
      setAnswerDraft(null);
      setTranscriptPreview("");
      setClarificationTranscriptPreview("");
      setDecisionSummaryDraft(null);
      setMicrophoneState(transport.getMicrophoneState());
      return true;
    } catch {
      setConnectionState("text_fallback");
      setError({ code: "REALTIME_CLARIFICATION_UNAVAILABLE", retryable: true });
      return false;
    }
  }, [transport]);

  const submitClarificationText = useCallback((text: string): boolean => {
    const roadmapItemId = activeClarificationItemIdRef.current;
    const clarificationTransport = getClarificationTransport(transport);
    if (!roadmapItemId || !clarificationTransport) return false;
    try {
      clarificationTransport.submitClarificationText(roadmapItemId, text);
      setClarificationTranscriptPreview("");
      setMicrophoneState(transport.getMicrophoneState());
      return true;
    } catch {
      setClarificationTranscriptPreview(text.trim().slice(0, 4_000));
      setConnectionState("text_fallback");
      setError({ code: "REALTIME_CLARIFICATION_UNAVAILABLE", retryable: true });
      return false;
    }
  }, [transport]);

  const requestDecisionSummary = useCallback((): boolean => {
    const roadmapItemId = activeClarificationItemIdRef.current;
    const clarificationTransport = getClarificationTransport(transport);
    if (!roadmapItemId || !clarificationTransport) return false;
    try {
      clarificationTransport.requestDecisionSummary(roadmapItemId);
      transport.setMicrophoneEnabled(false);
      setMicrophoneState("off");
      return true;
    } catch {
      setConnectionState("text_fallback");
      setError({ code: "REALTIME_DECISION_SUMMARY_UNAVAILABLE", retryable: true });
      return false;
    }
  }, [transport]);

  const stopClarification = useCallback(() => {
    getClarificationTransport(transport)?.stopClarification();
    activeClarificationItemIdRef.current = null;
    activeItemId.current = null;
    setActiveClarificationItemId(null);
    setClarificationTranscriptPreview("");
    transport.setMicrophoneEnabled(false);
    setMicrophoneState("off");
  }, [transport]);

  return {
    connectionState,
    microphoneState,
    transcriptPreview,
    answerDraft,
    activeClarificationItemId,
    clarificationTranscriptPreview,
    decisionSummaryDraft,
    error,
    textFallbackAvailable: connectionState === "text_fallback",
    connect,
    reconnect,
    disconnect,
    presentPrompt,
    answerNow,
    pauseForTextInput,
    resumeMicrophone,
    recordAgain,
    clearAnswerDraft,
    beginClarification,
    submitClarificationText,
    requestDecisionSummary,
    stopClarification,
  };
}

function getClarificationTransport(
  transport: CommunicatorTransport,
): ClarificationCommunicatorTransport | null {
  const candidate = transport as Partial<ClarificationCommunicatorTransport>;
  return typeof candidate.beginClarification === "function"
    && typeof candidate.submitClarificationText === "function"
    && typeof candidate.requestDecisionSummary === "function"
    && typeof candidate.stopClarification === "function"
    ? candidate as ClarificationCommunicatorTransport
    : null;
}
