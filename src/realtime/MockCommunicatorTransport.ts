import { lookaheadApprovalSchema } from "@/domain/schemas";
import type { LookaheadApproval } from "@/domain/types";

import type {
  ClarificationCommunicatorTransport,
  CommunicatorEvent,
  CommunicatorSessionConfig,
  MicrophoneState,
} from "./CommunicatorTransport";

export interface MockCommunicatorTransportOptions {
  failConnection?: boolean;
  autoCompletePrompt?: boolean;
}

export class MockCommunicatorTransport implements ClarificationCommunicatorTransport {
  private readonly listeners = new Set<(event: CommunicatorEvent) => void>();
  private readonly failConnection: boolean;
  private readonly autoCompletePrompt: boolean;
  private microphoneState: MicrophoneState = "off";
  private connected = false;
  private activePromptId: string | null = null;
  private activeClarification: LookaheadApproval | null = null;
  private readonly clarificationTexts: string[] = [];

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

  getMicrophoneState(): MicrophoneState {
    return this.microphoneState;
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

  private requireActiveClarification(roadmapItemId: string): LookaheadApproval {
    if (!this.activeClarification || this.activeClarification.roadmapItemId !== roadmapItemId) {
      throw new Error("Clarification input does not match the active Lookahead Question.");
    }
    return this.activeClarification;
  }
}

function sameApproval(left: LookaheadApproval, right: LookaheadApproval): boolean {
  return left.roadmapItemId === right.roadmapItemId
    && left.prompt.id === right.prompt.id
    && left.approvedAtRevision === right.approvedAtRevision
    && left.dependencyVersion === right.dependencyVersion;
}
