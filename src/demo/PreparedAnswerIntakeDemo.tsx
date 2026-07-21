"use client";

import { useState } from "react";
import { AnswerDraftCard, AnswerIntakeStatus } from "@/components/interview";
import {
  preparedAnswerClarification,
  preparedAnswerIntakePrompt,
  preparedAnswerSummaryDraft,
  preparedInitialAnswerAssessment,
  validatePreparedAnswerIntakeFixtures,
} from "./v3-1-prepared-answer-intake";

export interface PreparedAnswerIntakeDemoProps {
  onConfirm: (summary: string) => void | Promise<void>;
}

type PreparedAnswerIntakeStage = "coverage" | "clarification" | "summary";

export function PreparedAnswerIntakeDemo({ onConfirm }: PreparedAnswerIntakeDemoProps) {
  validatePreparedAnswerIntakeFixtures();
  const [stage, setStage] = useState<PreparedAnswerIntakeStage>("coverage");
  const [summary, setSummary] = useState(preparedAnswerSummaryDraft.text);

  if (stage === "summary") {
    return <AnswerDraftCard draft={{ ...preparedAnswerSummaryDraft, text: summary }} answerAspects={preparedAnswerIntakePrompt.answerAspects} onChange={setSummary} onConfirm={() => void onConfirm(summary)} onRecordAgain={() => setStage("coverage")} onReturnToClarification={() => setStage("clarification")} />;
  }

  return (
    <AnswerIntakeStatus prompt={preparedAnswerIntakePrompt} state={stage === "coverage" ? "assessing" : "clarifying"} assessment={preparedInitialAnswerAssessment} contributionCount={stage === "coverage" ? 1 : 2} clarificationCount={stage === "coverage" ? 0 : 1} mode="demo" onReviewNow={stage === "coverage" ? () => setStage("summary") : undefined}>
      {stage === "coverage" ? <button type="button" onClick={() => setStage("clarification")} className="min-h-11 rounded-xl bg-violet-300 px-4 py-2 font-semibold text-stone-950">Continue with prepared clarification</button> : <div className="space-y-3"><p className="rounded-xl border border-stone-700 bg-stone-950 p-3 text-sm"><strong>Prepared Product Manager answer:</strong> {preparedAnswerClarification.answer}</p><button type="button" onClick={() => setStage("summary")} className="min-h-11 rounded-xl bg-sky-300 px-4 py-2 font-semibold text-stone-950">Review prepared Answer Summary</button></div>}
    </AnswerIntakeStatus>
  );
}
