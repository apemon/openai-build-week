import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logBrainSubmission } from "@/agents/brain/debug-log";
import { createV3BrainRequest } from "@/app/brain-client";
import { validateAnswerIntakeAssessment } from "@/domain/answer-intake";
import { createInitialContextDigest, createInitialState, initialInterviewPrompt } from "@/domain/initial-state";
import { sessionReducer } from "@/domain/session-reducer";
import type { AnswerIntakeAssessment, ConversationTurn, SessionState } from "@/domain/types";
import type { ExchangeIdentity } from "@/domain/v3-schemas";
import { specificationToMarkdown } from "@/export/to-markdown";
import { createV3Checkpoint } from "@/lib/session-checkpoint";
import { MockCommunicatorTransport } from "@/realtime/MockCommunicatorTransport";
import { useAnswerIntakeCommunicator } from "@/realtime/useAnswerIntakeCommunicator";

const now = new Date("2026-07-21T00:00:00.000Z");
const identity: ExchangeIdentity = {
  kind: "authoritative_or_app_prompt",
  exchangeId: "EXCHANGE-ANSWER-VERIFY",
  promptId: initialInterviewPrompt.id,
  permitId: null,
  cancelEpoch: 1,
};
const exactAssessment: AnswerIntakeAssessment = {
  summary: "Build a focused product interview for vague requirements.",
  coverage: [
    { aspectId: "ASPECT-001", status: "covered" },
    { aspectId: "ASPECT-002", status: "covered" },
  ],
  uncertainties: [],
  clarificationQuestion: null,
  clarificationAspectIds: [],
};

afterEach(() => {
  delete process.env.BRAIN_DEBUG_LOGS;
  vi.restoreAllMocks();
});

async function connectedHarness() {
  const transport = new MockCommunicatorTransport();
  const onAnswerDraft = vi.fn();
  const hook = renderHook(() => useAnswerIntakeCommunicator({ transport, onAnswerDraft }));
  await act(async () => transport.connect({
    sessionId: "SESSION-ANSWER-VERIFY",
    clientSecret: "temporary-test-value",
    realtimeModel: "gpt-realtime-2.1",
  }));
  act(() => hook.result.current.beginAuthoritativeAnswer(initialInterviewPrompt, identity));
  await act(async () => Promise.resolve());
  return { ...hook, transport, onAnswerDraft };
}

describe("V3.1 Answer Intake authority and privacy", () => {
  it("keeps a finalized transcript in intake until an exact assessment creates a summary draft", async () => {
    const { result, transport, onAnswerDraft } = await connectedHarness();

    act(() => {
      transport.simulatePermittedSpeechStarted("item-finalized", identity);
      transport.simulatePermittedSpeechStopped("item-finalized", identity);
      transport.simulatePermittedTranscriptCompleted("item-finalized", "Raw finalized contribution.", identity);
    });

    expect(result.current.phase).toBe("assessing");
    expect(onAnswerDraft).not.toHaveBeenCalled();
    expect(transport.getAnswerIntakeContributions()).toEqual(["Raw finalized contribution."]);

    act(() => transport.simulateAnswerIntakeAssessment(exactAssessment, identity));
    expect(onAnswerDraft).toHaveBeenCalledOnce();
    expect(onAnswerDraft).toHaveBeenCalledWith(expect.objectContaining({
      source: "communicator_summary",
      text: exactAssessment.summary,
      coverage: exactAssessment.coverage,
    }));
  });

  it("rejects non-exact coverage and ignores an assessment that arrives after early review", async () => {
    expect(validateAnswerIntakeAssessment(initialInterviewPrompt, {
      ...exactAssessment,
      coverage: [
        { aspectId: "ASPECT-001", status: "covered" },
        { aspectId: "ASPECT-999", status: "missing" },
      ],
    }).errors).toEqual(expect.arrayContaining([
      "ASPECT-002: missing coverage assessment",
      "ASPECT-999: unknown coverage assessment",
    ]));

    const { result, transport, onAnswerDraft } = await connectedHarness();
    act(() => {
      result.current.answerAuthoritativeNow();
      result.current.submitTypedContribution("Review this exact wording early.");
      result.current.reviewAnswerNow();
      transport.simulateAnswerIntakeAssessment(exactAssessment, identity);
    });

    expect(onAnswerDraft).toHaveBeenCalledOnce();
    expect(onAnswerDraft).toHaveBeenCalledWith(expect.objectContaining({
      source: "typed",
      text: "Review this exact wording early.",
    }));
    expect(result.current.coverageAssessed).toBe(false);
  });

  it("excludes raw intake from checkpoint, Brain request, content-free log, and export", () => {
    const rawIntake = "LEAK_SENTINEL_RAW_ANSWER_INTAKE";
    const editedSummary = "Build a focused interview and preserve explicit Product Manager confirmation.";
    let state: SessionState = {
      ...createInitialState("live", now),
      phase: "collecting_answer" as const,
      confirmedContextDigest: createInitialContextDigest(now),
    };
    state = sessionReducer(state, {
      type: "ANSWER_DRAFT_READY",
      draft: {
        text: rawIntake,
        source: "communicator_summary",
        promptId: initialInterviewPrompt.id,
        transcriptionItemId: null,
        coverage: exactAssessment.coverage,
        uncertainties: [],
      },
    });
    state = sessionReducer(state, { type: "ANSWER_DRAFT_EDITED", text: editedSummary });
    const confirmedTurn: ConversationTurn = {
      id: "TURN-CONFIRMED-SUMMARY",
      promptId: initialInterviewPrompt.id,
      type: "confirmed_answer",
      text: state.answerDraft!.text,
      createdAt: now.toISOString(),
    };

    const checkpoint = createV3Checkpoint(
      state,
      [],
      { eligibleOutcomes: [], applicationCap: 1, singletonRecoveryStreak: 0 },
      now,
    );
    const request = createV3BrainRequest(state, "REQUEST-CONFIRMED-SUMMARY", "answer", [], {
      actionId: "ACTION-CONFIRMED-SUMMARY",
      cancelEpoch: 1,
      requestedApplicationCap: 1,
      turn: confirmedTurn,
    });
    process.env.BRAIN_DEBUG_LOGS = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logBrainSubmission({
      event: "submitted",
      requestId: request.requestId,
      operation: request.operation,
      baseRevision: request.baseRevision,
      turnCount: request.turns.length,
      requestedModel: "gpt-5.6",
      timeoutMs: 300_000,
      executionMode: "background",
    });
    const markdown = specificationToMarkdown(state.specification, {
      exportedAt: now,
      mode: "live",
      finalized: false,
    });

    expect(checkpoint.state.answerDraft).toBeNull();
    expect(request.turns.at(-1)?.text).toBe(editedSummary);
    for (const serialized of [JSON.stringify(checkpoint), JSON.stringify(request), JSON.stringify(info.mock.calls), markdown]) {
      expect(serialized).not.toContain(rawIntake);
    }
  });
});
