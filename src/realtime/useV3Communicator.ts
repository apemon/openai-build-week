"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  exchangeIdentitySchema,
  questionPermitSchema,
  type ExchangeIdentity,
  type QuestionPermit,
} from "@/domain/v3-schemas";

import type { V3CommunicatorEvent, V3CommunicatorTransport } from "./CommunicatorTransport";

export type V3ExchangePhase =
  | "idle"
  | "presenting"
  | "listening"
  | "speech_detected"
  | "transcribing"
  | "clarifying"
  | "summary_editing"
  | "paused"
  | "revalidation_pending"
  | "not_applied";

export interface V3SummaryDraft {
  text: string;
  uncertainties: string[];
  confirmable: boolean;
}

export interface UseV3CommunicatorOptions {
  transport: V3CommunicatorTransport;
  onEvent?: (event: V3CommunicatorEvent) => void;
}

/** Identity-safe application hook for the bounded async lane. It deliberately
 * does not submit to the Brain or confirm a Decision Summary. */
export function useV3Communicator({ transport, onEvent }: UseV3CommunicatorOptions) {
  const [phase, setPhase] = useState<V3ExchangePhase>("idle");
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [summaryDraft, setSummaryDraft] = useState<V3SummaryDraft | null>(null);
  const [preservedWording, setPreservedWording] = useState<string | null>(null);
  const [notAppliedWording, setNotAppliedWording] = useState<string | null>(null);
  const activeIdentity = useRef<ExchangeIdentity | null>(null);
  const activePermit = useRef<QuestionPermit | null>(null);
  const activeItemId = useRef<string | null>(null);
  const transcriptByItem = useRef(new Map<string, string>());
  const revalidationPending = useRef(false);
  const notAppliedPendingIdentity = useRef<ExchangeIdentity | null>(null);
  const rebasedCaptureIdentity = useRef<ExchangeIdentity | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => transport.subscribeV3((event) => {
    const current = activeIdentity.current ?? notAppliedPendingIdentity.current;
    const isRebasedCapture = Boolean(
      rebasedCaptureIdentity.current
      && sameIdentity(rebasedCaptureIdentity.current, event.identity),
    );
    if ((!current || !sameIdentity(current, event.identity)) && !isRebasedCapture) return;
    if (notAppliedPendingIdentity.current) {
      if (event.type === "transcript_completed" && activeItemId.current === event.itemId) {
        activeItemId.current = null;
        transcriptByItem.current.delete(event.itemId);
        notAppliedPendingIdentity.current = null;
        setNotAppliedWording(event.transcript.trim().slice(0, 4_000) || null);
      }
      return;
    }
    if (isRebasedCapture) {
      if (event.type === "transcript_delta" && activeItemId.current === event.itemId) {
        const next = `${transcriptByItem.current.get(event.itemId) ?? ""}${event.delta}`.slice(0, 4_000);
        transcriptByItem.current.set(event.itemId, next);
        setTranscriptPreview(next);
      }
      if (event.type === "transcript_completed" && activeItemId.current === event.itemId) {
        activeItemId.current = null;
        transcriptByItem.current.delete(event.itemId);
        rebasedCaptureIdentity.current = null;
        const wording = event.transcript.trim().slice(0, 4_000);
        setTranscriptPreview("");
        if (!wording || !activeIdentity.current) return;
        try {
          transport.submitPermittedClarification(wording, activeIdentity.current);
          setPhase("clarifying");
        } catch {
          setPreservedWording(wording);
          setPhase("revalidation_pending");
        }
      }
      return;
    }
    onEventRef.current?.(event);
    switch (event.type) {
      case "prompt_playback_started":
        setPhase("presenting");
        break;
      case "prompt_playback_done":
        if (!revalidationPending.current) setPhase("listening");
        break;
      case "speech_started":
        activeItemId.current = event.itemId;
        transcriptByItem.current.set(event.itemId, "");
        setTranscriptPreview("");
        setPhase("speech_detected");
        break;
      case "speech_stopped":
        if (activeItemId.current === event.itemId) setPhase("transcribing");
        break;
      case "transcript_delta": {
        if (activeItemId.current !== event.itemId) break;
        const next = `${transcriptByItem.current.get(event.itemId) ?? ""}${event.delta}`.slice(0, 4_000);
        transcriptByItem.current.set(event.itemId, next);
        setTranscriptPreview(next);
        break;
      }
      case "transcript_completed": {
        if (activeItemId.current !== event.itemId) break;
        activeItemId.current = null;
        transcriptByItem.current.delete(event.itemId);
        const wording = event.transcript.trim().slice(0, 4_000);
        setTranscriptPreview("");
        if (!wording) break;
        if (revalidationPending.current) {
          setPreservedWording(wording);
          setPhase("revalidation_pending");
          break;
        }
        try {
          transport.submitPermittedClarification(wording, event.identity);
          setPhase("clarifying");
        } catch {
          setPreservedWording(wording);
          setPhase("revalidation_pending");
        }
        break;
      }
      case "clarification_response_done":
        if (!revalidationPending.current) setPhase("listening");
        break;
      case "decision_summary_ready":
        setSummaryDraft({
          text: event.text,
          uncertainties: event.uncertainties,
          confirmable: !revalidationPending.current,
        });
        setPhase(revalidationPending.current ? "revalidation_pending" : "summary_editing");
        break;
    }
  }), [transport]);

  const beginExchange = useCallback((permit: QuestionPermit, identity: ExchangeIdentity) => {
    const scope = parseScope(permit, identity);
    transport.beginPermittedExchange(scope.permit, scope.identity);
    activePermit.current = scope.permit;
    activeIdentity.current = scope.identity;
    activeItemId.current = null;
    transcriptByItem.current.clear();
    revalidationPending.current = false;
    notAppliedPendingIdentity.current = null;
    rebasedCaptureIdentity.current = null;
    setTranscriptPreview("");
    setSummaryDraft(null);
    setPreservedWording(null);
    setNotAppliedWording(null);
    setPhase("presenting");
  }, [transport]);

  const requestSummary = useCallback(() => {
    if (!activeIdentity.current || revalidationPending.current) return false;
    try {
      transport.requestPermittedDecisionSummary(activeIdentity.current);
      return true;
    } catch {
      return false;
    }
  }, [transport]);

  const updateSummaryDraft = useCallback((text: string) => {
    const value = text.slice(0, 4_000);
    setSummaryDraft((draft) => draft ? { ...draft, text: value } : draft);
  }, []);

  const pause = useCallback((nextCancelEpoch: number) => {
    if (!activeIdentity.current) return;
    revalidationPending.current = true;
    transport.pauseQuestions(nextCancelEpoch);
    setSummaryDraft((draft) => draft ? { ...draft, confirmable: false } : draft);
    setPhase("paused");
  }, [transport]);

  const handleRevisionBarrier = useCallback((nextCancelEpoch: number) => {
    if (!activeIdentity.current) return;
    revalidationPending.current = true;
    transport.pauseQuestions(nextCancelEpoch);
    setSummaryDraft((draft) => draft ? { ...draft, confirmable: false } : draft);
    setPhase("revalidation_pending");
  }, [transport]);

  const resumeAfterRevalidation = useCallback((permit: QuestionPermit, identity: ExchangeIdentity) => {
    const scope = parseScope(permit, identity);
    const current = activeIdentity.current;
    if (!current || current.exchangeId !== scope.identity.exchangeId) {
      throw new Error("Fresh permit does not revalidate the active exchange.");
    }
    transport.resumeQuestions(scope.permit, scope.identity);
    const unchangedPrompt = activePermit.current?.prompt.id === scope.permit.prompt.id
      && activePermit.current.prompt.spokenQuestion === scope.permit.prompt.spokenQuestion
      && activePermit.current.prompt.detailedQuestion === scope.permit.prompt.detailedQuestion;
    if (activeItemId.current && current) rebasedCaptureIdentity.current = current;
    activePermit.current = scope.permit;
    activeIdentity.current = scope.identity;
    revalidationPending.current = false;
    const wording = preservedWording;
    if (summaryDraft) {
      transport.setMicrophoneEnabled(false);
      setSummaryDraft({ ...summaryDraft, confirmable: true });
      setPhase("summary_editing");
    } else if (wording) {
      transport.submitPermittedClarification(wording, scope.identity);
      setPreservedWording(null);
      setPhase("clarifying");
    } else if (rebasedCaptureIdentity.current) {
      setPhase("revalidation_pending");
    } else {
      setPhase(unchangedPrompt ? "listening" : "presenting");
    }
  }, [preservedWording, summaryDraft, transport]);

  const invalidateAfterRevalidation = useCallback((nextCancelEpoch: number) => {
    const identity = activeIdentity.current;
    if (!identity) return;
    const wording = summaryDraft?.text ?? preservedWording ?? (transcriptPreview.trim() || null);
    if (activeItemId.current) notAppliedPendingIdentity.current = identity;
    rebasedCaptureIdentity.current = null;
    transport.cancelExchange(identity, nextCancelEpoch);
    activeIdentity.current = null;
    activePermit.current = null;
    revalidationPending.current = false;
    setNotAppliedWording(wording);
    setSummaryDraft(null);
    setPreservedWording(null);
    setTranscriptPreview("");
    setPhase("not_applied");
  }, [preservedWording, summaryDraft, transcriptPreview, transport]);

  const promoteNextPermit = useCallback((
    permit: QuestionPermit,
    identity: ExchangeIdentity,
    nextCancelEpoch: number,
  ) => {
    const current = activeIdentity.current;
    if (current) transport.cancelExchange(current, nextCancelEpoch);
    beginExchange(permit, identity);
  }, [beginExchange, transport]);

  return {
    phase,
    transcriptPreview,
    summaryDraft,
    preservedWording,
    notAppliedWording,
    beginExchange,
    requestSummary,
    updateSummaryDraft,
    pause,
    handleRevisionBarrier,
    resumeAfterRevalidation,
    invalidateAfterRevalidation,
    promoteNextPermit,
  };
}

function parseScope(permit: QuestionPermit, identity: ExchangeIdentity) {
  const parsedPermit = questionPermitSchema.parse(permit);
  const parsedIdentity = exchangeIdentitySchema.parse(identity);
  if (
    parsedIdentity.kind !== "permitted"
    || parsedIdentity.permitId !== parsedPermit.id
    || parsedIdentity.promptId !== parsedPermit.prompt.id
  ) throw new Error("Exchange identity does not match the Question Permit.");
  return { permit: parsedPermit, identity: parsedIdentity };
}

function sameIdentity(left: ExchangeIdentity, right: ExchangeIdentity): boolean {
  return left.kind === right.kind
    && left.exchangeId === right.exchangeId
    && left.promptId === right.promptId
    && left.permitId === right.permitId
    && left.cancelEpoch === right.cancelEpoch;
}
