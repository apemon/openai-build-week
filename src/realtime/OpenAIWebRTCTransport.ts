import { createSpeakBrainPromptEvent } from "@/agents/communicator/prompt-presenter";

import type {
  CommunicatorEvent,
  CommunicatorSessionConfig,
  CommunicatorTransport,
  MicrophoneState,
} from "./CommunicatorTransport";
import { parseRealtimeServerEvent, type RealtimeServerEvent } from "./realtime-event-schemas";
import {
  createLockedRealtimeSession,
  isLockedRealtimeSession,
  REALTIME_VOICE,
  TRANSCRIPTION_MODEL,
} from "./realtime-session";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const DATA_CHANNEL_OPEN_TIMEOUT_MS = 10_000;

type Listener = (event: CommunicatorEvent) => void;

export interface OpenAIWebRTCTransportDependencies {
  createPeerConnection?: () => RTCPeerConnection;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  fetch?: typeof globalThis.fetch;
  createAudioElement?: () => HTMLAudioElement;
}

export interface PromptDeliveryDiagnostic {
  promptId: string;
  matchedApprovedQuestion: boolean | null;
}

export class OpenAIWebRTCTransport implements CommunicatorTransport {
  private readonly createPeerConnection: () => RTCPeerConnection;
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly createAudioElement: () => HTMLAudioElement;
  private readonly listeners = new Set<Listener>();
  private readonly responsePromptIds = new Map<string, string>();
  private readonly approvedQuestions = new Map<string, string>();
  private readonly outputTranscripts = new Map<string, string>();
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private microphoneState: MicrophoneState = "off";
  private activePromptId: string | null = null;
  private activeResponseId: string | null = null;
  private activeTranscriptionItemId: string | null = null;
  private sessionValidated = false;
  private intentionalDisconnect = false;
  private expectedSession: ReturnType<typeof createLockedRealtimeSession> | null = null;
  private lastPromptDelivery: PromptDeliveryDiagnostic | null = null;

  constructor(dependencies: OpenAIWebRTCTransportDependencies = {}) {
    this.createPeerConnection =
      dependencies.createPeerConnection ?? (() => new RTCPeerConnection());
    this.getUserMedia =
      dependencies.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    this.fetchImplementation = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.createAudioElement =
      dependencies.createAudioElement ?? (() => document.createElement("audio"));
  }

