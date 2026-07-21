"use client";

import type { ReactNode } from "react";
import { validateAnswerIntakeAssessment } from "@/domain/answer-intake";
import type { AnswerIntakeAssessment, InterviewPrompt, SessionMode } from "@/domain/types";

export type AnswerIntakeDisplayState = "listening" | "collecting" | "assessing" | "clarifying";

export interface AnswerIntakeStatusProps {
  prompt: InterviewPrompt;
  state: AnswerIntakeDisplayState;
  assessment?: AnswerIntakeAssessment | null;
  contributionCount: number;
  clarificationCount: number;
  mode: SessionMode;
  onReviewNow?: () => void;
  children?: ReactNode;
}

const stateCopy: Record<AnswerIntakeDisplayState, { title: string; detail: string }> = {
  listening: { title: "Listening for your answer", detail: "Answer naturally; the Communicator will assess only the Brain-authored aspects below." },
  collecting: { title: "Collecting your answer", detail: "Your current contribution remains temporary while transcription finishes." },
  assessing: { title: "Assessing answer coverage", detail: "This non-authoritative assessment cannot confirm wording or change the Specification." },
  clarifying: { title: "One clarification", detail: "The Communicator is staying within an explicitly missing or uncertain Brain-authored aspect." },
};

const statusClasses = {
  covered: "border-emerald-700 text-emerald-100",
  missing: "border-amber-700 text-amber-100",
  uncertain: "border-violet-700 text-violet-100",
} as const;

export function AnswerIntakeStatus({ prompt, state, assessment = null, contributionCount, clarificationCount, mode, onReviewNow, children }: AnswerIntakeStatusProps) {
  const copy = stateCopy[state];
  const validation = assessment ? validateAnswerIntakeAssessment(prompt, assessment) : null;
  const validAssessment = validation?.valid ? validation.assessment : null;
  const coverage = new Map(validAssessment?.coverage.map((item) => [item.aspectId, item.status] as const) ?? []);
  const boundedContributionCount = Math.max(0, Math.min(3, contributionCount));
  const boundedClarificationCount = Math.max(0, Math.min(2, clarificationCount));
  return (
    <section aria-labelledby={`answer-intake-${prompt.id}`} className="rounded-2xl border border-sky-800 bg-sky-950/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-sky-200">Answer Intake · non-authoritative</p><h2 id={`answer-intake-${prompt.id}`} className="mt-1 text-lg font-semibold">{copy.title}</h2><p className="mt-1 text-sm text-stone-300">{copy.detail}</p></div>
        {mode === "demo" && <span className="rounded-full border border-amber-600 px-3 py-1 text-xs font-semibold text-amber-100">Prepared demo • no AI call</span>}
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-xs text-stone-400">Contribution {boundedContributionCount} of 3 · Clarification {boundedClarificationCount} of 2</p>
      <section aria-labelledby={`answer-aspects-${prompt.id}`} className="mt-3"><h3 id={`answer-aspects-${prompt.id}`} className="text-sm font-semibold">Brain-authored answer aspects</h3><ul className="mt-2 grid gap-2 sm:grid-cols-2">{prompt.answerAspects.map((aspect) => {
        const aspectStatus = coverage.get(aspect.id);
        return <li key={aspect.id} className={`rounded-lg border p-3 text-sm ${aspectStatus ? statusClasses[aspectStatus] : "border-stone-700 text-stone-300"}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{aspect.label}</strong><span className="text-xs font-semibold">{aspectStatus ? aspectStatus[0].toUpperCase() + aspectStatus.slice(1) : "Not assessed"}</span></div><p className="mt-1 text-xs">{aspect.description}</p>{aspect.required && <span className="mt-2 inline-block text-xs font-semibold">Required aspect</span>}</li>;
      })}</ul></section>
      {assessment && !validAssessment && <p className="mt-3 rounded-lg border border-amber-700 bg-amber-950/30 p-3 text-sm font-semibold text-amber-100">Coverage not assessed</p>}
      {state === "clarifying" && validAssessment?.clarificationQuestion && <section aria-labelledby={`clarification-${prompt.id}`} className="mt-4 rounded-xl border border-violet-700 bg-violet-950/20 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-violet-200">{mode === "demo" ? "Prepared clarification" : "Clarification"}</p><h3 id={`clarification-${prompt.id}`} className="mt-1 text-base font-semibold">{validAssessment.clarificationQuestion}</h3></section>}
      {children && <div className="mt-4">{children}</div>}
      {onReviewNow && <button type="button" onClick={onReviewNow} className="mt-4 min-h-11 rounded-xl border border-sky-700 px-4 py-2 font-semibold text-sky-100">Review answer now</button>}
      <p className="mt-3 text-xs text-stone-400">Captured contributions remain temporary and are not sent to the Brain.</p>
    </section>
  );
}
