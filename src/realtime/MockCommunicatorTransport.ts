import { lookaheadApprovalSchema } from "@/domain/schemas";
import type { LookaheadApproval } from "@/domain/types";
import {
  exchangeIdentitySchema,
  questionPermitSchema,
  type ExchangeIdentity,
  type QuestionPermit,
} from "@/domain/v3-schemas";

import type {
  ClarificationCommunicatorTransport,
  CommunicatorEvent,
  CommunicatorSessionConfig,
  MicrophoneState,
  V3CommunicatorEvent,
} from "./CommunicatorTransport";
import type { IdentitySafeCommunicatorTransport } from "./IdentitySafeCommunicatorTransport";

export interface MockCommunicatorTransportOptions {
  failConnection?: boolean;
  autoCompletePrompt?: boolean;
}

export class MockCommunicatorTransport implements ClarificationCommunicatorTransport, IdentitySafeCommunicatorTransport {
  private readonly listeners = new Set<(event: CommunicatorEvent) => void>();
  private readonly v3Listeners = new Set<(event: V3CommunicatorEvent) => void>();
  private readonly failConnection: boolean;
  private readonly autoCompletePrompt: boolean;
  private microphoneState: MicrophoneState = "off";
  private connected = false;
  private activePromptId: string | null = null;
  private activeClarification: LookaheadApproval | null = null;
  private readonly clarificationTexts: string[] = [];
  private activePermit: QuestionPermit | null = null;
  private activeIdentity: ExchangeIdentity | null = null;
  private cancelEpoch = 0;
  private questionsPaused = false;
  private acceptedCapturePending = false;
  private v3EventSequence = 0;

  constructor(options: MockCommunicatorTransportOptions = {}) {
    this.failConnection = options.failConnection ?? false;
    this.autoCompletePrompt = options.autoCompletePrompt ?? true;
  }

  async connect(config: CommunicatorSessionConfig): Promise<void> {
    void config;
    if (this.failConnection) {
      this.emit({ type: "error", code: "REALTIME_UNAVAILABLE", retryable: true });
      throw new Error("Realtime Communicator is unavailable.");
    }
    this.connected = true;
    this.emit({ type: "connected" });
  }

  disconnect(): void {
    this.connected = false;
    this.activePromptId = null;
    this.activeClarification = null;
    this.activePermit = null;
    this.activeIdentity = null;
    this.acceptedCapturePending = false;
    this.clarificationTexts.length = 0;
    this.microphoneState = "off";
    this.emit({ type: "disconnected", retryable: false });
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.microphoneState = enabled && this.connected ? "listening" : "off";
  }

  speakPrompt(promptId: string, spokenQuestion: string): void {
    void spokenQuestion;
    if (!this.connected) throw new Error("Realtime Communicator is not connected.");
    this.setMicrophoneEnabled(false);
    this.activePromptId = promptId;
    this.emit({ type: "prompt_playback_started", promptId });
    if (this.autoCompletePrompt) queueMicrotask(() => this.completePrompt());
  }

  stopPlayback(): void {
    this.completePrompt();
  }

