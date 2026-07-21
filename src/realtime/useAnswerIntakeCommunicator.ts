"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_ANSWER_CLARIFICATIONS,
  MAX_ANSWER_INTAKE_CONTRIBUTIONS,
} from "@/domain/answer-intake";
import { answerDraftSchema, interviewPromptSchema } from "@/domain/schemas";
import { exchangeIdentitySchema, type ExchangeIdentity } from "@/domain/v3-schemas";
import type { AnswerDraft, AnswerIntakeAssessment, InterviewPrompt } from "@/domain/types";

import type { V3CommunicatorEvent, V3CommunicatorTransport } from "./CommunicatorTransport";

export type AnswerIntakePhase =
  | "idle"
  | "presenting_prompt"
  | "listening"
  | "speech_detected"
  | "transcribing"
  | "assessing"
  | "clarification_playback"
  | "reviewing_answer"
  | "fallback";

export interface AnswerIntakeFallback {
  code: string;
  message: string;
}

export interface UseAnswerIntakeCommunicatorOptions {
  transport: V3CommunicatorTransport;
  onAnswerDraft: (draft: AnswerDraft) => void;
  onAssessment?: (assessment: AnswerIntakeAssessment) => void;
  onFallback?: (fallback: AnswerIntakeFallback) => void;
}

