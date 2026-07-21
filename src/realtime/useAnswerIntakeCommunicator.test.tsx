import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { initialInterviewPrompt } from "@/domain/initial-state";
import type { ExchangeIdentity } from "@/domain/v3-schemas";

import { MockCommunicatorTransport } from "./MockCommunicatorTransport";
import { useAnswerIntakeCommunicator } from "./useAnswerIntakeCommunicator";

const sessionConfig = {
  sessionId: "SESSION-ANSWER",
  clientSecret: "temporary-test-value",
  realtimeModel: "gpt-realtime-2.1",
};

const identity: ExchangeIdentity = {
  kind: "authoritative_or_app_prompt",
  exchangeId: "EXCHANGE-ANSWER",
  promptId: "PROMPT-INITIAL",
  permitId: null,
  cancelEpoch: 1,
};

function assessment(clarification: string | null) {
  return {
    summary: "Build a focused product interview.",
    coverage: [
      { aspectId: "ASPECT-001", status: "covered" as const },
      { aspectId: "ASPECT-002", status: clarification ? "missing" as const : "covered" as const },
    ],
    uncertainties: clarification ? ["The current pain is not yet stated."] : [],
    clarificationQuestion: clarification,
    clarificationAspectIds: clarification ? ["ASPECT-002"] : [],
  };
}

describe("useAnswerIntakeCommunicator", () => {
  it("collects three voice contributions, asks at most two clarifications, then publishes an editable summary", async () => {
    const transport = new MockCommunicatorTransport();
    const onAnswerDraft = vi.fn();
    const { result } = renderHook(() => useAnswerIntakeCommunicator({ transport, onAnswerDraft }));
    await act(async () => transport.connect(sessionConfig));
    act(() => result.current.beginAuthoritativeAnswer(initialInterviewPrompt, identity));
    await act(async () => Promise.resolve());

    for (let index = 1; index <= 3; index += 1) {
      act(() => {
        transport.simulatePermittedSpeechStarted(`item-${index}`, identity);
        transport.simulatePermittedSpeechStopped(`item-${index}`, identity);
        transport.simulatePermittedTranscriptCompleted(`item-${index}`, `Contribution ${index}.`, identity);
        transport.simulateAnswerIntakeAssessment(
          assessment(index < 3 ? "What current pain should this solve?" : "One more detail?"),
          identity,
        );
      });
      if (index < 3) act(() => transport.simulateAnswerClarificationDone(identity));
    }

    expect(result.current.contributionCount).toBe(3);
    expect(result.current.clarificationCount).toBe(2);
    expect(result.current.phase).toBe("reviewing_answer");
    expect(result.current.submitTypedContribution("A fourth contribution.")).toBe(false);
    expect(onAnswerDraft).toHaveBeenCalledTimes(1);
    expect(onAnswerDraft).toHaveBeenCalledWith(expect.objectContaining({
      source: "communicator_summary",
      text: "Build a focused product interview.",
      coverage: expect.arrayContaining([{ aspectId: "ASPECT-001", status: "covered" }]),
    }));
  });

  it("uses the same assessment path for typed input and truthfully falls back to exact wording", async () => {
    const transport = new MockCommunicatorTransport();
    const onAnswerDraft = vi.fn();
    const onFallback = vi.fn();
    const { result } = renderHook(() => useAnswerIntakeCommunicator({
      transport,
      onAnswerDraft,
      onFallback,
    }));
    await act(async () => transport.connect(sessionConfig));
    act(() => {
      result.current.beginAuthoritativeAnswer(initialInterviewPrompt, identity);
      result.current.answerAuthoritativeNow();
      result.current.submitTypedContribution("Use the exact typed wording.");
      transport.simulateFailure("ANSWER_INTAKE_ASSESSMENT_FAILED");
    });

    expect(result.current.phase).toBe("fallback");
    expect(result.current.coverageAssessed).toBe(false);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onAnswerDraft).toHaveBeenCalledWith({
      text: "Use the exact typed wording.",
      source: "typed",
      promptId: "PROMPT-INITIAL",
      transcriptionItemId: null,
    });
  });

  it("ignores a late assessment after early review and clears intake on finish", async () => {
    const transport = new MockCommunicatorTransport();
    const onAnswerDraft = vi.fn();
    const { result } = renderHook(() => useAnswerIntakeCommunicator({ transport, onAnswerDraft }));
    await act(async () => transport.connect(sessionConfig));
    act(() => {
      result.current.beginAuthoritativeAnswer(initialInterviewPrompt, identity);
      result.current.answerAuthoritativeNow();
      result.current.submitTypedContribution("Review this now.");
      result.current.reviewAnswerNow();
      transport.simulateAnswerIntakeAssessment(assessment(null), identity);
    });

    expect(onAnswerDraft).toHaveBeenCalledTimes(1);
    expect(onAnswerDraft).toHaveBeenCalledWith(expect.objectContaining({ text: "Review this now." }));
    act(() => result.current.finishAuthoritativeAnswer());
    expect(transport.getAnswerIntakeContributions()).toEqual([]);
    expect(result.current.phase).toBe("idle");
  });
});
