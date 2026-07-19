import { describe, expect, it, vi } from "vitest";

import { createSpeakBrainPromptEvent } from "@/agents/communicator/prompt-presenter";
import { MockCommunicatorTransport } from "@/realtime/MockCommunicatorTransport";
import { createLockedRealtimeSession, isLockedRealtimeSession } from "@/realtime/realtime-session";

describe("Realtime session controls", () => {
  it("locks semantic VAD and separate transcription without automatic responses", () => {
    const session = createLockedRealtimeSession();
    expect(session.model).toBe("gpt-realtime-2.1");
    expect(session.audio.input.turn_detection).toEqual({
      type: "semantic_vad",
      eagerness: "medium",
      create_response: false,
      interrupt_response: false,
    });
    expect(session.audio.input.transcription).toEqual({
      model: "gpt-4o-transcribe",
      language: "en",
    });
    expect(session.tools).toEqual([]);
    expect(isLockedRealtimeSession(session, session)).toBe(true);
  });

  it("creates out-of-band prompt speech with no conversation mutation", () => {
    const event = createSpeakBrainPromptEvent("PROMPT-001", "Who may change the plan?");
    expect(event.response.conversation).toBe("none");
    expect(event.response.input).toEqual([]);
    expect(event.response.output_modalities).toEqual(["audio"]);
    expect(event.response.metadata).toEqual({
      purpose: "speak_brain_prompt",
      promptId: "PROMPT-001",
    });
    expect(event.response.instructions).toContain("Who may change the plan?");
  });

  it("gates the microphone during prompt playback and transcript review", async () => {
    const transport = new MockCommunicatorTransport({ autoCompletePrompt: false });
    const listener = vi.fn();
    transport.subscribe(listener);
    await transport.connect({
      sessionId: "SESSION-001",
      clientSecret: "temporary-test-value",
      realtimeModel: "gpt-realtime-2.1",
    });
    transport.setMicrophoneEnabled(true);
    transport.speakPrompt("PROMPT-001", "What should happen?");
    expect(transport.getMicrophoneState()).toBe("off");
    transport.stopPlayback();
    expect(transport.getMicrophoneState()).toBe("listening");
    transport.simulateSpeechStarted("item_1");
    transport.simulateSpeechStopped("item_1");
    transport.simulateTranscriptCompleted("item_1", "The editable draft.");
    expect(transport.getMicrophoneState()).toBe("reviewing_answer");
    expect(listener).toHaveBeenCalledWith({
      type: "transcript_completed",
      itemId: "item_1",
      transcript: "The editable draft.",
    });
  });
});
