import type {
  CommunicatorEvent,
  CommunicatorSessionConfig,
  CommunicatorTransport,
  MicrophoneState,
} from "./CommunicatorTransport";

export interface MockCommunicatorTransportOptions {
  failConnection?: boolean;
  autoCompletePrompt?: boolean;
}

export class MockCommunicatorTransport implements CommunicatorTransport {
  private readonly listeners = new Set<(event: CommunicatorEvent) => void>();
  private readonly failConnection: boolean;
  private readonly autoCompletePrompt: boolean;
  private microphoneState: MicrophoneState = "off";
  private connected = false;
  private activePromptId: string | null = null;

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
}
