"use client";

import { useEffect, useId, useRef } from "react";
import type { AnswerDraft } from "@/domain/types";

export function AnswerDraftCard({ draft, onChange, onConfirm, onRecordAgain }: { draft: AnswerDraft; onChange: (text: string) => void; onConfirm: () => void; onRecordAgain: () => void }) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border-2 border-sky-700 bg-sky-950/20 p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-sky-300">Not yet confirmed</p>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-semibold">Review Answer Draft</h2>
      <p className="mt-1 text-sm text-stone-300">Edit this {draft.source === "transcription" ? "transcription" : "typed response"} before it reaches the Brain.</p>
      <label htmlFor={id} className="sr-only">Answer Draft</label>
      <textarea id={id} rows={6} maxLength={4_000} value={draft.text} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); onConfirm(); } }} className="mt-3 w-full rounded-xl border border-stone-600 bg-stone-950 p-3" />
      <p className="mt-1 text-right text-sm text-stone-400">{draft.text.length}/4,000</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={!draft.text.trim()} onClick={onConfirm} className="min-h-11 rounded-xl bg-sky-300 px-5 py-2 font-semibold text-stone-950 disabled:bg-stone-700">Send to Brain</button>
        <button type="button" onClick={onRecordAgain} className="min-h-11 rounded-xl border border-stone-600 px-5 py-2 font-semibold">Record again</button>
      </div>
    </section>
  );
}
