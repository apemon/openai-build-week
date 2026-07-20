import { describe, expect, it, vi } from "vitest";

import { initialInterviewPrompt } from "@/domain/initial-state";
import type { ExchangeIdentity, QuestionPermit } from "@/domain/v3-schemas";

import { OpenAIWebRTCTransport } from "./OpenAIWebRTCTransport";
import { createLockedRealtimeSession } from "./realtime-session";

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = "open";
  readonly sent: unknown[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = "closed";
  }

  emitProviderEvent(event: object): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
}

function permit(id = "PERMIT-001", ordinal: 1 | 2 | 3 = 1): QuestionPermit {
  return {
    id,
    windowId: "WINDOW-V3TEST",
    roadmapItemId: `ROADMAP-00${ordinal}`,
    prompt: {
      ...initialInterviewPrompt,
      id: "PROMPT-PERMITTED",
      decisionKey: "billing_roles",
      detailedQuestion: "Which roles may manage billing?",
      spokenQuestion: "Who may manage billing?",
      recommendation: null,
    },
    ordinal,
    approvedAtRevision: 2,
    dependencyVersion: "DEPENDENCY-2",
    independentOfOperation: "answer",
    invalidationItemIds: [],
    domainKeys: ["billing_permissions"],
  };
}

function identity(permitId = "PERMIT-001", cancelEpoch = 0): ExchangeIdentity {
  return {
    kind: "permitted",
    exchangeId: "EXCHANGE-V3TEST",
    promptId: "PROMPT-PERMITTED",
    permitId,
    cancelEpoch,
  };
}

