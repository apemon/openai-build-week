import { createSpeakBrainPromptEvent } from "@/agents/communicator/prompt-presenter";
import {
  createClarificationResponseEvent,
  createDecisionSummaryResponseEvent,
  parseDecisionSummaryOutput,
} from "@/agents/communicator/clarification-presenter";
import {
  createV3AuthoritativePromptResponseEvent,
  createV3ClarificationResponseEvent,
  createV3DecisionSummaryResponseEvent,
  createV3PromptResponseEvent,
} from "@/agents/communicator/v3-presenter";
import {
  createAnswerClarificationPlaybackEvent,
  createAnswerIntakeAssessmentEvent,
} from "@/agents/communicator/answer-intake-presenter";
import {
  MAX_ANSWER_CLARIFICATIONS,
  MAX_ANSWER_INTAKE_CONTRIBUTIONS,
  validateAnswerIntakeAssessment,
} from "@/domain/answer-intake";
import { answerIntakeAssessmentSchema, interviewPromptSchema, lookaheadApprovalSchema } from "@/domain/schemas";
import {
  exchangeIdentitySchema,
  questionPermitSchema,
  type ExchangeIdentity,
  type QuestionPermit,
} from "@/domain/v3-schemas";
import type {
  AnswerIntakeAssessment,
  ClarificationTurn,
  InterviewPrompt,
  LookaheadApproval,
} from "@/domain/types";

import type {
  ClarificationCommunicatorTransport,
  CommunicatorEvent,
  CommunicatorSessionConfig,
  MicrophoneState,
  V3CommunicatorEvent,
} from "./CommunicatorTransport";
import { BoundedEventIdSet } from "./bounded-event-id-set";
import type { IdentitySafeCommunicatorTransport } from "./IdentitySafeCommunicatorTransport";
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
type V3Listener = (event: V3CommunicatorEvent) => void;

interface ActiveClarification {
  approval: LookaheadApproval;
  turns: ClarificationTurn[];
}

type ClarificationResponseBinding = {
  purpose: "clarification_response" | "decision_summary";
  roadmapItemId: string;
};

type V3ResponseBinding = {
  purpose:
    | "speak_brain_prompt"
    | "clarification_response"
    | "decision_summary"
    | "answer_intake_assessment"
    | "answer_clarification";
  identity: ExchangeIdentity;
  clarificationSequence: 1 | 2 | null;
  assessmentSequence: 1 | 2 | 3 | null;
  assessmentAttempt: 1 | 2 | null;
};

interface ActivePermittedExchange {
  permit: QuestionPermit;
  identity: ExchangeIdentity;
  turns: ClarificationTurn[];
  paused: boolean;
  responsePending: boolean;
}

interface CaptureBinding {
  itemId: string;
  identity: ExchangeIdentity;
  speechAccepted: boolean;
  preserveBehindRevalidation: boolean;
}

interface ActiveAnswerIntake {
  prompt: InterviewPrompt;
  identity: ExchangeIdentity;
  contributions: string[];
  latestAssessment: AnswerIntakeAssessment | null;
  assessmentPending: boolean;
  assessmentAttempt: 0 | 1 | 2;
  clarificationCount: number;
  promptPlaybackCancelled: boolean;
  cancelledClarificationSequences: Set<number>;
}

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

export class OpenAIWebRTCTransport implements ClarificationCommunicatorTransport, IdentitySafeCommunicatorTransport {
  private readonly createPeerConnection: () => RTCPeerConnection;
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly createAudioElement: () => HTMLAudioElement;
  private readonly listeners = new Set<Listener>();
  private readonly v3Listeners = new Set<V3Listener>();
  private readonly providerEventIds = new BoundedEventIdSet();
  private readonly responsePromptIds = new Map<string, string>();
  private readonly approvedQuestions = new Map<string, string>();
  private readonly outputTranscripts = new Map<string, string>();
  private readonly clarificationResponses = new Map<string, ClarificationResponseBinding>();
  private readonly v3Responses = new Map<string, V3ResponseBinding>();
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private microphoneState: MicrophoneState = "off";
  private activePromptId: string | null = null;
  private activeResponseId: string | null = null;
  private activeTranscriptionItemId: string | null = null;
  private activeClarification: ActiveClarification | null = null;
  private activePermittedExchange: ActivePermittedExchange | null = null;
  private activeAuthoritativeIdentity: ExchangeIdentity | null = null;
  private activeAnswerIntake: ActiveAnswerIntake | null = null;
  private captureBinding: CaptureBinding | null = null;
  private cancelEpoch = 0;
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

  subscribeV3(listener: V3Listener): () => void {
    this.v3Listeners.add(listener);
    return () => this.v3Listeners.delete(listener);
  }

