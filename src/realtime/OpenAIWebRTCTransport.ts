import { createSpeakBrainPromptEvent } from "@/agents/communicator/prompt-presenter";
import {
  createClarificationResponseEvent,
  createDecisionSummaryResponseEvent,
  parseDecisionSummaryOutput,
} from "@/agents/communicator/clarification-presenter";
import { lookaheadApprovalSchema } from "@/domain/schemas";
import type { ClarificationTurn, LookaheadApproval } from "@/domain/types";

import type {
  ClarificationCommunicatorTransport,
  CommunicatorEvent,
  CommunicatorSessionConfig,
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

interface ActiveClarification {
  approval: LookaheadApproval;
  turns: ClarificationTurn[];
}

type ClarificationResponseBinding = {
  purpose: "clarification_response" | "decision_summary";
  roadmapItemId: string;
};

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

export class OpenAIWebRTCTransport implements ClarificationCommunicatorTransport {
  private readonly createPeerConnection: () => RTCPeerConnection;
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly createAudioElement: () => HTMLAudioElement;
  private readonly listeners = new Set<Listener>();
  private readonly responsePromptIds = new Map<string, string>();
  private readonly approvedQuestions = new Map<string, string>();
  private readonly outputTranscripts = new Map<string, string>();
  private readonly clarificationResponses = new Map<string, ClarificationResponseBinding>();
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private microphoneState: MicrophoneState = "off";
  private activePromptId: string | null = null;
  private activeResponseId: string | null = null;
  private activeTranscriptionItemId: string | null = null;
  private activeClarification: ActiveClarification | null = null;
  private activeClarificationResponseId: string | null = null;
  private clarificationResponsePending = false;
  private clarificationTurnSequence = 0;
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

  beginClarification(approval: LookaheadApproval): void {
    const parsed = lookaheadApprovalSchema.parse(approval);
    if (this.activeClarification) {
      if (sameApproval(this.activeClarification.approval, parsed)) return;
      throw new Error("A different Lookahead clarification is already active.");
    }

    this.requireConnected();
    this.setMicrophoneEnabled(false);
    this.activeClarification = { approval: parsed, turns: [] };
    this.clarificationTurnSequence = 0;
    try {
      this.sendClarificationResponse();
    } catch (error) {
      this.activeClarification = null;
      throw error;
    }
  }

  submitClarificationText(roadmapItemId: string, text: string): void {
    const active = this.requireActiveClarification(roadmapItemId);
    if (this.clarificationResponsePending) {
      throw new Error("The Communicator is still responding to this clarification turn.");
    }
    const value = text.trim();
    if (!value || value.length > 4_000) throw new Error("Clarification text is invalid.");
    if (active.turns.length >= 20) throw new Error("The clarification exchange has reached its turn limit.");

    active.turns.push(this.createClarificationTurn("product_manager", value));
    this.setMicrophoneEnabled(false);
    try {
      this.sendClarificationResponse();
    } catch (error) {
      active.turns.pop();
      throw error;
    }
  }

  requestDecisionSummary(roadmapItemId: string): void {
    const active = this.requireActiveClarification(roadmapItemId);
    if (this.clarificationResponsePending) {
      throw new Error("The Communicator is still responding to this clarification turn.");
    }
    const event = createDecisionSummaryResponseEvent(active.approval, active.turns);
    this.setMicrophoneEnabled(false);
    this.clarificationResponsePending = true;
    try {
      this.sendEvent(event);
    } catch (error) {
      this.clarificationResponsePending = false;
      throw error;
    }
  }

  stopClarification(): void {
    const activeItemId = this.activeClarification?.approval.roadmapItemId;
    if (activeItemId && this.dataChannel?.readyState === "open" && this.clarificationResponsePending) {
      try {
        this.sendEvent(
          this.activeClarificationResponseId
            ? { type: "response.cancel", response_id: this.activeClarificationResponseId }
            : { type: "response.cancel" },
        );
        this.sendEvent({ type: "output_audio_buffer.clear" });
      } catch {
        // Local scope and microphone cleanup still complete after a transport race.
      }
    }
    this.audioElement?.pause();
    this.setMicrophoneEnabled(false);
    for (const [responseId, binding] of this.clarificationResponses) {
      if (binding.roadmapItemId === activeItemId) {
        this.clarificationResponses.delete(responseId);
        this.outputTranscripts.delete(responseId);
      }
    }
    this.activeClarification = null;
    this.activeClarificationResponseId = null;
    this.clarificationResponsePending = false;
    this.activeTranscriptionItemId = null;
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
        this.microphoneState = this.activeClarification ? "off" : "reviewing_answer";
        this.activeTranscriptionItemId = null;
        this.emit({
          type: "transcript_completed",
          itemId: event.item_id,
          transcript: event.transcript.slice(0, 4_000),
        });
        return;
      case "response.created": {
        const promptId = getPromptId(event.response.metadata);
        if (promptId && promptId === this.activePromptId) {
          this.activeResponseId = event.response.id;
          this.responsePromptIds.set(event.response.id, promptId);
          return;
        }
        const clarification = getClarificationBinding(
          event.response.metadata,
          this.activeClarification?.approval ?? null,
        );
        if (!clarification || !this.clarificationResponsePending) return;
        this.activeClarificationResponseId = event.response.id;
        this.clarificationResponses.set(event.response.id, clarification);
        return;
      }
      case "output_audio_buffer.started": {
        const promptId = this.responsePromptIds.get(event.response_id);
        const clarification = this.clarificationResponses.get(event.response_id);
        if (!promptId && clarification?.purpose !== "clarification_response") return;
        void this.audioElement?.play().catch(() => {
          this.emit({ type: "error", code: "AUDIO_PLAYBACK_FAILED", retryable: true });
        });
        if (promptId) this.emit({ type: "prompt_playback_started", promptId });
        return;
      }
      case "response.output_audio_transcript.delta": {
        if (
          !this.responsePromptIds.has(event.response_id)
          && this.clarificationResponses.get(event.response_id)?.purpose !== "clarification_response"
        ) return;
        const current = this.outputTranscripts.get(event.response_id) ?? "";
        this.outputTranscripts.set(event.response_id, `${current}${event.delta}`.slice(0, 4_000));
        return;
      }
      case "response.output_audio_transcript.done": {
        const promptId = this.responsePromptIds.get(event.response_id);
        if (promptId) {
          const expected = this.approvedQuestions.get(promptId);
          this.lastPromptDelivery = {
            promptId,
            matchedApprovedQuestion: expected ? normalizeSpeech(event.transcript) === normalizeSpeech(expected) : null,
          };
        } else {
          const binding = this.clarificationResponses.get(event.response_id);
          const text = event.transcript.trim();
          if (
            binding?.purpose !== "clarification_response"
            || !text
            || !this.activeClarification
            || binding.roadmapItemId !== this.activeClarification.approval.roadmapItemId
          ) return;
          if (this.activeClarification.turns.length < 20) {
            this.activeClarification.turns.push(this.createClarificationTurn("communicator", text));
          }
          this.emit({
            type: "clarification_response_done",
            roadmapItemId: binding.roadmapItemId,
            text,
          });
        }
        this.outputTranscripts.delete(event.response_id);
        return;
      }
      case "response.output_text.done": {
        const binding = this.clarificationResponses.get(event.response_id);
        if (
          binding?.purpose !== "decision_summary"
          || !this.activeClarification
          || binding.roadmapItemId !== this.activeClarification.approval.roadmapItemId
        ) return;
        const summary = parseDecisionSummaryOutput(event.text);
        if (!summary) {
          this.emit({ type: "error", code: "INVALID_DECISION_SUMMARY", retryable: true });
          return;
        }
        this.emit({
          type: "decision_summary_ready",
          roadmapItemId: binding.roadmapItemId,
          text: summary.text,
          uncertainties: summary.uncertainties,
        });
        return;
      }
      case "response.done": {
        const promptId = this.responsePromptIds.get(event.response.id) ?? getPromptId(event.response.metadata);
        if (promptId) {
          if (event.response.status !== "completed") {
            this.emit({ type: "error", code: "PROMPT_PLAYBACK_FAILED", retryable: true });
            this.finishPromptPlayback(promptId);
          }
          return;
        }
        const clarification = this.clarificationResponses.get(event.response.id)
          ?? getClarificationBinding(event.response.metadata, this.activeClarification?.approval ?? null);
        if (!clarification) return;
        if (event.response.status !== "completed") {
          const code = clarification.purpose === "decision_summary"
            ? "DECISION_SUMMARY_FAILED"
            : "CLARIFICATION_RESPONSE_FAILED";
          this.emit({ type: "error", code, retryable: true });
          this.finishClarificationResponse(event.response.id, clarification, false);
        } else if (clarification.purpose === "decision_summary") {
          this.finishClarificationResponse(event.response.id, clarification, false);
        }
        return;
      }
      case "output_audio_buffer.stopped": {
        const promptId = this.responsePromptIds.get(event.response_id);
        if (promptId) {
          this.finishPromptPlayback(promptId);
          return;
        }
        const clarification = this.clarificationResponses.get(event.response_id);
        if (clarification?.purpose === "clarification_response") {
          this.finishClarificationResponse(event.response_id, clarification, true);
        }
        return;
      }
    }
  }

  private sendClarificationResponse(): void {
    if (!this.activeClarification) throw new Error("No Lookahead clarification is active.");
    const event = createClarificationResponseEvent(
      this.activeClarification.approval,
      this.activeClarification.turns,
    );
    this.clarificationResponsePending = true;
    try {
      this.sendEvent(event);
    } catch (error) {
      this.clarificationResponsePending = false;
      throw error;
    }
  }

  private finishClarificationResponse(
    responseId: string,
    binding: ClarificationResponseBinding,
    resumeMicrophone: boolean,
  ): void {
    this.clarificationResponses.delete(responseId);
    this.outputTranscripts.delete(responseId);
    if (this.activeClarificationResponseId === responseId) {
      this.activeClarificationResponseId = null;
    }
    this.clarificationResponsePending = false;
    if (
      resumeMicrophone
      && this.activeClarification?.approval.roadmapItemId === binding.roadmapItemId
    ) {
      this.setMicrophoneEnabled(true);
    }
  }

  private createClarificationTurn(
    role: "product_manager" | "communicator",
    text: string,
  ): ClarificationTurn {
    this.clarificationTurnSequence += 1;
    return {
      id: `CLARIFICATION-${this.clarificationTurnSequence}`,
      role,
      text,
      createdAt: new Date().toISOString(),
    };
  }

  private requireActiveClarification(roadmapItemId: string): ActiveClarification {
    if (!this.activeClarification || this.activeClarification.approval.roadmapItemId !== roadmapItemId) {
      throw new Error("Clarification input does not match the active Lookahead Question.");
    }
    this.requireConnected();
    return this.activeClarification;
  }

  private requireConnected(): void {
    if (!this.sessionValidated || !this.dataChannel || this.dataChannel.readyState !== "open") {
      throw new Error("Realtime Communicator is not connected.");
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
    this.activeClarification = null;
    this.activeClarificationResponseId = null;
    this.clarificationResponsePending = false;
    this.clarificationTurnSequence = 0;
    this.expectedSession = null;
    this.responsePromptIds.clear();
    this.approvedQuestions.clear();
    this.outputTranscripts.clear();
    this.clarificationResponses.clear();
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

function getClarificationBinding(
  metadata: Record<string, string> | null | undefined,
  approval: LookaheadApproval | null,
): ClarificationResponseBinding | null {
  if (!approval) return null;
  const purpose = metadata?.purpose;
  if (purpose !== "clarification_response" && purpose !== "decision_summary") return null;
  if (
    metadata?.roadmapItemId !== approval.roadmapItemId
    || metadata.promptId !== approval.prompt.id
    || metadata.approvedAtRevision !== String(approval.approvedAtRevision)
    || metadata.dependencyVersion !== approval.dependencyVersion
  ) return null;
  return { purpose, roadmapItemId: approval.roadmapItemId };
}

function sameApproval(left: LookaheadApproval, right: LookaheadApproval): boolean {
  return left.roadmapItemId === right.roadmapItemId
    && left.prompt.id === right.prompt.id
    && left.approvedAtRevision === right.approvedAtRevision
    && left.dependencyVersion === right.dependencyVersion;
}

function normalizeProviderErrorCode(code: string | undefined): string {
  if (!code) return "REALTIME_UNAVAILABLE";
  const normalized = code.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
  return normalized || "REALTIME_UNAVAILABLE";
}

function normalizeSpeech(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "").toLocaleLowerCase("en");
}
