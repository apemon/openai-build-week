import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MockCommunicatorTransport } from "@/realtime/MockCommunicatorTransport";
import { useCommunicator } from "@/realtime/useCommunicator";

const sessionConfig = {
  sessionId: "SESSION-123456789ABC",
  clientSecret: "temporary-test-value",
  realtimeModel: "gpt-realtime-2.1",
};

describe("useCommunicator", () => {
  it("creates a reviewable draft only for the active item ID", async () => {
    const transport = new MockCommunicatorTransport({ autoCompletePrompt: false });
    const onAnswerDraft = vi.fn();
    const { result } = renderHook(() => useCommunicator({ transport, onAnswerDraft }));

    await act(async () => {
      await result.current.connect(sessionConfig);
    });
    act(() => {
      result.current.presentPrompt("PROMPT-001", "What should happen?");
      result.current.answerNow();
      transport.simulateSpeechStarted("item_A");
      transport.simulateSpeechStopped("item_A");
      result.current.recordAgain();
      transport.simulateTranscriptCompleted("item_A", "Stale first turn.");
    });
    expect(result.current.answerDraft).toBeNull();

    act(() => {
      transport.setMicrophoneEnabled(true);
      transport.simulateSpeechStarted("item_B");
      transport.simulateSpeechStopped("item_B");
      transport.simulateTranscriptDelta("item_B", "Current ");
    });
    expect(result.current.transcriptPreview).toBe("Current ");
    act(() => {
      transport.simulateTranscriptCompleted("item_B", "Current reviewed turn.");
    });

    expect(result.current.answerDraft).toEqual({
      text: "Current reviewed turn.",
      source: "transcription",
      promptId: "PROMPT-001",
      transcriptionItemId: "item_B",
    });
    expect(result.current.microphoneState).toBe("reviewing_answer");
    expect(onAnswerDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps text fallback available after a reconnectable transport failure", async () => {
    const transport = new MockCommunicatorTransport({ failConnection: true });
    const { result } = renderHook(() => useCommunicator({ transport }));

    await act(async () => {
      expect(await result.current.connect(sessionConfig)).toBe(false);
    });
    expect(result.current.connectionState).toBe("text_fallback");
    expect(result.current.textFallbackAvailable).toBe(true);
    expect(result.current.error).toEqual({ code: "REALTIME_UNAVAILABLE", retryable: true });
  });

  it("keeps the microphone off when playback completes after text focus", async () => {
    const transport = new MockCommunicatorTransport({ autoCompletePrompt: false });
    const { result } = renderHook(() => useCommunicator({ transport }));

    await act(async () => {
      await result.current.connect(sessionConfig);
    });
    act(() => {
      result.current.presentPrompt("PROMPT-001", "What should happen?");
      result.current.pauseForTextInput();
    });
    expect(result.current.microphoneState).toBe("off");
    expect(transport.getMicrophoneState()).toBe("off");

    act(() => {
      transport.simulatePromptPlaybackDone("PROMPT-001");
    });
    expect(result.current.microphoneState).toBe("off");
    expect(transport.getMicrophoneState()).toBe("off");
  });

  it("clears an earlier text pause when a newly validated prompt is presented", async () => {
    const transport = new MockCommunicatorTransport({ autoCompletePrompt: false });
    const { result } = renderHook(() => useCommunicator({ transport }));

    await act(async () => {
      await result.current.connect(sessionConfig);
    });
    act(() => {
      result.current.pauseForTextInput();
      result.current.presentPrompt("PROMPT-002", "Which role should approve billing changes?");
      transport.simulatePromptPlaybackDone("PROMPT-002");
    });

    expect(result.current.microphoneState).toBe("listening");
    expect(transport.getMicrophoneState()).toBe("listening");
  });
});