  getMicrophoneState(): MicrophoneState {
    return this.microphoneState;
  }

  getLastPromptDeliveryDiagnostic(): PromptDeliveryDiagnostic | null {
    return this.lastPromptDelivery;
  }

  beginAuthoritativeAnswer(prompt: InterviewPrompt, identity: ExchangeIdentity): void {
    const parsedPrompt = interviewPromptSchema.parse(prompt);
    const parsedIdentity = parseAuthoritativeIdentity(identity, parsedPrompt.id);
    this.requireConnected();
    if (this.activePermittedExchange || this.activeClarification) {
      throw new Error("A different Communicator exchange is already active.");
    }
    if (this.activeAuthoritativeIdentity && !sameIdentity(this.activeAuthoritativeIdentity, parsedIdentity)) {
      this.stopProviderOutputBestEffort();
      this.removeV3ResponseBindings(this.activeAuthoritativeIdentity.exchangeId);
      this.clearAnswerIntakeMemory();
      this.activeAuthoritativeIdentity = null;
    }
    this.adoptEpochForNewExchange(parsedIdentity.cancelEpoch);
    if (this.activeAnswerIntake && sameIdentity(this.activeAnswerIntake.identity, parsedIdentity)) return;

    this.setMicrophoneEnabled(false);
    this.activeAuthoritativeIdentity = parsedIdentity;
    this.activeAnswerIntake = {
      prompt: parsedPrompt,
      identity: parsedIdentity,
      contributions: [],
      latestAssessment: null,
      assessmentPending: false,
      assessmentAttempt: 0,
      clarificationCount: 0,
      promptPlaybackCancelled: false,
      cancelledClarificationSequences: new Set(),
    };
    this.approvedQuestions.set(parsedIdentity.promptId, parsedPrompt.spokenQuestion.trim());
    try {
      this.sendEvent(createV3AuthoritativePromptResponseEvent(parsedIdentity, parsedPrompt.spokenQuestion));
    } catch (error) {
      this.clearAnswerIntakeMemory();
      this.activeAuthoritativeIdentity = null;
      throw error;
    }
  }

  answerAuthoritativeNow(identity: ExchangeIdentity): void {
    const active = this.requireActiveAnswerIntake(identity);
    active.promptPlaybackCancelled = true;
    if (active.clarificationCount > 0) {
      active.cancelledClarificationSequences.add(active.clarificationCount);
    }
    this.stopIdentityAudioBestEffort(identity.exchangeId);
    this.setMicrophoneEnabled(true);
  }

  submitAnswerIntakeContribution(text: string, identity: ExchangeIdentity): void {
    const active = this.requireActiveAnswerIntake(identity);
    if (active.assessmentPending) throw new Error("Answer Intake assessment is still running.");
    const contribution = text.trim();
    if (!contribution || contribution.length > 4_000) throw new Error("Answer Intake contribution is invalid.");
    if (active.contributions.length >= MAX_ANSWER_INTAKE_CONTRIBUTIONS) {
      throw new Error("Answer Intake has reached its contribution limit.");
    }
    active.contributions.push(contribution);
    active.assessmentPending = true;
    active.assessmentAttempt = 1;
    this.setMicrophoneEnabled(false);
    try {
      this.sendEvent(createAnswerIntakeAssessmentEvent(active.prompt, active.contributions, active.identity, 1));
    } catch (error) {
      active.contributions.pop();
      active.assessmentPending = false;
      throw error;
    }
  }

  speakAnswerClarification(
    question: string,
    aspectIds: string[],
    identity: ExchangeIdentity,
  ): void {
    const active = this.requireActiveAnswerIntake(identity);
    if (active.assessmentPending) throw new Error("Answer Intake assessment is still running.");
    if (active.clarificationCount >= MAX_ANSWER_CLARIFICATIONS) {
      throw new Error("Answer Intake has reached its clarification limit.");
    }
    const assessment = active.latestAssessment;
    if (
      !assessment?.clarificationQuestion
      || assessment.clarificationQuestion !== question.trim()
      || !sameStringMembers(assessment.clarificationAspectIds, aspectIds)
    ) throw new Error("Clarification does not match the latest validated Coverage Assessment.");
    const sequence = (active.clarificationCount + 1) as 1 | 2;
    this.setMicrophoneEnabled(false);
    this.sendEvent(createAnswerClarificationPlaybackEvent(question, aspectIds, sequence, active.identity));
    active.clarificationCount = sequence;
  }

  finishAuthoritativeAnswer(identity: ExchangeIdentity): void {
    this.requireActiveAnswerIntake(identity);
    this.stopProviderOutputBestEffort();
    this.removeV3ResponseBindings(identity.exchangeId);
    this.setMicrophoneEnabled(false);
    this.clearAnswerIntakeMemory();
    this.activeAuthoritativeIdentity = null;
    this.activeTranscriptionItemId = null;
    this.captureBinding = null;
  }

