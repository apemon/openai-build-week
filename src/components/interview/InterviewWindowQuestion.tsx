"use client";

import type { ReactNode } from "react";
import type { ExternalEvidence, InterviewJob, QuestionPermit } from "@/domain/v3-schemas";
import { ExternalEvidenceCitations } from "../specification/ExternalEvidence";

export interface FuturePermitTopic { permitId: string; topic: string }

export interface InterviewWindowQuestionProps {
  activeJob: InterviewJob | null;
  futureTopics: readonly FuturePermitTopic[];
  mode: "live" | "demo";
  externalEvidence?: readonly ExternalEvidence[];
  children?: ReactNode;
}

function ActivePermit({ permit, externalEvidence }: { permit: QuestionPermit; externalEvidence: readonly ExternalEvidence[] }) {
  return <><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-violet-200">One active Brain-approved decision</p><span className="rounded-full border border-violet-600 px-3 py-1 text-xs">Permit {permit.ordinal} · revision {permit.approvedAtRevision}</span></div><h2 id={`permit-${permit.id}`} tabIndex={-1} className="mt-2 text-2xl font-semibold leading-tight">{permit.prompt.detailedQuestion}</h2><p className="mt-3 text-sm leading-6 text-stone-300">{permit.prompt.whyItMatters}</p>{permit.prompt.confirmedContext.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Confirmed context</h3><ul className="mt-1 list-disc pl-5 text-sm text-stone-300">{permit.prompt.confirmedContext.map((value) => <li key={value}>{value}</li>)}</ul></div>}<div className="mt-4 rounded-xl bg-stone-950 p-3 text-sm"><span className="font-semibold">AI recommendation: </span>{permit.prompt.recommendation ? `${permit.prompt.recommendation.answer} — ${permit.prompt.recommendation.rationale}` : "No recommendation yet"}</div>{permit.prompt.recommendation && <ExternalEvidenceCitations evidence={externalEvidence} evidenceIds={permit.prompt.recommendation.externalEvidenceIds} />}</>;
}

export function InterviewWindowQuestion({ activeJob, futureTopics, mode, externalEvidence = [], children }: InterviewWindowQuestionProps) {
  return (
    <section aria-labelledby={activeJob ? `permit-${activeJob.permit.id}` : "permit-window-waiting"} className="rounded-3xl border border-violet-700 bg-violet-950/20 p-5 sm:p-6">
      {activeJob ? <ActivePermit permit={activeJob.permit} externalEvidence={externalEvidence} /> : <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-200">Interview Window</p><h2 id="permit-window-waiting" className="mt-2 text-xl font-semibold">Waiting for a fresh Brain-approved question</h2><p className="mt-2 text-sm text-stone-300">The Communicator cannot invent or replenish a decision.</p></div>}
      {mode === "demo" && <p className="mt-3 text-sm font-semibold text-amber-100">Prepared demo • no AI call</p>}
      {activeJob && activeJob.clarificationTurns.length > 0 && <ol aria-label="Clarification exchange" className="mt-4 space-y-2">{activeJob.clarificationTurns.map((turn) => <li key={turn.id} className={`rounded-xl p-3 text-sm ${turn.role === "product_manager" ? "ml-5 bg-stone-800" : "mr-5 border border-stone-700 bg-stone-950"}`}><strong>{turn.role === "product_manager" ? "Product Manager" : "Communicator"}:</strong> {turn.text}</li>)}</ol>}
      {activeJob && children && <div className="mt-5">{children}</div>}
      {futureTopics.length > 0 && <aside aria-label="Future permitted topics" className="mt-5 rounded-xl border border-stone-700 bg-stone-950/60 p-3"><p className="text-sm font-semibold">{futureTopics.length} future permitted {futureTopics.length === 1 ? "topic" : "topics"}</p><p className="mt-1 text-xs text-stone-400">Only topic labels are shown until the next permit is promoted.</p><ul className="mt-2 flex flex-wrap gap-2">{futureTopics.map((item) => <li key={item.permitId} className="rounded-full border border-stone-600 px-3 py-1 text-sm text-stone-300">{item.topic}</li>)}</ul></aside>}
    </section>
  );
}
