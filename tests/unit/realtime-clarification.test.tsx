import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createClarificationResponseEvent,
  createDecisionSummaryResponseEvent,
  parseDecisionSummaryOutput,
} from "@/agents/communicator/clarification-presenter";
import { createTextFallbackDecisionSummary } from "@/agents/communicator/text-clarification-fallback";
import { initialInterviewPrompt } from "@/domain/initial-state";
import type { ClarificationTurn, LookaheadApproval } from "@/domain/types";
import { MockCommunicatorTransport } from "@/realtime/MockCommunicatorTransport";
import { parseRealtimeServerEvent } from "@/realtime/realtime-event-schemas";
import { useCommunicator } from "@/realtime/useCommunicator";

const sessionConfig = {
  sessionId: "SESSION-123456789ABC",
  clientSecret: "temporary-test-value",
  realtimeModel: "gpt-realtime-2.1",
};

function approval(roadmapItemId = "ROADMAP-001"): LookaheadApproval {
  return {
    roadmapItemId,
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

const turns: ClarificationTurn[] = [
  {
    id: "CLARIFICATION-1",
    role: "product_manager",
    text: "Workspace Owners and Billing Admins.",
    createdAt: "2026-07-20T00:00:00.000Z",
  },
];

describe("Realtime Lookahead clarification events", () => {
  it("binds every out-of-band response to one approved roadmap item", () => {
    const opening = createClarificationResponseEvent(approval(), []);
    expect(opening.response).toMatchObject({
      conversation: "none",
      metadata: {
        purpose: "clarification_response",
        roadmapItemId: "ROADMAP-001",
        promptId: "PROMPT-LOOKAHEAD",
        approvedAtRevision: "3",
        dependencyVersion: "DEPENDENCY-3",
      },
      output_modalities: ["audio"],
      tools: [],
    });
    expect(opening.response.instructions).toContain("Say exactly the approved spoken question");
    expect(opening.response.instructions).toContain("Do not discuss another decision");

    const followUp = createClarificationResponseEvent(approval(), turns);
    expect(followUp.response.instructions).toContain("Stay strictly within");
    expect(followUp.response.instructions).toContain("Never introduce another decision");
    expect(JSON.parse(followUp.response.input[0].content[0].text)).toMatchObject({
      approvedDecision: { roadmapItemId: "ROADMAP-001", decisionKey: "permissions" },
      clarificationTurns: [{ role: "product_manager", text: turns[0].text }],
    });
  });

  it("requests a text-only non-authoritative summary from PM turns and validates strict output", () => {
    const event = createDecisionSummaryResponseEvent(approval(), turns);
    expect(event.response.output_modalities).toEqual(["text"]);
    expect(event.response.conversation).toBe("none");
    expect(event.response.instructions).toContain("Use only product_manager clarification turns");
    expect(parseDecisionSummaryOutput('{"summary":"Owners manage billing.","uncertainties":[]}')).toEqual({
      text: "Owners manage billing.",
      uncertainties: [],
    });
    expect(parseDecisionSummaryOutput('{"summary":"Guess","uncertainties":[],"readiness":"ready"}')).toBeNull();
  });

  it("validates the text completion provider event used for Decision Summaries", () => {
    expect(parseRealtimeServerEvent({
      event_id: "event_1",
      type: "response.output_text.done",
      response_id: "response_1",
      item_id: "item_1",
      output_index: 0,
      content_index: 0,
      text: '{"summary":"Owners manage billing.","uncertainties":[]}',
    }).success).toBe(true);
  });
});

describe("text-only clarification fallback", () => {
  it("preserves PM wording verbatim without provider inference or a Brain call", () => {
    expect(createTextFallbackDecisionSummary(approval(), [
      "Owners manage plans.",
      "Billing Admins download invoices.",
    ])).toEqual({
      roadmapItemId: "ROADMAP-001",
      text: "Owners manage plans.\n\nBilling Admins download invoices.",
      uncertainties: [],
      provenance: "product_manager_text_only",
    });
  });

  it("refuses overflow instead of truncating PM text", () => {
    expect(() => createTextFallbackDecisionSummary(approval(), ["a".repeat(3_000), "b".repeat(3_000)]))
      .toThrow("exceeds the editable summary limit");
  });
});

describe("useCommunicator clarification routing", () => {
  it("routes a voice transcript into the active clarification without creating an Answer Draft", async () => {
    const transport = new MockCommunicatorTransport({ autoCompletePrompt: false });
    const onAnswerDraft = vi.fn();
    const onClarificationTranscript = vi.fn();
    const { result } = renderHook(() => useCommunicator({
      transport,
      onAnswerDraft,
      onClarificationTranscript,
    }));

    await act(async () => {
      await result.current.connect(sessionConfig);
    });
    act(() => {
      expect(result.current.beginClarification(approval())).toBe(true);
      transport.simulateClarificationResponse("Who may manage billing?");
      transport.simulateSpeechStarted("item_clarification");
      transport.simulateSpeechStopped("item_clarification");
      transport.simulateTranscriptCompleted("item_clarification", "Owners and Billing Admins.");
    });

    expect(result.current.answerDraft).toBeNull();
    expect(onAnswerDraft).not.toHaveBeenCalled();
    expect(onClarificationTranscript).toHaveBeenCalledWith({
      roadmapItemId: "ROADMAP-001",
      text: "Owners and Billing Admins.",
      source: "transcription",
    });
    expect(transport.getSubmittedClarificationTexts()).toEqual(["Owners and Billing Admins."]);
  });

  it("preserves an editable summary and text fallback when Realtime fails", async () => {
    const transport = new MockCommunicatorTransport({ autoCompletePrompt: false });
    const { result } = renderHook(() => useCommunicator({ transport }));

    await act(async () => {
      await result.current.connect(sessionConfig);
    });
    act(() => {
      result.current.beginClarification(approval());
      transport.simulateClarificationResponse("Who may manage billing?");
      result.current.submitClarificationText("Owners manage plans.");
      transport.simulateClarificationResponse("I have enough to draft the Decision Summary.");
      result.current.requestDecisionSummary();
      transport.simulateDecisionSummary("Owners manage plans.");
    });
    expect(result.current.decisionSummaryDraft?.text).toBe("Owners manage plans.");

    act(() => transport.simulateFailure());
    expect(result.current.connectionState).toBe("text_fallback");
    expect(result.current.decisionSummaryDraft?.text).toBe("Owners manage plans.");
    expect(result.current.textFallbackAvailable).toBe(true);
  });

  it("rejects a second topic and ignores a late transcript after stop", async () => {
    const transport = new MockCommunicatorTransport({ autoCompletePrompt: false });
    const { result } = renderHook(() => useCommunicator({ transport }));

    await act(async () => {
      await result.current.connect(sessionConfig);
    });
    act(() => {
      result.current.beginClarification(approval());
      expect(result.current.beginClarification(approval("ROADMAP-002"))).toBe(false);
      transport.simulateClarificationResponse("Who may manage billing?");
      transport.simulateSpeechStarted("item_late");
      transport.simulateSpeechStopped("item_late");
      result.current.stopClarification();
      transport.simulateTranscriptCompleted("item_late", "Late transcript.");
    });

    expect(result.current.activeClarificationItemId).toBeNull();
    expect(result.current.answerDraft).toBeNull();
    expect(transport.getSubmittedClarificationTexts()).toEqual([]);
  });
});