  speakPromptWithIdentity(identity: ExchangeIdentity, spokenQuestion: string): void {
    const parsedIdentity = exchangeIdentitySchema.parse(identity);
    if (parsedIdentity.kind !== "authoritative_or_app_prompt") {
      throw new Error("Authoritative prompt speech requires a non-permitted Exchange Identity.");
    }
    this.requireConnected();
    this.adoptEpochForNewExchange(parsedIdentity.cancelEpoch);
    if (this.activePermittedExchange || this.activeAuthoritativeIdentity) {
      throw new Error("A different identity-bound exchange is already active.");
    }
    this.setMicrophoneEnabled(false);
    this.activeAuthoritativeIdentity = parsedIdentity;
    this.approvedQuestions.set(parsedIdentity.promptId, spokenQuestion.trim());
    try {
      this.sendEvent(createV3AuthoritativePromptResponseEvent(parsedIdentity, spokenQuestion));
    } catch (error) {
      this.activeAuthoritativeIdentity = null;
      throw error;
    }
  }

  cancelAuthoritativeExchange(identity: ExchangeIdentity, nextCancelEpoch: number): void {
    const parsedIdentity = exchangeIdentitySchema.parse(identity);
    if (!this.activeAuthoritativeIdentity || !sameIdentity(this.activeAuthoritativeIdentity, parsedIdentity)) {
      throw new Error("Exchange identity does not match the active authoritative prompt.");
    }
    this.advanceCancellationEpoch(nextCancelEpoch);
    this.preserveAcceptedCapture();
    this.stopProviderOutputBestEffort();
    this.removeV3ResponseBindings(parsedIdentity.exchangeId);
    this.setMicrophoneEnabled(false);
    this.clearAnswerIntakeMemory();
    this.activeAuthoritativeIdentity = null;
  }

  beginPermittedExchange(permit: QuestionPermit, identity: ExchangeIdentity): void {
    const scope = parsePermittedScope(permit, identity);
    this.requireConnected();
    this.adoptEpochForNewExchange(scope.identity.cancelEpoch);
    if (this.activePermittedExchange) {
      if (sameIdentity(this.activePermittedExchange.identity, scope.identity)) return;
      throw new Error("A different permitted exchange is already active.");
    }
    if (this.activeClarification || this.activeAuthoritativeIdentity) {
      throw new Error("A different Communicator exchange is already active.");
    }

    this.setMicrophoneEnabled(false);
    this.activePermittedExchange = {
      permit: scope.permit,
      identity: scope.identity,
      turns: [],
      paused: false,
      responsePending: true,
    };
    try {
      this.sendEvent(createV3PromptResponseEvent(scope.permit, scope.identity));
    } catch (error) {
      this.activePermittedExchange = null;
      throw error;
    }
  }

  submitPermittedClarification(text: string, identity: ExchangeIdentity): void {
    const active = this.requireActivePermittedExchange(identity);
    if (active.paused) throw new Error("The permitted exchange is paused.");
    if (active.responsePending) throw new Error("The Communicator is still responding.");
    const value = text.trim();
    if (!value || value.length > 4_000) throw new Error("Clarification text is invalid.");
    if (active.turns.length >= 20) throw new Error("The clarification exchange has reached its turn limit.");

    active.turns.push(this.createClarificationTurn("product_manager", value));
    active.responsePending = true;
    this.setMicrophoneEnabled(false);
    try {
      this.sendEvent(createV3ClarificationResponseEvent(active.permit, active.identity, active.turns));
    } catch (error) {
      active.turns.pop();
      active.responsePending = false;
      throw error;
    }
  }

  requestPermittedDecisionSummary(identity: ExchangeIdentity): void {
    const active = this.requireActivePermittedExchange(identity);
    if (active.paused) throw new Error("The permitted exchange is paused.");
    if (active.responsePending) throw new Error("The Communicator is still responding.");
    active.responsePending = true;
    this.setMicrophoneEnabled(false);
    try {
      this.sendEvent(createV3DecisionSummaryResponseEvent(active.permit, active.identity, active.turns));
    } catch (error) {
      active.responsePending = false;
      throw error;
    }
  }

  pauseQuestions(nextCancelEpoch: number): void {
    this.advanceCancellationEpoch(nextCancelEpoch);
    const active = this.activePermittedExchange;
    if (active) active.paused = true;
    this.preserveAcceptedCapture();
    this.stopProviderOutputBestEffort();
    if (active) this.removeV3ResponseBindings(active.identity.exchangeId);
    this.setMicrophoneEnabled(false);
  }

