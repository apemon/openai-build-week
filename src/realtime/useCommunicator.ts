"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AnswerDraft } from "@/domain/types";

import type {
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
  onEvent?: (event: CommunicatorEvent) => void;
}

export interface UseCommunicatorResult {
  connectionState: CommunicatorConnectionState;
  microphoneState: MicrophoneState;
  transcriptPreview: string;
  answerDraft: AnswerDraft | null;
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
}

export function useCommunicator({
  transport,
  onAnswerDraft,
  onEvent,
}: UseCommunicatorOptions): UseCommunicatorResult {
  const [connectionState, setConnectionState] = useState<CommunicatorConnectionState>("idle");
  const [microphoneState, setMicrophoneState] = useState<MicrophoneState>("off");
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [answerDraft, setAnswerDraft] = useState<AnswerDraft | null>(null);
  const [error, setError] = useState<CommunicatorHookError | null>(null);
  const activePromptId = useRef<string | null>(null);
  const activeItemId = useRef<string | null>(null);
  const transcriptByItemId = useRef(new Map<string, string>());
  const completedItemIds = useRef(new Set<string>());
  const microphonePausedForTextInput = useRef(false);
  const onAnswerDraftRef = useRef(onAnswerDraft);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onAnswerDraftRef.current = onAnswerDraft;
    onEventRef.current = onEvent;
  }, [onAnswerDraft, onEvent]);

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
          if (activeItemId.current === event.itemId) setTranscriptPreview(next);
          break;
        }
        case "transcript_completed": {
          if (completedItemIds.current.has(event.itemId)) break;
          completedItemIds.current.add(event.itemId);
          transcriptByItemId.current.delete(event.itemId);
          if (activeItemId.current !== event.itemId) break;

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
    setMicrophoneState("off");
  }, [transport]);

  const presentPrompt = useCallback(
    (promptId: string, spokenQuestion: string): boolean => {
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

  return {
    connectionState,
    microphoneState,
    transcriptPreview,
    answerDraft,
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
  };
}
