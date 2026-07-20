import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { initialInterviewPrompt } from "@/domain/initial-state";
import type { ExchangeIdentity, QuestionPermit } from "@/domain/v3-schemas";

import { MockCommunicatorTransport } from "./MockCommunicatorTransport";
import { useV3Communicator } from "./useV3Communicator";

const sessionConfig = {
  sessionId: "SESSION-V3TEST",
  clientSecret: "temporary-test-value",
  realtimeModel: "gpt-realtime-2.1",
};

function permit(id = "PERMIT-001"): QuestionPermit {
  return {
    id,
    windowId: "WINDOW-V3TEST",
    roadmapItemId: "ROADMAP-001",
    prompt: {
      ...initialInterviewPrompt,
      id: "PROMPT-PERMITTED",
      decisionKey: "billing_roles",
      detailedQuestion: "Which roles may manage billing?",
      spokenQuestion: "Who may manage billing?",
      recommendation: null,
    },
    ordinal: 1,
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

describe("useV3Communicator", () => {
  it("carries authoritative prompt identity through playback and capture gates", async () => {
    const transport = new MockCommunicatorTransport();
    const listener = vi.fn();
    transport.subscribeV3(listener);
    await transport.connect(sessionConfig);
    const authoritativeIdentity: ExchangeIdentity = {
      kind: "authoritative_or_app_prompt",
      exchangeId: "EXCHANGE-AUTHORITATIVE",
      promptId: "PROMPT-AUTHORITATIVE",
      permitId: null,
      cancelEpoch: 0,
    };

    transport.speakPromptWithIdentity(authoritativeIdentity, "What do you want to build?");
    expect(transport.getMicrophoneState()).toBe("off");
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: "prompt_playback_done",
      identity: authoritativeIdentity,
    }));
    expect(transport.getMicrophoneState()).toBe("listening");
  });

  it("rejects late same-topic events whose immutable identity differs", async () => {
    const transport = new MockCommunicatorTransport();
    const onEvent = vi.fn();
    const { result } = renderHook(() => useV3Communicator({ transport, onEvent }));
    await act(async () => transport.connect(sessionConfig));
    act(() => result.current.beginExchange(permit(), identity()));
    await act(async () => Promise.resolve());

    act(() => transport.simulateV3Event({
      type: "decision_summary_ready",
      text: "Late wording must not bind.",
      uncertainties: [],
      identity: { ...identity(), exchangeId: "EXCHANGE-STALE" },
      providerEventId: "late-event",
    }));

    expect(result.current.summaryDraft).toBeNull();
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ providerEventId: "late-event" }));
  });

  it("preserves mid-speech wording behind revalidation and keeps the microphone gated", async () => {
    const transport = new MockCommunicatorTransport();
    const { result } = renderHook(() => useV3Communicator({ transport }));
    await act(async () => transport.connect(sessionConfig));
    act(() => result.current.beginExchange(permit(), identity()));
    await act(async () => Promise.resolve());

    act(() => {
      transport.simulatePermittedSpeechStarted("item-1");
      transport.simulatePermittedSpeechStopped("item-1");
      result.current.handleRevisionBarrier(1);
      transport.simulatePermittedTranscriptCompleted("item-1", "Owners and Billing Admins.", identity());
    });

    expect(result.current.phase).toBe("revalidation_pending");
    expect(result.current.preservedWording).toBe("Owners and Billing Admins.");
    expect(transport.getMicrophoneState()).toBe("off");

    const freshPermit = { ...permit("PERMIT-002"), approvedAtRevision: 3, dependencyVersion: "DEPENDENCY-3" };
    act(() => result.current.resumeAfterRevalidation(freshPermit, identity("PERMIT-002", 1)));
    expect(result.current.phase).toBe("clarifying");
    expect(result.current.preservedWording).toBeNull();
    expect(transport.getSubmittedClarificationTexts()).toContain("Owners and Billing Admins.");
    expect(transport.getMicrophoneState()).toBe("off");
  });

  it("accepts the old capture identity only long enough to rebase a late transcript to a fresh permit", async () => {
    const transport = new MockCommunicatorTransport();
    const { result } = renderHook(() => useV3Communicator({ transport }));
    await act(async () => transport.connect(sessionConfig));
    act(() => result.current.beginExchange(permit(), identity()));
    await act(async () => Promise.resolve());
    act(() => {
      transport.simulatePermittedSpeechStarted("item-rebased");
      transport.simulatePermittedSpeechStopped("item-rebased");
      result.current.handleRevisionBarrier(1);
    });
    const freshPermit = { ...permit("PERMIT-002"), approvedAtRevision: 3, dependencyVersion: "DEPENDENCY-3" };
    act(() => result.current.resumeAfterRevalidation(freshPermit, identity("PERMIT-002", 1)));
    expect(result.current.phase).toBe("revalidation_pending");
    expect(transport.getMicrophoneState()).toBe("off");

    act(() => transport.simulatePermittedTranscriptCompleted(
      "item-rebased",
      "Rebase this exact wording.",
      identity(),
    ));
    expect(result.current.phase).toBe("clarifying");
    expect(transport.getSubmittedClarificationTexts()).toContain("Rebase this exact wording.");
    expect(transport.getMicrophoneState()).toBe("off");
  });

  it("preserves summary edits while paused and enables confirmation only after fresh revalidation", async () => {
    const transport = new MockCommunicatorTransport();
    const { result } = renderHook(() => useV3Communicator({ transport }));
    await act(async () => transport.connect(sessionConfig));
    act(() => result.current.beginExchange(permit(), identity()));
    await act(async () => Promise.resolve());
    act(() => transport.simulatePermittedDecisionSummary("Owners manage billing."));
    expect(result.current.summaryDraft?.confirmable).toBe(true);

    act(() => {
      result.current.updateSummaryDraft("Edited owners manage billing.");
      result.current.pause(1);
    });
    expect(result.current.summaryDraft).toEqual({
      text: "Edited owners manage billing.",
      uncertainties: [],
      confirmable: false,
    });
    expect(transport.getMicrophoneState()).toBe("off");

    const freshPermit = { ...permit("PERMIT-002"), approvedAtRevision: 3, dependencyVersion: "DEPENDENCY-3" };
    act(() => result.current.resumeAfterRevalidation(freshPermit, identity("PERMIT-002", 1)));
    expect(result.current.phase).toBe("summary_editing");
    expect(result.current.summaryDraft?.confirmable).toBe(true);
    expect(transport.getMicrophoneState()).toBe("off");
  });

  it("retains exact late transcription as Not Applied when revalidation invalidates mid-speech work", async () => {
    const transport = new MockCommunicatorTransport();
    const { result } = renderHook(() => useV3Communicator({ transport }));
    await act(async () => transport.connect(sessionConfig));
    act(() => result.current.beginExchange(permit(), identity()));
    await act(async () => Promise.resolve());
    act(() => {
      transport.simulatePermittedSpeechStarted("item-late");
      transport.simulatePermittedSpeechStopped("item-late");
      result.current.handleRevisionBarrier(1);
      result.current.invalidateAfterRevalidation(2);
      transport.simulatePermittedTranscriptCompleted("item-late", "Keep this exact wording.", identity());
    });

    expect(result.current.phase).toBe("not_applied");
    expect(result.current.notAppliedWording).toBe("Keep this exact wording.");
    expect(transport.getMicrophoneState()).toBe("off");
  });
});