  resumeQuestions(permit: QuestionPermit, identity: ExchangeIdentity): void {
    const scope = parsePermittedScope(permit, identity);
    this.requireConnected();
    this.requireCurrentEpoch(scope.identity.cancelEpoch);
    const active = this.activePermittedExchange;
    if (!active || !active.paused || active.identity.exchangeId !== scope.identity.exchangeId) {
      throw new Error("The paused permitted exchange does not match the resume request.");
    }

    const unchangedPrompt = active.permit.prompt.id === scope.permit.prompt.id
      && active.permit.prompt.spokenQuestion === scope.permit.prompt.spokenQuestion
      && active.permit.prompt.detailedQuestion === scope.permit.prompt.detailedQuestion;
    active.permit = scope.permit;
    active.identity = scope.identity;
    active.paused = false;
    active.responsePending = !unchangedPrompt;
    if (this.captureBinding?.preserveBehindRevalidation) {
      active.responsePending = false;
      this.setMicrophoneEnabled(false);
      return;
    }
    if (unchangedPrompt) {
      this.setMicrophoneEnabled(true);
      return;
    }
    this.setMicrophoneEnabled(false);
    this.sendEvent(createV3PromptResponseEvent(scope.permit, scope.identity));
  }

  cancelExchange(identity: ExchangeIdentity, nextCancelEpoch: number): void {
    const parsedIdentity = exchangeIdentitySchema.parse(identity);
    if (!this.activePermittedExchange || !sameIdentity(this.activePermittedExchange.identity, parsedIdentity)) {
      throw new Error("Exchange identity does not match the active Question Permit.");
    }
    this.advanceCancellationEpoch(nextCancelEpoch);
    this.preserveAcceptedCapture();
    this.stopProviderOutputBestEffort();
    this.setMicrophoneEnabled(false);
    this.activePermittedExchange = null;
    this.removeV3ResponseBindings(identity.exchangeId);
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
      if (!this.providerEventIds.addIfNew(parsed.event.event_id)) return;
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
        const captureIdentity = this.activePermittedExchange && !this.activePermittedExchange.paused
          ? this.activePermittedExchange.identity
          : this.activeAuthoritativeIdentity;
        if (captureIdentity) {
          this.captureBinding = {
            itemId: event.item_id,
            identity: captureIdentity,
            speechAccepted: true,
            preserveBehindRevalidation: false,
          };
          this.emitV3({
            type: "speech_started",
            itemId: event.item_id,
            identity: this.captureBinding.identity,
            providerEventId: event.event_id,
          });
        } else {
          this.emit({ type: "speech_started", itemId: event.item_id });
        }
        return;
      case "input_audio_buffer.speech_stopped":
        if (
          this.microphoneState !== "speech_detected" ||
          this.activeTranscriptionItemId !== event.item_id
        ) return;
        this.microphoneState = "transcribing";
        if (this.captureBinding?.itemId === event.item_id) {
          this.emitV3({
            type: "speech_stopped",
            itemId: event.item_id,
            identity: this.captureBinding.identity,
            providerEventId: event.event_id,
          });
        } else {
          this.emit({ type: "speech_stopped", itemId: event.item_id });
        }
        return;
      case "conversation.item.input_audio_transcription.delta":
        if (
          (
            this.microphoneState !== "transcribing"
            && this.microphoneState !== "speech_detected"
            && !this.captureBinding?.preserveBehindRevalidation
          ) ||
          this.activeTranscriptionItemId !== event.item_id
        ) {
          return;
        }
        if (this.captureBinding?.itemId === event.item_id) {
          this.emitV3({
            type: "transcript_delta",
            itemId: event.item_id,
            delta: event.delta,
            identity: this.captureBinding.identity,
            providerEventId: event.event_id,
          });
        } else {
          this.emit({ type: "transcript_delta", itemId: event.item_id, delta: event.delta });
        }
        return;
      case "conversation.item.input_audio_transcription.completed":
        if (
          (
            this.microphoneState !== "transcribing"
            && !this.captureBinding?.preserveBehindRevalidation
          ) ||
          this.activeTranscriptionItemId !== event.item_id
        ) return;
        this.setMicrophoneEnabled(false);
        this.microphoneState = this.activeClarification
          || this.activePermittedExchange
          || this.activeAuthoritativeIdentity
          ? "off"
          : "reviewing_answer";
        this.activeTranscriptionItemId = null;
        if (this.captureBinding?.itemId === event.item_id) {
          const binding = this.captureBinding;
          this.captureBinding = null;
          this.emitV3({
            type: "transcript_completed",
            itemId: event.item_id,
            transcript: event.transcript.slice(0, 4_000),
            identity: binding.identity,
            providerEventId: event.event_id,
          });
        } else {
          this.emit({
            type: "transcript_completed",
            itemId: event.item_id,
            transcript: event.transcript.slice(0, 4_000),
          });
        }
        return;
      case "response.created": {
        const v3Binding = getV3ResponseBinding(event.response.metadata, this.currentV3Identity());
        if (
          v3Binding
          && this.isCurrentV3Binding(v3Binding)
          && !this.isSuppressedAnswerAudio(v3Binding)
        ) {
          this.v3Responses.set(event.response.id, v3Binding);
          return;
        }
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
        const v3Binding = this.v3Responses.get(event.response_id);
        if (v3Binding) {
          if (!this.isCurrentV3Binding(v3Binding)) return;
          if (
            v3Binding.purpose === "decision_summary"
            || v3Binding.purpose === "answer_intake_assessment"
          ) return;
          void this.audioElement?.play().catch(() => {
            this.emit({ type: "error", code: "AUDIO_PLAYBACK_FAILED", retryable: true });
          });
          if (v3Binding.purpose === "speak_brain_prompt") {
            this.emitV3({
              type: "prompt_playback_started",
              identity: v3Binding.identity,
              providerEventId: event.event_id,
            });
          } else if (v3Binding.purpose === "answer_clarification") {
            this.emitV3({
              type: "answer_clarification_started",
              identity: v3Binding.identity,
              providerEventId: event.event_id,
            });
          }
          return;
        }
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
        const v3Binding = this.v3Responses.get(event.response_id);
        if (v3Binding && !this.isCurrentV3Binding(v3Binding)) return;
        if (
          !this.responsePromptIds.has(event.response_id)
          && !this.v3Responses.has(event.response_id)
          && this.clarificationResponses.get(event.response_id)?.purpose !== "clarification_response"
        ) return;
        const current = this.outputTranscripts.get(event.response_id) ?? "";
        this.outputTranscripts.set(event.response_id, `${current}${event.delta}`.slice(0, 4_000));
        return;
      }
      case "response.output_audio_transcript.done": {
        const v3Binding = this.v3Responses.get(event.response_id);
        if (v3Binding) {
          if (!this.isCurrentV3Binding(v3Binding)) return;
          if (v3Binding.purpose === "speak_brain_prompt") {
            const expected = this.activePermittedExchange?.permit.prompt.spokenQuestion
              ?? this.approvedQuestions.get(v3Binding.identity.promptId);
            this.lastPromptDelivery = {
              promptId: v3Binding.identity.promptId,
              matchedApprovedQuestion: expected
                ? normalizeSpeech(event.transcript) === normalizeSpeech(expected)
                : null,
            };
          } else if (v3Binding.purpose === "clarification_response") {
            const text = event.transcript.trim();
            if (!text || !this.activePermittedExchange) return;
            if (this.activePermittedExchange.turns.length < 20) {
              this.activePermittedExchange.turns.push(this.createClarificationTurn("communicator", text));
            }
            this.emitV3({
              type: "clarification_response_done",
              text,
              identity: v3Binding.identity,
              providerEventId: event.event_id,
            });
          } else if (v3Binding.purpose === "answer_clarification") {
            const expected = this.activeAnswerIntake?.latestAssessment?.clarificationQuestion;
            this.lastPromptDelivery = {
              promptId: v3Binding.identity.promptId,
              matchedApprovedQuestion: expected
                ? normalizeSpeech(event.transcript) === normalizeSpeech(expected)
                : null,
            };
          }
          this.outputTranscripts.delete(event.response_id);
          return;
        }
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
        const v3Binding = this.v3Responses.get(event.response_id);
        if (v3Binding) {
          if (!this.isCurrentV3Binding(v3Binding)) return;
          if (v3Binding.purpose === "answer_intake_assessment") {
            const active = this.activeAnswerIntake;
            if (!active || !sameIdentity(active.identity, v3Binding.identity)) return;
            const assessment = parseAnswerIntakeAssessment(event.text, active.prompt);
            if (!assessment) {
              if (active.assessmentAttempt === 1 && v3Binding.assessmentAttempt === 1) {
                active.assessmentAttempt = 2;
                this.v3Responses.delete(event.response_id);
                try {
                  this.sendEvent(createAnswerIntakeAssessmentEvent(
                    active.prompt,
                    active.contributions,
                    active.identity,
                    2,
                  ));
                  return;
                } catch {
                  // Fall through to the truthful unassessed fallback.
                }
              }
              active.assessmentPending = false;
              this.emit({ type: "error", code: "INVALID_ANSWER_INTAKE_ASSESSMENT", retryable: true });
              return;
            }
            active.latestAssessment = assessment;
            active.assessmentPending = false;
            this.emitV3({
              type: "answer_intake_assessed",
              assessment,
              identity: v3Binding.identity,
              providerEventId: event.event_id,
            });
            return;
          }
          if (v3Binding.purpose !== "decision_summary") return;
          const summary = parseDecisionSummaryOutput(event.text);
          if (!summary) {
            this.emit({ type: "error", code: "INVALID_DECISION_SUMMARY", retryable: true });
            return;
          }
          this.emitV3({
            type: "decision_summary_ready",
            text: summary.text,
            uncertainties: summary.uncertainties,
            identity: v3Binding.identity,
            providerEventId: event.event_id,
          });
          return;
        }
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
        const v3Binding = this.v3Responses.get(event.response.id);
        if (v3Binding) {
          if (!this.isCurrentV3Binding(v3Binding)) return;
          if (event.response.status !== "completed") {
            this.emit({
              type: "error",
              code: v3Binding.purpose === "decision_summary"
                ? "DECISION_SUMMARY_FAILED"
                : v3Binding.purpose === "answer_intake_assessment"
                  ? "ANSWER_INTAKE_ASSESSMENT_FAILED"
                  : v3Binding.purpose === "answer_clarification"
                    ? "ANSWER_CLARIFICATION_FAILED"
                : v3Binding.purpose === "clarification_response"
                  ? "CLARIFICATION_RESPONSE_FAILED"
                  : "PROMPT_PLAYBACK_FAILED",
              retryable: true,
            });
            this.finishV3Response(event.response.id, v3Binding, false, event.event_id);
          } else if (
            v3Binding.purpose === "decision_summary"
            || v3Binding.purpose === "answer_intake_assessment"
          ) {
            this.finishV3Response(event.response.id, v3Binding, false, event.event_id);
          }
          return;
        }
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
        const v3Binding = this.v3Responses.get(event.response_id);
        if (v3Binding) {
          if (!this.isCurrentV3Binding(v3Binding)) return;
          this.finishV3Response(event.response_id, v3Binding, true, event.event_id);
          return;
        }
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

  private finishV3Response(
    responseId: string,
    binding: V3ResponseBinding,
    resumeMicrophone: boolean,
    providerEventId: string,
  ): void {
    this.v3Responses.delete(responseId);
    this.outputTranscripts.delete(responseId);
    const active = this.activePermittedExchange;
    const authoritative = this.activeAuthoritativeIdentity;
    if (
      (!active || !sameIdentity(active.identity, binding.identity))
      && (!authoritative || !sameIdentity(authoritative, binding.identity))
    ) return;
    if (active) active.responsePending = false;
    if (
      binding.purpose === "answer_intake_assessment"
      && this.activeAnswerIntake
      && sameIdentity(this.activeAnswerIntake.identity, binding.identity)
    ) {
      this.activeAnswerIntake.assessmentPending = false;
      this.activeAnswerIntake.assessmentAttempt = 0;
    }
    if (binding.purpose === "speak_brain_prompt") {
      this.emitV3({
        type: "prompt_playback_done",
        identity: binding.identity,
        providerEventId,
      });
    } else if (binding.purpose === "answer_clarification") {
      this.emitV3({
        type: "answer_clarification_done",
        identity: binding.identity,
        providerEventId,
      });
    }
    if (
      resumeMicrophone
      && (!active || !active.paused)
      && !this.captureBinding?.preserveBehindRevalidation
    ) {
      this.setMicrophoneEnabled(true);
    }
  }

  private requireActivePermittedExchange(identity: ExchangeIdentity): ActivePermittedExchange {
    const parsedIdentity = exchangeIdentitySchema.parse(identity);
    const active = this.activePermittedExchange;
    if (!active || !sameIdentity(active.identity, parsedIdentity)) {
      throw new Error("Exchange identity does not match the active Question Permit.");
    }
    this.requireConnected();
    this.requireCurrentEpoch(parsedIdentity.cancelEpoch);
    return active;
  }

  private requireActiveAnswerIntake(identity: ExchangeIdentity): ActiveAnswerIntake {
    const parsedIdentity = parseAuthoritativeIdentity(identity);
    const active = this.activeAnswerIntake;
    if (!active || !sameIdentity(active.identity, parsedIdentity)) {
      throw new Error("Exchange identity does not match the active Answer Intake.");
    }
    this.requireConnected();
    this.requireCurrentEpoch(parsedIdentity.cancelEpoch);
    return active;
  }

  private requireCurrentEpoch(epoch: number): void {
    if (epoch !== this.cancelEpoch) {
      throw new Error("Exchange cancellation epoch is stale.");
    }
  }

  private adoptEpochForNewExchange(epoch: number): void {
    if (epoch === this.cancelEpoch) return;
    if (
      !Number.isInteger(epoch)
      || epoch < this.cancelEpoch
      || this.activePermittedExchange
      || this.activeAuthoritativeIdentity
    ) {
      throw new Error("Exchange cancellation epoch is stale.");
    }
    this.cancelEpoch = epoch;
  }

  private advanceCancellationEpoch(nextCancelEpoch: number): void {
    if (!Number.isInteger(nextCancelEpoch) || nextCancelEpoch <= this.cancelEpoch) {
      throw new Error("Cancellation epoch must advance monotonically.");
    }
    // This assignment intentionally precedes every provider cancellation/clear.
    this.cancelEpoch = nextCancelEpoch;
  }

  private preserveAcceptedCapture(): void {
    if (this.captureBinding?.speechAccepted) {
      this.captureBinding.preserveBehindRevalidation = true;
    } else {
      this.activeTranscriptionItemId = null;
      this.captureBinding = null;
    }
  }

  private stopProviderOutputBestEffort(): void {
    try {
      this.sendEvent({ type: "response.cancel" });
      this.sendEvent({ type: "output_audio_buffer.clear" });
    } catch {
      // Epoch and local identity gates are the correctness boundary.
    }
    this.audioElement?.pause();
  }

  private stopIdentityAudioBestEffort(exchangeId: string): void {
    let foundAudioBinding = false;
    for (const [responseId, binding] of this.v3Responses) {
      if (
        binding.identity.exchangeId === exchangeId
        && (binding.purpose === "speak_brain_prompt" || binding.purpose === "answer_clarification")
      ) {
        foundAudioBinding = true;
        try {
          this.sendEvent({ type: "response.cancel", response_id: responseId });
        } catch {
          // Local identity removal remains authoritative.
        }
        this.v3Responses.delete(responseId);
        this.outputTranscripts.delete(responseId);
      }
    }
    try {
      if (!foundAudioBinding && !this.activeAnswerIntake?.assessmentPending) {
        this.sendEvent({ type: "response.cancel" });
      }
      this.sendEvent({ type: "output_audio_buffer.clear" });
    } catch {
      // Microphone gating remains authoritative after a transport race.
    }
    this.audioElement?.pause();
  }

  private isCurrentV3Binding(binding: V3ResponseBinding): boolean {
    const active = this.activePermittedExchange;
    const authoritative = this.activeAuthoritativeIdentity;
    const identityCurrent = Boolean(
      (
        (active && !active.paused && sameIdentity(active.identity, binding.identity))
        || (authoritative && sameIdentity(authoritative, binding.identity))
      )
      && binding.identity.cancelEpoch === this.cancelEpoch,
    );
    if (!identityCurrent) return false;
    if (binding.purpose === "answer_intake_assessment") {
      return Boolean(
        this.activeAnswerIntake
        && binding.assessmentSequence === this.activeAnswerIntake.contributions.length
        && binding.assessmentAttempt === this.activeAnswerIntake.assessmentAttempt
      );
    }
    if (binding.purpose === "answer_clarification") {
      return Boolean(
        this.activeAnswerIntake
        && binding.clarificationSequence === this.activeAnswerIntake.clarificationCount,
      );
    }
    return true;
  }

  private currentV3Identity(): ExchangeIdentity | null {
    return this.activePermittedExchange?.identity ?? this.activeAuthoritativeIdentity;
  }

  private isSuppressedAnswerAudio(binding: V3ResponseBinding): boolean {
    const active = this.activeAnswerIntake;
    if (!active || !sameIdentity(active.identity, binding.identity)) return false;
    if (binding.purpose === "speak_brain_prompt") return active.promptPlaybackCancelled;
    return binding.purpose === "answer_clarification"
      && binding.clarificationSequence !== null
      && active.cancelledClarificationSequences.has(binding.clarificationSequence);
  }

  private removeV3ResponseBindings(exchangeId: string): void {
    for (const [responseId, binding] of this.v3Responses) {
      if (binding.identity.exchangeId === exchangeId) {
        this.v3Responses.delete(responseId);
        this.outputTranscripts.delete(responseId);
      }
    }
  }

  private clearAnswerIntakeMemory(): void {
    if (!this.activeAnswerIntake) return;
    this.activeAnswerIntake.contributions.length = 0;
    this.activeAnswerIntake.latestAssessment = null;
    this.activeAnswerIntake.assessmentPending = false;
    this.activeAnswerIntake = null;
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
    this.activePermittedExchange = null;
    this.activeAuthoritativeIdentity = null;
    this.clearAnswerIntakeMemory();
    this.captureBinding = null;
    this.cancelEpoch = 0;
    this.activeClarificationResponseId = null;
    this.clarificationResponsePending = false;
    this.clarificationTurnSequence = 0;
    this.expectedSession = null;
    this.responsePromptIds.clear();
    this.approvedQuestions.clear();
    this.outputTranscripts.clear();
    this.clarificationResponses.clear();
    this.v3Responses.clear();
    this.providerEventIds.clear();
    if (emitDisconnected) this.emit({ type: "disconnected", retryable: false });
  }

  private emit(event: CommunicatorEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private emitV3(event: V3CommunicatorEvent): void {
    this.v3Listeners.forEach((listener) => listener(event));
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

function getV3ResponseBinding(
  metadata: Record<string, string> | null | undefined,
  activeIdentity: ExchangeIdentity | null,
): V3ResponseBinding | null {
  if (!activeIdentity) return null;
  const purpose = metadata?.purpose;
  if (
    purpose !== "speak_brain_prompt"
    && purpose !== "clarification_response"
    && purpose !== "decision_summary"
    && purpose !== "answer_intake_assessment"
    && purpose !== "answer_clarification"
  ) return null;
  const cancelEpoch = Number(metadata?.cancelEpoch);
  const identity = exchangeIdentitySchema.safeParse({
    kind: metadata?.identityKind,
    exchangeId: metadata?.exchangeId,
    promptId: metadata?.promptId,
    permitId: metadata?.permitId || null,
    cancelEpoch,
  });
  if (!identity.success || !sameIdentity(identity.data, activeIdentity)) return null;
  const clarificationSequence = purpose === "answer_clarification"
    ? Number(metadata?.clarificationSequence)
    : null;
  if (
    purpose === "answer_clarification"
    && clarificationSequence !== 1
    && clarificationSequence !== 2
  ) return null;
  const assessmentSequence = purpose === "answer_intake_assessment"
    ? Number(metadata?.assessmentSequence)
    : null;
  if (
    purpose === "answer_intake_assessment"
    && assessmentSequence !== 1
    && assessmentSequence !== 2
    && assessmentSequence !== 3
  ) return null;
  const assessmentAttempt = purpose === "answer_intake_assessment"
    ? Number(metadata?.assessmentAttempt ?? "1")
    : null;
  if (
    purpose === "answer_intake_assessment"
    && assessmentAttempt !== 1
    && assessmentAttempt !== 2
  ) return null;
  return {
    purpose,
    identity: identity.data,
    clarificationSequence: clarificationSequence as 1 | 2 | null,
    assessmentSequence: assessmentSequence as 1 | 2 | 3 | null,
    assessmentAttempt: assessmentAttempt as 1 | 2 | null,
  };
}

function parsePermittedScope(permit: QuestionPermit, identity: ExchangeIdentity) {
  const parsedPermit = questionPermitSchema.parse(permit);
  const parsedIdentity = exchangeIdentitySchema.parse(identity);
  if (
    parsedIdentity.kind !== "permitted"
    || parsedIdentity.permitId !== parsedPermit.id
    || parsedIdentity.promptId !== parsedPermit.prompt.id
  ) {
    throw new Error("Exchange identity does not match the Question Permit.");
  }
  return { permit: parsedPermit, identity: parsedIdentity };
}

function parseAuthoritativeIdentity(identity: ExchangeIdentity, expectedPromptId?: string) {
  const parsed = exchangeIdentitySchema.parse(identity);
  if (
    parsed.kind !== "authoritative_or_app_prompt"
    || parsed.permitId !== null
    || (expectedPromptId !== undefined && parsed.promptId !== expectedPromptId)
  ) {
    throw new Error("Exchange identity does not match the authoritative Interview Prompt.");
  }
  return parsed;
}

export function parseAnswerIntakeAssessment(
  value: string,
  prompt: InterviewPrompt,
): AnswerIntakeAssessment | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(unwrapJsonObject(value));
  } catch {
    return null;
  }
  const strict = answerIntakeAssessmentSchema.safeParse(candidate);
  if (!strict.success) return null;
  const validated = validateAnswerIntakeAssessment(prompt, strict.data);
  return validated.valid ? validated.assessment : null;
}

function unwrapJsonObject(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Realtime text can wrap an otherwise exact object in prose. The wrapper is
    // discarded as untrusted; only one embedded object may proceed to strict
    // schema and exact Answer Aspect membership validation.
  }
  const objects = findEmbeddedJsonObjects(trimmed);
  return objects.length === 1 ? objects[0] : trimmed;
}

function findEmbeddedJsonObjects(value: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start < 0) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth !== 0) continue;
      const candidate = value.slice(start, index + 1);
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) objects.push(candidate);
      } catch {
        // Continue scanning for one later complete object.
      }
      start = -1;
      inString = false;
      escaped = false;
    }
  }
  return objects;
}

function sameStringMembers(left: string[], right: string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

function sameIdentity(left: ExchangeIdentity, right: ExchangeIdentity): boolean {
  return left.kind === right.kind
    && left.exchangeId === right.exchangeId
    && left.promptId === right.promptId
    && left.permitId === right.permitId
    && left.cancelEpoch === right.cancelEpoch;
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