describe("OpenAIWebRTCTransport V3 identity safety", () => {
  it("deduplicates provider events and preserves accepted speech behind a cancellation epoch", async () => {
    const dataChannel = new FakeDataChannel();
    const microphoneTrack = {
      enabled: false,
      readyState: "live",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const transport = new OpenAIWebRTCTransport({
      createPeerConnection: () => createPeerConnection(dataChannel),
      getUserMedia: vi.fn().mockResolvedValue({
        getAudioTracks: () => [microphoneTrack],
        getTracks: () => [microphoneTrack],
      } as unknown as MediaStream),
      fetch: vi.fn().mockResolvedValue(new Response("answer-sdp", { status: 200 })),
      createAudioElement: () => ({
        autoplay: false,
        srcObject: null,
        setAttribute: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
      }) as unknown as HTMLAudioElement,
    });
    const listener = vi.fn();
    transport.subscribeV3(listener);
    await transport.connect({
      sessionId: "SESSION-V3TEST",
      clientSecret: "temporary-test-value",
      realtimeModel: "gpt-realtime-2.1",
    });
    dataChannel.emitProviderEvent({
      event_id: "session-event",
      type: "session.created",
      session: createLockedRealtimeSession(),
    });

    transport.beginPermittedExchange(permit(), identity());
    const request = lastResponseCreate(dataChannel);
    expect(request.response.metadata).toMatchObject({
      purpose: "speak_brain_prompt",
      exchangeId: "EXCHANGE-V3TEST",
      promptId: "PROMPT-PERMITTED",
      permitId: "PERMIT-001",
      cancelEpoch: "0",
    });
    dataChannel.emitProviderEvent({
      event_id: "created-event",
      type: "response.created",
      response: { id: "response-1", metadata: request.response.metadata },
    });
    const playbackStarted = {
      event_id: "playback-started-event",
      type: "output_audio_buffer.started",
      response_id: "response-1",
    };
    dataChannel.emitProviderEvent(playbackStarted);
    dataChannel.emitProviderEvent(playbackStarted);
    expect(listener).toHaveBeenCalledTimes(1);
    dataChannel.emitProviderEvent({
      event_id: "playback-stopped-event",
      type: "output_audio_buffer.stopped",
      response_id: "response-1",
    });
    expect(transport.getMicrophoneState()).toBe("listening");

    const speechStarted = {
      event_id: "speech-started-event",
      type: "input_audio_buffer.speech_started",
      item_id: "item-1",
      audio_start_ms: 100,
    };
    dataChannel.emitProviderEvent(speechStarted);
    dataChannel.emitProviderEvent(speechStarted);
    expect(listener.mock.calls.filter(([event]) => event.type === "speech_started")).toHaveLength(1);
    dataChannel.emitProviderEvent({
      event_id: "speech-stopped-event",
      type: "input_audio_buffer.speech_stopped",
      item_id: "item-1",
      audio_end_ms: 500,
    });

    transport.pauseQuestions(1);
    expect(transport.getMicrophoneState()).toBe("off");
    dataChannel.emitProviderEvent({
      event_id: "transcript-completed-event",
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      content_index: 0,
      transcript: "Owners and Billing Admins.",
    });
    expect(listener).toHaveBeenCalledWith({
      type: "transcript_completed",
      itemId: "item-1",
      transcript: "Owners and Billing Admins.",
      identity: identity(),
      providerEventId: "transcript-completed-event",
    });
    expect(transport.getMicrophoneState()).toBe("off");

    const freshPermit = { ...permit("PERMIT-002"), approvedAtRevision: 3, dependencyVersion: "DEPENDENCY-3" };
    transport.resumeQuestions(freshPermit, identity("PERMIT-002", 1));
    expect(transport.getMicrophoneState()).toBe("listening");
    expect(() => transport.submitPermittedClarification("Late text", identity())).toThrow(
      "does not match the active Question Permit",
    );

    const freshIdentity = identity("PERMIT-002", 1);
    transport.submitPermittedClarification("Owners manage billing.", freshIdentity);
    const clarification = lastResponseCreate(dataChannel);
    expect(clarification.response.metadata).toMatchObject({
      purpose: "clarification_response",
      exchangeId: "EXCHANGE-V3TEST",
      permitId: "PERMIT-002",
      cancelEpoch: "1",
    });
    dataChannel.emitProviderEvent({
      event_id: "clarification-created",
      type: "response.created",
      response: { id: "response-clarification", metadata: clarification.response.metadata },
    });
    dataChannel.emitProviderEvent({
      event_id: "clarification-transcript",
      type: "response.output_audio_transcript.done",
      response_id: "response-clarification",
      item_id: "clarification-item",
      output_index: 0,
      content_index: 0,
      transcript: "I have enough to draft the Decision Summary.",
    });
    dataChannel.emitProviderEvent({
      event_id: "clarification-stopped",
      type: "output_audio_buffer.stopped",
      response_id: "response-clarification",
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: "clarification_response_done",
      identity: freshIdentity,
    }));

    transport.requestPermittedDecisionSummary(freshIdentity);
    const summary = lastResponseCreate(dataChannel);
    dataChannel.emitProviderEvent({
      event_id: "summary-created",
      type: "response.created",
      response: { id: "response-summary", metadata: summary.response.metadata },
    });
    dataChannel.emitProviderEvent({
      event_id: "summary-text",
      type: "response.output_text.done",
      response_id: "response-summary",
      item_id: "summary-item",
      output_index: 0,
      content_index: 0,
      text: '{"summary":"Owners manage billing.","uncertainties":[]}',
    });
    expect(listener).toHaveBeenCalledWith({
      type: "decision_summary_ready",
      text: "Owners manage billing.",
      uncertainties: [],
      identity: freshIdentity,
      providerEventId: "summary-text",
    });
  });
});

function createPeerConnection(dataChannel: FakeDataChannel): RTCPeerConnection {
  const target = new EventTarget();
  return {
    connectionState: "connected",
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => dataChannel),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "offer-sdp" }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  } as unknown as RTCPeerConnection;
}

function lastResponseCreate(dataChannel: FakeDataChannel): {
  type: "response.create";
  response: { metadata: Record<string, string> };
} {
  const value = [...dataChannel.sent].reverse().find((event) => Boolean(
    event && typeof event === "object" && "type" in event && event.type === "response.create",
  ));
  if (!value) throw new Error("Expected response.create.");
  return value as { type: "response.create"; response: { metadata: Record<string, string> } };
}
