export type MicrophoneState = "off" | "listening" | "speech_detected" | "transcribing" | "reviewing_answer";

export type CommunicatorEvent =
  | { type: "connected" }
  | { type: "disconnected"; retryable: boolean }
  | { type: "speech_started"; itemId: string }
  | { type: "speech_stopped"; itemId: string }
  | { type: "transcript_delta"; itemId: string; delta: string }
  | { type: "transcript_completed"; itemId: string; transcript: string }
  | { type: "prompt_playback_started"; promptId: string }
  | { type: "prompt_playback_done"; promptId: string }
  | { type: "error"; code: string; retryable: boolean };

export interface CommunicatorSessionConfig {
  sessionId: string;
  clientSecret: string;
  realtimeModel: string;
}

export interface CommunicatorTransport {
  connect(config: CommunicatorSessionConfig): Promise<void>;
  disconnect(): void;
  setMicrophoneEnabled(enabled: boolean): void;
  speakPrompt(promptId: string, spokenQuestion: string): void;
  stopPlayback(): void;
  subscribe(listener: (event: CommunicatorEvent) => void): () => void;
  getMicrophoneState(): MicrophoneState;
}
