import { describe, expect, it, vi } from "vitest";

import { initialInterviewPrompt } from "@/domain/initial-state";
import type { LookaheadApproval } from "@/domain/types";
import { OpenAIWebRTCTransport } from "@/realtime/OpenAIWebRTCTransport";
import { createLockedRealtimeSession } from "@/realtime/realtime-session";

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

function approval(): LookaheadApproval {
  return {
    roadmapItemId: "ROADMAP-001",
    prompt: {
      ...initialInterviewPrompt,
      id: "PROMPT-LOOKAHEAD",
      decisionKey: "permissions",
      detailedQuestion: "Which roles may manage billing?",
      spokenQuestion: "Who may manage billing?",
    },
    approvedAtRevision: 3,
    dependencyVersion: "DEPENDENCY-3",
    independentOfOperation: "answer",
  };
}

describe("OpenAIWebRTCTransport Lookahead clarification", () => {
  it("binds one exchange, routes provider output, validates the summary, and stops cleanly", async () => {
    const dataChannel = new FakeDataChannel();
    const microphoneTrack = {
      enabled: false,
      readyState: "live",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [microphoneTrack],
      getTracks: () => [microphoneTrack],
    } as unknown as MediaStream;
    const peer = createPeerConnection(dataChannel);
    const audio = {
      autoplay: false,
      srcObject: null,
      setAttribute: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLAudioElement;
    const transport = new OpenAIWebRTCTransport({
      createPeerConnection: () => peer,
      getUserMedia: vi.fn().mockResolvedValue(stream),
      fetch: vi.fn().mockResolvedValue(new Response("answer-sdp", { status: 200 })),
      createAudioElement: () => audio,
    });
    const listener = vi.fn();
    transport.subscribe(listener);

    await transport.connect({
      sessionId: "SESSION-123456789ABC",
      clientSecret: "temporary-test-value",
      realtimeModel: "gpt-realtime-2.1",
    });
    dataChannel.emitProviderEvent({
      event_id: "event_session",
      type: "session.created",
      session: createLockedRealtimeSession(),
    });
    expect(listener).toHaveBeenCalledWith({ type: "connected" });

    transport.beginClarification(approval());
    const opening = lastSentResponse(dataChannel);
    expect(opening.response).toMatchObject({
      conversation: "none",
      metadata: {
        purpose: "clarification_response",
        roadmapItemId: "ROADMAP-001",
        approvedAtRevision: "3",
        dependencyVersion: "DEPENDENCY-3",
      },
      output_modalities: ["audio"],
      tools: [],
    });

    completeAudioResponse(dataChannel, "response_opening", opening.response.metadata, "Who may manage billing?");
    expect(listener).toHaveBeenCalledWith({
      type: "clarification_response_done",
      roadmapItemId: "ROADMAP-001",
      text: "Who may manage billing?",
    });
    expect(transport.getMicrophoneState()).toBe("listening");

    transport.submitClarificationText("ROADMAP-001", "Owners and Billing Admins.");
    const followUp = lastSentResponse(dataChannel);
    const followUpInput = JSON.parse(followUp.response.input[0].content[0].text);
    expect(followUpInput.clarificationTurns).toEqual([
      { role: "communicator", text: "Who may manage billing?" },
      { role: "product_manager", text: "Owners and Billing Admins." },
    ]);
    completeAudioResponse(
      dataChannel,
      "response_follow_up",
      followUp.response.metadata,
      "I have enough to draft the Decision Summary.",
    );

    transport.requestDecisionSummary("ROADMAP-001");
    const summaryRequest = lastSentResponse(dataChannel);
    expect(summaryRequest.response.output_modalities).toEqual(["text"]);
    expect(summaryRequest.response.metadata.purpose).toBe("decision_summary");
    dataChannel.emitProviderEvent({
      event_id: "event_summary_created",
      type: "response.created",
      response: { id: "response_summary", metadata: summaryRequest.response.metadata },
    });
    dataChannel.emitProviderEvent({
      event_id: "event_summary_text",
      type: "response.output_text.done",
      response_id: "response_summary",
      item_id: "item_summary",
      output_index: 0,
      content_index: 0,
      text: '{"summary":"Owners and Billing Admins manage billing.","uncertainties":[]}',
    });
    dataChannel.emitProviderEvent({
      event_id: "event_summary_done",
      type: "response.done",
      response: { id: "response_summary", status: "completed", metadata: summaryRequest.response.metadata },
    });
    expect(listener).toHaveBeenCalledWith({
      type: "decision_summary_ready",
      roadmapItemId: "ROADMAP-001",
      text: "Owners and Billing Admins manage billing.",
      uncertainties: [],
    });

    transport.submitClarificationText("ROADMAP-001", "Owners alone may cancel.");
    transport.stopClarification();
    expect(transport.getMicrophoneState()).toBe("off");
    expect(dataChannel.sent).toContainEqual({ type: "output_audio_buffer.clear" });
    expect(() => transport.submitClarificationText("ROADMAP-001", "Late input.")).toThrow(
      "does not match the active Lookahead Question",
    );
  });

  it("rejects mismatched provider metadata and invalid model summary output", async () => {
    const dataChannel = new FakeDataChannel();
    const { transport } = await connectedTransport(dataChannel);
    const listener = vi.fn();
    transport.subscribe(listener);
    transport.beginClarification(approval());
    const opening = lastSentResponse(dataChannel);

    dataChannel.emitProviderEvent({
      event_id: "event_wrong_created",
      type: "response.created",
      response: {
        id: "response_wrong",
        metadata: { ...opening.response.metadata, dependencyVersion: "DEPENDENCY-WRONG" },
      },
    });
    dataChannel.emitProviderEvent({
      event_id: "event_wrong_transcript",
      type: "response.output_audio_transcript.done",
      response_id: "response_wrong",
      item_id: "item_wrong",
      output_index: 0,
      content_index: 0,
      transcript: "A different topic.",
    });
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: "clarification_response_done" }));

    completeAudioResponse(dataChannel, "response_opening", opening.response.metadata, "Who may manage billing?");
    transport.submitClarificationText("ROADMAP-001", "Owners manage billing.");
    const followUp = lastSentResponse(dataChannel);
    completeAudioResponse(dataChannel, "response_follow_up", followUp.response.metadata, "I have enough to draft the Decision Summary.");
    transport.requestDecisionSummary("ROADMAP-001");
    const summaryRequest = lastSentResponse(dataChannel);
    dataChannel.emitProviderEvent({
      event_id: "event_summary_created",
      type: "response.created",
      response: { id: "response_summary", metadata: summaryRequest.response.metadata },
    });
    dataChannel.emitProviderEvent({
      event_id: "event_invalid_summary",
      type: "response.output_text.done",
      response_id: "response_summary",
      item_id: "item_summary",
      output_index: 0,
      content_index: 0,
      text: "Owners manage billing.",
    });
    expect(listener).toHaveBeenCalledWith({
      type: "error",
      code: "INVALID_DECISION_SUMMARY",
      retryable: true,
    });
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: "decision_summary_ready" }));
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