export function useAnswerIntakeCommunicator({
  transport,
  onAnswerDraft,
  onAssessment,
  onFallback,
}: UseAnswerIntakeCommunicatorOptions) {
  const [phase, setPhase] = useState<AnswerIntakePhase>("idle");
  const [assessment, setAssessment] = useState<AnswerIntakeAssessment | null>(null);
  const [contributionCount, setContributionCount] = useState(0);
  const [clarificationCount, setClarificationCount] = useState(0);
  const [coverageAssessed, setCoverageAssessed] = useState(false);
  const [error, setError] = useState<AnswerIntakeFallback | null>(null);
  const activePrompt = useRef<InterviewPrompt | null>(null);
  const activeIdentity = useRef<ExchangeIdentity | null>(null);
  const activeItemId = useRef<string | null>(null);
  const contributions = useRef<Array<{ text: string; source: "typed" | "transcription" }>>([]);
  const latestAssessment = useRef<AnswerIntakeAssessment | null>(null);
  const clarificationCountRef = useRef(0);
  const reviewFinalized = useRef(false);
  const onAnswerDraftRef = useRef(onAnswerDraft);
  const onAssessmentRef = useRef(onAssessment);
  const onFallbackRef = useRef(onFallback);

  useEffect(() => {
    onAnswerDraftRef.current = onAnswerDraft;
    onAssessmentRef.current = onAssessment;
    onFallbackRef.current = onFallback;
  }, [onAnswerDraft, onAssessment, onFallback]);

  const publishFallbackDraft = useCallback((fallback: AnswerIntakeFallback) => {
    const identity = activeIdentity.current;
    const intake = contributions.current;
    if (!identity || intake.length === 0) return;
    const source = intake.every((item) => item.source === "typed") ? "typed" : "transcription";
    const draft = answerDraftSchema.parse({
      text: intake.map((item) => item.text).join("\n\n").slice(0, 4_000),
      source,
      promptId: identity.promptId,
      transcriptionItemId: null,
    });
    reviewFinalized.current = true;
    setCoverageAssessed(false);
    setError(fallback);
    setPhase("fallback");
    onFallbackRef.current?.(fallback);
    onAnswerDraftRef.current(draft);
  }, []);

  const publishAssessedDraft = useCallback((value: AnswerIntakeAssessment) => {
    const identity = activeIdentity.current;
    if (!identity) return false;
    const draft = answerDraftSchema.parse({
      text: value.summary,
      source: "communicator_summary",
      promptId: identity.promptId,
      transcriptionItemId: null,
      coverage: value.coverage,
      uncertainties: value.uncertainties,
    });
    reviewFinalized.current = true;
    setCoverageAssessed(true);
    setError(null);
    setPhase("reviewing_answer");
    onAnswerDraftRef.current(draft);
    return true;
  }, []);

  useEffect(() => {
    const unsubscribeV3 = transport.subscribeV3((event: V3CommunicatorEvent) => {
      const identity = activeIdentity.current;
      if (!identity || !sameIdentity(identity, event.identity)) return;
      switch (event.type) {
        case "prompt_playback_started":
          setPhase("presenting_prompt");
          break;
        case "prompt_playback_done":
        case "answer_clarification_done":
          setPhase("listening");
          break;
        case "answer_clarification_started":
          setPhase("clarification_playback");
          break;
        case "speech_started":
          activeItemId.current = event.itemId;
          setPhase("speech_detected");
          break;
        case "speech_stopped":
          if (activeItemId.current === event.itemId) setPhase("transcribing");
          break;
        case "transcript_completed": {
          if (activeItemId.current !== event.itemId) break;
          activeItemId.current = null;
          const text = event.transcript.trim().slice(0, 4_000);
          if (!text) break;
          if (contributions.current.length >= MAX_ANSWER_INTAKE_CONTRIBUTIONS) {
            publishFallbackDraft({
              code: "ANSWER_INTAKE_LIMIT_REACHED",
              message: "Coverage was not assessed because Answer Intake reached its contribution limit.",
            });
            break;
          }
          contributions.current.push({ text, source: "transcription" });
          setContributionCount(contributions.current.length);
          try {
            transport.submitAnswerIntakeContribution(text, identity);
            setPhase("assessing");
          } catch {
            publishFallbackDraft({
              code: "ANSWER_INTAKE_ASSESSMENT_UNAVAILABLE",
              message: "Coverage was not assessed. Review the captured wording before confirming.",
            });
          }
          break;
        }
        case "answer_intake_assessed": {
          if (reviewFinalized.current) break;
          latestAssessment.current = event.assessment;
          setAssessment(event.assessment);
          setCoverageAssessed(true);
          setError(null);
          onAssessmentRef.current?.(event.assessment);
          const canClarify = Boolean(
            event.assessment.clarificationQuestion
            && clarificationCountRef.current < MAX_ANSWER_CLARIFICATIONS
            && contributions.current.length < MAX_ANSWER_INTAKE_CONTRIBUTIONS,
          );
          if (canClarify) {
            try {
              transport.speakAnswerClarification(
                event.assessment.clarificationQuestion!,
                event.assessment.clarificationAspectIds,
                identity,
              );
              clarificationCountRef.current += 1;
              setClarificationCount(clarificationCountRef.current);
              setPhase("clarification_playback");
              break;
            } catch {
              // The validated summary remains reviewable if exact playback fails.
            }
          }
          publishAssessedDraft(event.assessment);
          break;
        }
        default:
          break;
      }
    });
    const unsubscribeBase = transport.subscribe((event) => {
      if (event.type !== "error" || !activeIdentity.current || contributions.current.length === 0) return;
      publishFallbackDraft({
        code: event.code,
        message: "Coverage was not assessed. Review the captured wording before confirming.",
      });
    });
    return () => {
      unsubscribeV3();
      unsubscribeBase();
    };
  }, [publishAssessedDraft, publishFallbackDraft, transport]);

  useEffect(() => () => {
    const identity = activeIdentity.current;
    if (identity) {
      try {
        transport.finishAuthoritativeAnswer(identity);
      } catch {
        // Local references are still cleared during unmount.
      }
    }
    contributions.current.length = 0;
    latestAssessment.current = null;
    reviewFinalized.current = false;
    activeIdentity.current = null;
    activePrompt.current = null;
  }, [transport]);

  const beginAuthoritativeAnswer = useCallback((prompt: InterviewPrompt, identity: ExchangeIdentity) => {
    const parsedPrompt = interviewPromptSchema.parse(prompt);
    const parsedIdentity = parseAuthoritativeIdentity(identity, parsedPrompt.id);
    try {
      transport.beginAuthoritativeAnswer(parsedPrompt, parsedIdentity);
    } catch {
      return false;
    }
    activePrompt.current = parsedPrompt;
    activeIdentity.current = parsedIdentity;
    activeItemId.current = null;
    contributions.current.length = 0;
    latestAssessment.current = null;
    clarificationCountRef.current = 0;
    reviewFinalized.current = false;
    setAssessment(null);
    setContributionCount(0);
    setClarificationCount(0);
    setCoverageAssessed(false);
    setError(null);
    setPhase("presenting_prompt");
    return true;
  }, [transport]);

  const answerAuthoritativeNow = useCallback(() => {
    const identity = activeIdentity.current;
    if (!identity) return false;
    try {
      transport.answerAuthoritativeNow(identity);
      setPhase("listening");
      return true;
    } catch {
      return false;
    }
  }, [transport]);

  const submitTypedContribution = useCallback((value: string) => {
    const identity = activeIdentity.current;
    const text = value.trim().slice(0, 4_000);
    if (!identity || !text || contributions.current.length >= MAX_ANSWER_INTAKE_CONTRIBUTIONS) {
      return false;
    }
    contributions.current.push({ text, source: "typed" });
    setContributionCount(contributions.current.length);
    try {
      transport.submitAnswerIntakeContribution(text, identity);
      setPhase("assessing");
      return true;
    } catch {
      publishFallbackDraft({
        code: "ANSWER_INTAKE_ASSESSMENT_UNAVAILABLE",
        message: "Coverage was not assessed. Review the typed wording before confirming.",
      });
      return false;
    }
  }, [publishFallbackDraft, transport]);

  const reviewAnswerNow = useCallback(() => {
    if (latestAssessment.current) return publishAssessedDraft(latestAssessment.current);
    if (contributions.current.length === 0) return false;
    publishFallbackDraft({
      code: "ANSWER_INTAKE_REVIEWED_EARLY",
      message: "Coverage was not assessed. Review the captured wording before confirming.",
    });
    return true;
  }, [publishAssessedDraft, publishFallbackDraft]);

  const finishAuthoritativeAnswer = useCallback(() => {
    const identity = activeIdentity.current;
    if (identity) {
      try {
        transport.finishAuthoritativeAnswer(identity);
      } catch {
        // The application can still discard its memory after a transport race.
      }
    }
    activeIdentity.current = null;
    activePrompt.current = null;
    activeItemId.current = null;
    contributions.current.length = 0;
    latestAssessment.current = null;
    clarificationCountRef.current = 0;
    reviewFinalized.current = false;
    setAssessment(null);
    setContributionCount(0);
    setClarificationCount(0);
    setCoverageAssessed(false);
    setError(null);
    setPhase("idle");
  }, [transport]);

  const recordAgain = useCallback(() => {
    const prompt = activePrompt.current;
    const identity = activeIdentity.current;
    if (!prompt || !identity) return false;
    try {
      transport.finishAuthoritativeAnswer(identity);
      transport.beginAuthoritativeAnswer(prompt, identity);
    } catch {
      return false;
    }
    activeItemId.current = null;
    contributions.current.length = 0;
    latestAssessment.current = null;
    clarificationCountRef.current = 0;
    reviewFinalized.current = false;
    setAssessment(null);
    setContributionCount(0);
    setClarificationCount(0);
    setCoverageAssessed(false);
    setError(null);
    setPhase("presenting_prompt");
    return true;
  }, [transport]);

  return {
    phase,
    assessment,
    contributionCount,
    clarificationCount,
    coverageAssessed,
    error,
    beginAuthoritativeAnswer,
    answerAuthoritativeNow,
    submitTypedContribution,
    reviewAnswerNow,
    recordAgain,
    finishAuthoritativeAnswer,
  };
}

function parseAuthoritativeIdentity(identity: ExchangeIdentity, promptId: string) {
  const parsed = exchangeIdentitySchema.parse(identity);
  if (
    parsed.kind !== "authoritative_or_app_prompt"
    || parsed.permitId !== null
    || parsed.promptId !== promptId
  ) throw new Error("Exchange identity does not match the authoritative Interview Prompt.");
  return parsed;
}

function sameIdentity(left: ExchangeIdentity, right: ExchangeIdentity): boolean {
  return left.kind === right.kind
    && left.exchangeId === right.exchangeId
    && left.promptId === right.promptId
    && left.permitId === right.permitId
    && left.cancelEpoch === right.cancelEpoch;
}
