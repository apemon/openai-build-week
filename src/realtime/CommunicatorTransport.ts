import type { LookaheadApproval } from "@/domain/types";

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
  | { type: "clarification_response_done"; roadmapItemId: string; text: string }
  | { type: "decision_summary_ready"; roadmapItemId: string; text: string; uncertainties: string[] }
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

/** V2 capability layered on the V1 transport. Implementations must keep all
 * generated and captured clarification content non-authoritative until the
 * application confirms and revalidates a Decision Summary. */
export interface ClarificationCommunicatorTransport extends CommunicatorTransport {
  beginClarification(approval: LookaheadApproval): void;
  submitClarificationText(roadmapItemId: string, text: string): void;
  requestDecisionSummary(roadmapItemId: string): void;
  stopClarification(): void;
}