  async connect(config: CommunicatorSessionConfig): Promise<void> {
    this.cleanup(false);
    this.intentionalDisconnect = false;
    this.expectedSession = createLockedRealtimeSession(
      config.realtimeModel,
      TRANSCRIPTION_MODEL,
      REALTIME_VOICE,
    );

    try {
      const peerConnection = this.createPeerConnection();
      this.peerConnection = peerConnection;
      this.attachPeerConnectionListeners(peerConnection);

      const audioElement = this.createAudioElement();
      audioElement.autoplay = true;
      audioElement.setAttribute("playsinline", "");
      this.audioElement = audioElement;

      const localStream = await this.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      this.localStream = localStream;
      const microphoneTrack = localStream.getAudioTracks()[0];
      if (!microphoneTrack) throw new Error("Microphone unavailable");
      microphoneTrack.enabled = false;
      peerConnection.addTrack(microphoneTrack, localStream);

      const dataChannel = peerConnection.createDataChannel("oai-events");
      this.dataChannel = dataChannel;
      this.attachDataChannelListeners(dataChannel);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      if (!offer.sdp) throw new Error("Realtime connection failed");

      const response = await this.fetchImplementation(REALTIME_CALLS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!response.ok) throw new Error("Realtime connection failed");

      const answerSdp = await response.text();
      if (!answerSdp) throw new Error("Realtime connection failed");
      await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });
      await this.waitForDataChannelOpen(dataChannel);
    } catch {
      this.cleanup(false);
      this.emit({ type: "error", code: "REALTIME_UNAVAILABLE", retryable: true });
      throw new Error("Realtime Communicator is unavailable.");
    }
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cleanup(true);
  }

  setMicrophoneEnabled(enabled: boolean): void {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track || track.readyState === "ended") {
      this.microphoneState = "off";
      return;
    }

    track.enabled = enabled;
    this.microphoneState = enabled ? "listening" : "off";
  }

  speakPrompt(promptId: string, spokenQuestion: string): void {
    const event = createSpeakBrainPromptEvent(promptId, spokenQuestion);
    this.setMicrophoneEnabled(false);
    this.activePromptId = event.response.metadata.promptId;
    this.approvedQuestions.set(event.response.metadata.promptId, spokenQuestion.trim());
    this.sendEvent(event);
  }

  stopPlayback(): void {
    if (this.activePromptId) {
      this.sendEvent(
        this.activeResponseId
          ? { type: "response.cancel", response_id: this.activeResponseId }
          : { type: "response.cancel" },
      );
      this.sendEvent({ type: "output_audio_buffer.clear" });
    }
    this.audioElement?.pause();
    this.finishPromptPlayback(this.activePromptId);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getMicrophoneState(): MicrophoneState {
    return this.microphoneState;
  }

  getLastPromptDeliveryDiagnostic(): PromptDeliveryDiagnostic | null {
    return this.lastPromptDelivery;
  }

  private attachPeerConnectionListeners(peerConnection: RTCPeerConnection): void {
    peerConnection.addEventListener("track", (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream && this.audioElement) this.audioElement.srcObject = remoteStream;
    });
    peerConnection.addEventListener("connectionstatechange", () => {
      if (
        !this.intentionalDisconnect &&
        (peerConnection.connectionState === "failed" ||
          peerConnection.connectionState === "disconnected")
      ) {
        this.setMicrophoneEnabled(false);
        this.emit({ type: "disconnected", retryable: true });
      }
    });
  }

  private attachDataChannelListeners(dataChannel: RTCDataChannel): void {
    dataChannel.addEventListener("message", (message) => {
      if (typeof message.data !== "string") {
        this.emit({ type: "error", code: "INVALID_REALTIME_EVENT", retryable: true });
        return;
      }
      const parsed = parseRealtimeServerEvent(message.data);
      if (!parsed.success) {
        if (parsed.reason === "invalid") {
          this.emit({ type: "error", code: "INVALID_REALTIME_EVENT", retryable: true });
        }
        return;
      }
      this.handleProviderEvent(parsed.event);
    });
  }

  private handleProviderEvent(event: RealtimeServerEvent): void {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        if (!this.expectedSession || !isLockedRealtimeSession(event.session, this.expectedSession)) {
          this.cleanup(false);
          this.emit({ type: "error", code: "UNSAFE_REALTIME_SESSION", retryable: true });
          return;
        }
        if (!this.sessionValidated) {
          this.sessionValidated = true;
          this.emit({ type: "connected" });
        }
        return;
      case "error":
        this.setMicrophoneEnabled(false);
        this.emit({
          type: "error",
          code: normalizeProviderErrorCode(event.error.code ?? event.error.type),
          retryable: true,
        });
        return;
      case "input_audio_buffer.speech_started":
        if (this.microphoneState !== "listening") return;
        this.activeTranscriptionItemId = event.item_id;
        this.microphoneState = "speech_detected";
        this.emit({ type: "speech_started", itemId: event.item_id });
        return;
      case "input_audio_buffer.speech_stopped":
        if (
          this.microphoneState !== "speech_detected" ||
          this.activeTranscriptionItemId !== event.item_id
        ) return;
        this.microphoneState = "transcribing";
        this.emit({ type: "speech_stopped", itemId: event.item_id });
        return;
      case "conversation.item.input_audio_transcription.delta":
        if (
          (this.microphoneState !== "transcribing" && this.microphoneState !== "speech_detected") ||
          this.activeTranscriptionItemId !== event.item_id
        ) {
          return;
        }
        this.emit({ type: "transcript_delta", itemId: event.item_id, delta: event.delta });
        return;
      case "conversation.item.input_audio_transcription.completed":
        if (
          this.microphoneState !== "transcribing" ||
          this.activeTranscriptionItemId !== event.item_id
        ) return;
        this.setMicrophoneEnabled(false);
        this.microphoneState = "reviewing_answer";
        this.activeTranscriptionItemId = null;
        this.emit({
          type: "transcript_completed",
          itemId: event.item_id,
          transcript: event.transcript.slice(0, 4_000),
        });
        return;
      case "response.created": {
        const promptId = getPromptId(event.response.metadata);
        if (!promptId || promptId !== this.activePromptId) return;
        this.activeResponseId = event.response.id;
        this.responsePromptIds.set(event.response.id, promptId);
        return;
      }
      case "output_audio_buffer.started": {
        const promptId = this.responsePromptIds.get(event.response_id);
        if (!promptId) return;
        void this.audioElement?.play().catch(() => {
          this.emit({ type: "error", code: "AUDIO_PLAYBACK_FAILED", retryable: true });
        });
        this.emit({ type: "prompt_playback_started", promptId });
        return;
      }
      case "response.output_audio_transcript.delta": {
        if (!this.responsePromptIds.has(event.response_id)) return;
        const current = this.outputTranscripts.get(event.response_id) ?? "";
        this.outputTranscripts.set(event.response_id, `${current}${event.delta}`.slice(0, 4_000));
        return;
      }
      case "response.output_audio_transcript.done": {
        const promptId = this.responsePromptIds.get(event.response_id);
        if (!promptId) return;
        const expected = this.approvedQuestions.get(promptId);
        this.lastPromptDelivery = {
          promptId,
          matchedApprovedQuestion: expected ? normalizeSpeech(event.transcript) === normalizeSpeech(expected) : null,
        };
        this.outputTranscripts.delete(event.response_id);
        return;
      }
      case "response.done": {
        const promptId = this.responsePromptIds.get(event.response.id) ?? getPromptId(event.response.metadata);
        if (!promptId) return;
        if (event.response.status !== "completed") {
          this.emit({ type: "error", code: "PROMPT_PLAYBACK_FAILED", retryable: true });
          this.finishPromptPlayback(promptId);
        }
        return;
      }
      case "output_audio_buffer.stopped": {
        const promptId = this.responsePromptIds.get(event.response_id);
        if (promptId) this.finishPromptPlayback(promptId);
        return;
      }
    }
  }

  private finishPromptPlayback(promptId: string | null): void {
    if (!promptId) return;
    this.setMicrophoneEnabled(true);
    this.emit({ type: "prompt_playback_done", promptId });
    for (const [responseId, mappedPromptId] of this.responsePromptIds) {
      if (mappedPromptId === promptId) this.responsePromptIds.delete(responseId);
    }
    this.approvedQuestions.delete(promptId);
    this.activePromptId = null;
    this.activeResponseId = null;
  }

  private sendEvent(event: object): void {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      throw new Error("Realtime Communicator is not connected.");
    }
    this.dataChannel.send(JSON.stringify(event));
  }

  private waitForDataChannelOpen(dataChannel: RTCDataChannel): Promise<void> {
    if (dataChannel.readyState === "open") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Realtime connection timed out"));
      }, DATA_CHANNEL_OPEN_TIMEOUT_MS);
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Realtime connection closed"));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        dataChannel.removeEventListener("open", onOpen);
        dataChannel.removeEventListener("close", onClose);
      };
      dataChannel.addEventListener("open", onOpen, { once: true });
      dataChannel.addEventListener("close", onClose, { once: true });
    });
  }

  private cleanup(emitDisconnected: boolean): void {
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.dataChannel?.close();
    this.dataChannel = null;
    this.peerConnection?.close();
    this.peerConnection = null;
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
    }
    this.audioElement = null;
    this.microphoneState = "off";
    this.sessionValidated = false;
    this.activePromptId = null;
    this.activeResponseId = null;
    this.activeTranscriptionItemId = null;
    this.expectedSession = null;
    this.responsePromptIds.clear();
    this.approvedQuestions.clear();
    this.outputTranscripts.clear();
    if (emitDisconnected) this.emit({ type: "disconnected", retryable: false });
  }

  private emit(event: CommunicatorEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

function getPromptId(metadata: Record<string, string> | null | undefined): string | null {
  if (metadata?.purpose !== "speak_brain_prompt") return null;
  const promptId = metadata.promptId;
  return promptId && promptId.length <= 200 ? promptId : null;
}

function normalizeProviderErrorCode(code: string | undefined): string {
  if (!code) return "REALTIME_UNAVAILABLE";
  const normalized = code.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
  return normalized || "REALTIME_UNAVAILABLE";
}

function normalizeSpeech(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "").toLocaleLowerCase("en");
}