async function connectedTransport(dataChannel: FakeDataChannel) {
  const microphoneTrack = {
    enabled: false,
    readyState: "live",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [microphoneTrack],
    getTracks: () => [microphoneTrack],
  } as unknown as MediaStream;
  const transport = new OpenAIWebRTCTransport({
    createPeerConnection: () => createPeerConnection(dataChannel),
    getUserMedia: vi.fn().mockResolvedValue(stream),
    fetch: vi.fn().mockResolvedValue(new Response("answer-sdp", { status: 200 })),
    createAudioElement: () => ({
      autoplay: false,
      srcObject: null,
      setAttribute: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    }) as unknown as HTMLAudioElement,
  });
  await transport.connect({
    sessionId: "SESSION-123456789ABC",
    clientSecret: "temporary-test-value",
    realtimeModel: "gpt-realtime-2.1",
  });
  dataChannel.emitProviderEvent({
    event_id: "event_session",
    type: "session.created",
    session: createLockedRealtimeSession(),
  });
  return { transport };
}

interface SentResponseCreateEvent {
  type: "response.create";
  response: {
    conversation: string;
    metadata: Record<string, string>;
    input: Array<{ content: Array<{ text: string }> }>;
    output_modalities: string[];
    tools: unknown[];
  };
}

function lastSentResponse(dataChannel: FakeDataChannel): SentResponseCreateEvent {
  const event = [...dataChannel.sent].reverse().find(isSentResponseCreateEvent);
  if (!event) throw new Error("Expected a captured response.create event.");
  return event;
}

function isSentResponseCreateEvent(value: unknown): value is SentResponseCreateEvent {
  return Boolean(
    value
    && typeof value === "object"
    && "type" in value
    && value.type === "response.create"
    && "response" in value
    && value.response
    && typeof value.response === "object",
  );
}

function completeAudioResponse(
  dataChannel: FakeDataChannel,
  responseId: string,
  metadata: Record<string, string>,
  transcript: string,
): void {
  dataChannel.emitProviderEvent({
    event_id: `${responseId}_created`,
    type: "response.created",
    response: { id: responseId, metadata },
  });
  dataChannel.emitProviderEvent({
    event_id: `${responseId}_started`,
    type: "output_audio_buffer.started",
    response_id: responseId,
  });
  dataChannel.emitProviderEvent({
    event_id: `${responseId}_transcript`,
    type: "response.output_audio_transcript.done",
    response_id: responseId,
    item_id: `${responseId}_item`,
    output_index: 0,
    content_index: 0,
    transcript,
  });
  dataChannel.emitProviderEvent({
    event_id: `${responseId}_stopped`,
    type: "output_audio_buffer.stopped",
    response_id: responseId,
  });
}