  subscribe(listener: (event: CommunicatorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeV3(listener: (event: V3CommunicatorEvent) => void): () => void {
    this.v3Listeners.add(listener);
    return () => this.v3Listeners.delete(listener);
  }

  getMicrophoneState(): MicrophoneState {
    return this.microphoneState;
  }

  speakPromptWithIdentity(identity: ExchangeIdentity, spokenQuestion: string): void {
    void spokenQuestion;
    if (!this.connected) throw new Error("Realtime Communicator is not connected.");
    const parsed = exchangeIdentitySchema.parse(identity);
    if (parsed.kind !== "authoritative_or_app_prompt") {
      throw new Error("Authoritative prompt speech requires a non-permitted Exchange Identity.");
    }
    if (parsed.cancelEpoch !== this.cancelEpoch) throw new Error("Exchange cancellation epoch is stale.");
    if (this.activeIdentity) throw new Error("A different identity-bound exchange is already active.");
    this.activeIdentity = parsed;
    this.activePermit = null;
    this.setMicrophoneEnabled(false);
    this.emitV3({ type: "prompt_playback_started", identity: parsed, providerEventId: this.nextEventId() });
    if (this.autoCompletePrompt) queueMicrotask(() => this.completePermittedPrompt());
  }

  cancelAuthoritativeExchange(identity: ExchangeIdentity, nextCancelEpoch: number): void {
    const parsed = exchangeIdentitySchema.parse(identity);
    if (parsed.kind !== "authoritative_or_app_prompt" || !sameIdentity(parsed, this.activeIdentity)) {
      throw new Error("Exchange identity does not match the active authoritative prompt.");
    }
    this.cancelExchange(parsed, nextCancelEpoch);
  }

  beginPermittedExchange(permit: QuestionPermit, identity: ExchangeIdentity): void {
    if (!this.connected) throw new Error("Realtime Communicator is not connected.");
    const scope = parsePermittedScope(permit, identity);
    if (scope.identity.cancelEpoch !== this.cancelEpoch) throw new Error("Exchange cancellation epoch is stale.");
    if (this.activeIdentity && !sameIdentity(this.activeIdentity, scope.identity)) {
      throw new Error("A different permitted exchange is already active.");
    }
    this.activePermit = scope.permit;
    this.activeIdentity = scope.identity;
    this.questionsPaused = false;
    this.acceptedCapturePending = false;
    this.setMicrophoneEnabled(false);
    this.emitV3({ type: "prompt_playback_started", identity: scope.identity, providerEventId: this.nextEventId() });
    if (this.autoCompletePrompt) queueMicrotask(() => this.completePermittedPrompt());
  }

  submitPermittedClarification(text: string, identity: ExchangeIdentity): void {
    this.requireActiveIdentity(identity);
    const value = text.trim();
    if (!value || value.length > 4_000) throw new Error("Clarification text is invalid.");
    this.clarificationTexts.push(value);
    this.setMicrophoneEnabled(false);
  }

  requestPermittedDecisionSummary(identity: ExchangeIdentity): void {
    this.requireActiveIdentity(identity);
    if (this.clarificationTexts.length === 0) {
      throw new Error("A Decision Summary requires Product Manager clarification input.");
    }
    this.setMicrophoneEnabled(false);
  }

  pauseQuestions(nextCancelEpoch: number): void {
    this.advanceEpoch(nextCancelEpoch);
    this.questionsPaused = true;
    this.setMicrophoneEnabled(false);
  }

  resumeQuestions(permit: QuestionPermit, identity: ExchangeIdentity): void {
    const scope = parsePermittedScope(permit, identity);
    if (!this.questionsPaused || !this.activeIdentity || this.activeIdentity.exchangeId !== scope.identity.exchangeId) {
      throw new Error("The paused permitted exchange does not match the resume request.");
    }
    if (scope.identity.cancelEpoch !== this.cancelEpoch) throw new Error("Exchange cancellation epoch is stale.");
    const unchanged = this.activePermit?.prompt.id === scope.permit.prompt.id
      && this.activePermit.prompt.spokenQuestion === scope.permit.prompt.spokenQuestion
      && this.activePermit.prompt.detailedQuestion === scope.permit.prompt.detailedQuestion;
    this.activePermit = scope.permit;
    this.activeIdentity = scope.identity;
    this.questionsPaused = false;
    if (this.acceptedCapturePending) this.setMicrophoneEnabled(false);
    else if (unchanged) this.setMicrophoneEnabled(true);
    else {
      this.setMicrophoneEnabled(false);
      this.emitV3({ type: "prompt_playback_started", identity: scope.identity, providerEventId: this.nextEventId() });
    }
  }

  cancelExchange(identity: ExchangeIdentity, nextCancelEpoch: number): void {
    const parsed = exchangeIdentitySchema.parse(identity);
    if (!this.activeIdentity || !sameIdentity(parsed, this.activeIdentity)) {
      throw new Error("Exchange identity does not match the active Question Permit.");
    }
    this.advanceEpoch(nextCancelEpoch);
    this.activePermit = null;
    this.activeIdentity = null;
    this.questionsPaused = false;
    this.setMicrophoneEnabled(false);
  }

  beginClarification(approval: LookaheadApproval): void {
    if (!this.connected) throw new Error("Realtime Communicator is not connected.");
    const parsed = lookaheadApprovalSchema.parse(approval);
    if (this.activeClarification) {
      if (sameApproval(this.activeClarification, parsed)) return;
      throw new Error("A different Lookahead clarification is already active.");
    }
    this.activeClarification = parsed;
    this.clarificationTexts.length = 0;
    this.setMicrophoneEnabled(false);
  }

  submitClarificationText(roadmapItemId: string, text: string): void {
    this.requireActiveClarification(roadmapItemId);
    const value = text.trim();
    if (!value || value.length > 4_000) throw new Error("Clarification text is invalid.");
    this.clarificationTexts.push(value);
    this.setMicrophoneEnabled(false);
  }

  requestDecisionSummary(roadmapItemId: string): void {
    this.requireActiveClarification(roadmapItemId);
    if (this.clarificationTexts.length === 0) {
      throw new Error("A Decision Summary requires Product Manager clarification input.");
    }
    this.setMicrophoneEnabled(false);
  }

  stopClarification(): void {
    this.activeClarification = null;
    this.clarificationTexts.length = 0;
    this.activePromptId = null;
    this.setMicrophoneEnabled(false);
  }

  getSubmittedClarificationTexts(): string[] {
    return [...this.clarificationTexts];
  }

  simulateSpeechStarted(itemId: string): void {
    if (this.microphoneState !== "listening") return;
    this.microphoneState = "speech_detected";
    this.emit({ type: "speech_started", itemId });
  }

  simulateSpeechStopped(itemId: string): void {
    if (this.microphoneState !== "speech_detected") return;
    this.microphoneState = "transcribing";
    this.emit({ type: "speech_stopped", itemId });
  }

  simulateTranscriptDelta(itemId: string, delta: string): void {
    this.emit({ type: "transcript_delta", itemId, delta });
  }

  simulateTranscriptCompleted(itemId: string, transcript: string): void {
    this.microphoneState = "reviewing_answer";
    this.emit({ type: "transcript_completed", itemId, transcript: transcript.slice(0, 4_000) });
  }

  simulateClarificationResponse(text: string): void {
    if (!this.activeClarification) return;
    this.setMicrophoneEnabled(true);
    this.emit({
      type: "clarification_response_done",
      roadmapItemId: this.activeClarification.roadmapItemId,
      text: text.slice(0, 4_000),
    });
  }

  simulateDecisionSummary(text: string, uncertainties: string[] = []): void {
    if (!this.activeClarification) return;
    this.setMicrophoneEnabled(false);
    this.emit({
      type: "decision_summary_ready",
      roadmapItemId: this.activeClarification.roadmapItemId,
      text: text.slice(0, 4_000),
      uncertainties: uncertainties.slice(0, 20).map((uncertainty) => uncertainty.slice(0, 500)),
    });
  }

  simulateFailure(code = "REALTIME_UNAVAILABLE"): void {
    this.microphoneState = "off";
    this.emit({ type: "error", code, retryable: true });
  }

  simulatePermittedSpeechStarted(itemId: string, identity = this.activeIdentity): void {
    if (!identity || this.microphoneState !== "listening" || !sameIdentity(identity, this.activeIdentity)) return;
    this.microphoneState = "speech_detected";
    this.acceptedCapturePending = true;
    this.emitV3({ type: "speech_started", itemId, identity, providerEventId: this.nextEventId() });
  }

  simulatePermittedSpeechStopped(itemId: string, identity = this.activeIdentity): void {
    if (!identity || this.microphoneState !== "speech_detected") return;
    this.microphoneState = "transcribing";
    this.emitV3({ type: "speech_stopped", itemId, identity, providerEventId: this.nextEventId() });
  }

  simulatePermittedTranscriptCompleted(itemId: string, transcript: string, identity = this.activeIdentity): void {
    if (!identity) return;
    this.acceptedCapturePending = false;
    this.setMicrophoneEnabled(false);
    this.emitV3({
      type: "transcript_completed",
      itemId,
      transcript: transcript.slice(0, 4_000),
      identity,
      providerEventId: this.nextEventId(),
    });
  }

  simulatePermittedDecisionSummary(text: string, uncertainties: string[] = [], identity = this.activeIdentity): void {
    if (!identity || !sameIdentity(identity, this.activeIdentity)) return;
    this.emitV3({
      type: "decision_summary_ready",
      text: text.slice(0, 4_000),
      uncertainties: uncertainties.slice(0, 20).map((value) => value.slice(0, 500)),
      identity,
      providerEventId: this.nextEventId(),
    });
  }

  simulateV3Event(event: V3CommunicatorEvent): void {
    this.emitV3(event);
  }

  simulatePromptPlaybackDone(promptId: string): void {
    this.setMicrophoneEnabled(true);
    this.emit({ type: "prompt_playback_done", promptId });
  }

  private completePrompt(): void {
    if (!this.activePromptId) return;
    const promptId = this.activePromptId;
    this.activePromptId = null;
    this.setMicrophoneEnabled(true);
    this.emit({ type: "prompt_playback_done", promptId });
  }

  private emit(event: CommunicatorEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private emitV3(event: V3CommunicatorEvent): void {
    this.v3Listeners.forEach((listener) => listener(event));
  }

  private completePermittedPrompt(): void {
    if (!this.activeIdentity || this.questionsPaused) return;
    const identity = this.activeIdentity;
    this.setMicrophoneEnabled(true);
    this.emitV3({ type: "prompt_playback_done", identity, providerEventId: this.nextEventId() });
  }

  private requireActiveIdentity(identity: ExchangeIdentity): void {
    const parsed = exchangeIdentitySchema.parse(identity);
    if (!this.activeIdentity || !sameIdentity(parsed, this.activeIdentity)) {
      throw new Error("Exchange identity does not match the active Question Permit.");
    }
    if (parsed.cancelEpoch !== this.cancelEpoch) throw new Error("Exchange cancellation epoch is stale.");
  }

  private advanceEpoch(nextCancelEpoch: number): void {
    if (!Number.isInteger(nextCancelEpoch) || nextCancelEpoch <= this.cancelEpoch) {
      throw new Error("Cancellation epoch must advance monotonically.");
    }
    this.cancelEpoch = nextCancelEpoch;
  }

  private nextEventId(): string {
    this.v3EventSequence += 1;
    return `mock-event-${this.v3EventSequence}`;
  }

  private requireActiveClarification(roadmapItemId: string): LookaheadApproval {
    if (!this.activeClarification || this.activeClarification.roadmapItemId !== roadmapItemId) {
      throw new Error("Clarification input does not match the active Lookahead Question.");
    }
    return this.activeClarification;
  }
}

function parsePermittedScope(permit: QuestionPermit, identity: ExchangeIdentity) {
  const parsedPermit = questionPermitSchema.parse(permit);
  const parsedIdentity = exchangeIdentitySchema.parse(identity);
  if (
    parsedIdentity.kind !== "permitted"
    || parsedIdentity.permitId !== parsedPermit.id
    || parsedIdentity.promptId !== parsedPermit.prompt.id
  ) throw new Error("Exchange identity does not match the Question Permit.");
  return { permit: parsedPermit, identity: parsedIdentity };
}

function sameIdentity(left: ExchangeIdentity | null, right: ExchangeIdentity | null): boolean {
  return Boolean(
    left
    && right
    && left.kind === right.kind
    && left.exchangeId === right.exchangeId
    && left.promptId === right.promptId
    && left.permitId === right.permitId
    && left.cancelEpoch === right.cancelEpoch,
  );
}

function sameApproval(left: LookaheadApproval, right: LookaheadApproval): boolean {
  return left.roadmapItemId === right.roadmapItemId
    && left.prompt.id === right.prompt.id
    && left.approvedAtRevision === right.approvedAtRevision
    && left.dependencyVersion === right.dependencyVersion;
}
