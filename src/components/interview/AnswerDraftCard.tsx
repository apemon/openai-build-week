"use client";

import { useEffect, useId, useRef } from "react";
import type { AnswerAspect, AnswerAspectCoverage, AnswerDraft } from "@/domain/types";

const coverageCopy = {
  covered: { label: "Covered", classes: "border-emerald-700 bg-emerald-950/30 text-emerald-100" },
  missing: { label: "Missing", classes: "border-amber-700 bg-amber-950/30 text-amber-100" },
  uncertain: { label: "Uncertain", classes: "border-violet-700 bg-violet-950/30 text-violet-100" },
} as const;

function exactCoverage(answerAspects: readonly AnswerAspect[], coverage: readonly AnswerAspectCoverage[] | undefined): Map<string, AnswerAspectCoverage["status"]> | null {
  if (answerAspects.length === 0 || !coverage || coverage.length !== answerAspects.length) return null;
  const expected = new Set(answerAspects.map((aspect) => aspect.id));
  const result = new Map<string, AnswerAspectCoverage["status"]>();
  for (const item of coverage) {
    if (!expected.has(item.aspectId) || result.has(item.aspectId)) return null;
    result.set(item.aspectId, item.status);
  }
  return result.size === expected.size ? result : null;
}

export interface AnswerDraftCardProps {
  draft: AnswerDraft;
  answerAspects?: readonly AnswerAspect[];
  onChange: (text: string) => void;
  onConfirm: () => void;
  onRecordAgain: () => void;
  onReturnToClarification?: () => void;
}

export function AnswerDraftCard({ draft, answerAspects = [], onChange, onConfirm, onRecordAgain, onReturnToClarification }: AnswerDraftCardProps) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const assessedCoverage = exactCoverage(answerAspects, draft.coverage);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border-2 border-sky-700 bg-sky-950/20 p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-sky-300">Not yet confirmed</p>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-semibold">Answer Summary</h2>
      <p className="mt-1 text-sm text-stone-300">{draft.source === "communicator_summary" ? "Edit this concise Communicator summary before confirming it." : "Edit this captured wording before confirming it."} Nothing reaches the Brain automatically.</p>
      {assessedCoverage ? <section aria-labelledby={`${id}-coverage-title`} className="mt-4 rounded-xl border border-stone-700 bg-stone-950/50 p-3">
        <h3 id={`${id}-coverage-title`} className="text-sm font-semibold">Answer aspect coverage</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">{answerAspects.map((aspect) => {
          const status = assessedCoverage.get(aspect.id)!;
          const copy = coverageCopy[status];
          return <li key={aspect.id} className={`rounded-lg border p-3 text-sm ${copy.classes}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{aspect.label}</strong><span className="font-semibold">{copy.label}</span></div><p className="mt-1 text-xs opacity-90">{aspect.description}</p>{aspect.required && <span className="mt-2 inline-block text-xs font-semibold">Required aspect</span>}</li>;
        })}</ul>
      </section> : <p role="status" className="mt-4 rounded-xl border border-amber-700 bg-amber-950/30 p-3 text-sm font-semibold text-amber-100">Coverage not assessed</p>}
      {draft.uncertainties && draft.uncertainties.length > 0 && <section aria-labelledby={`${id}-uncertainties-title`} className="mt-4 rounded-xl border border-violet-800 bg-violet-950/20 p-3"><h3 id={`${id}-uncertainties-title`} className="text-sm font-semibold text-violet-100">Uncertainties</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-300">{draft.uncertainties.map((uncertainty) => <li key={uncertainty}>{uncertainty}</li>)}</ul></section>}
      <label htmlFor={id} className="sr-only">Answer Summary</label>
      <textarea id={id} rows={6} maxLength={4_000} value={draft.text} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); onConfirm(); } }} className="mt-3 w-full rounded-xl border border-stone-600 bg-stone-950 p-3" />
      <p className="mt-1 text-right text-sm text-stone-400">{draft.text.length}/4,000</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={!draft.text.trim()} onClick={onConfirm} className="min-h-11 rounded-xl bg-sky-300 px-5 py-2 font-semibold text-stone-950 disabled:bg-stone-700">Send confirmed summary to Brain</button>
        <button type="button" onClick={onRecordAgain} className="min-h-11 rounded-xl border border-stone-600 px-5 py-2 font-semibold">Record again</button>
        {onReturnToClarification && <button type="button" onClick={onReturnToClarification} className="min-h-11 rounded-xl border border-violet-700 px-5 py-2 font-semibold text-violet-100">Return to clarification</button>}
      </div>
    </section>
  );
}
