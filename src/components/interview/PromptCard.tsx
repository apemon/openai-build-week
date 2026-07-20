"use client";

import { useId, useState } from "react";
import type { InterviewPrompt } from "@/domain/types";
import type { ExternalEvidence } from "@/domain/v3-schemas";
import { ExternalEvidenceCitations } from "../specification/ExternalEvidence";
import { VisualAid } from "../visual-aids/VisualAid";

export function PromptCard({ prompt, onDefer, onAnswerNow, preparedAudioUnavailable = false, externalEvidence = [] }: { prompt: InterviewPrompt; onDefer?: (note: string) => void; onAnswerNow?: () => void; preparedAudioUnavailable?: boolean; externalEvidence?: readonly ExternalEvidence[] }) {
  const noteId = useId();
  const [showDeferral, setShowDeferral] = useState(false);
  const [deferralNote, setDeferralNote] = useState("");
  const submitDeferral = () => {
    onDefer?.(deferralNote.trim());
    setDeferralNote("");
    setShowDeferral(false);
  };
  return (
    <section aria-labelledby={`prompt-${prompt.id}`} className="rounded-3xl border border-stone-700 bg-stone-900 p-5 sm:p-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-sky-300">One decision</p>
      <h2 id={`prompt-${prompt.id}`} tabIndex={-1} className="mt-2 text-2xl font-semibold leading-tight text-stone-50">{prompt.detailedQuestion}</h2>
      <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <div><h3 className="font-semibold text-stone-100">Why it matters</h3><p className="mt-1 text-stone-300">{prompt.whyItMatters}</p></div>
        <div><h3 className="font-semibold text-stone-100">Decision impact</h3><ul className="mt-1 list-disc pl-5 text-stone-300">{prompt.decisionImpact.map((value) => <li key={value}>{value}</li>)}</ul></div>
      </div>
      {prompt.confirmedContext.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Confirmed context</h3><ul className="mt-1 list-disc pl-5 text-sm text-stone-300">{prompt.confirmedContext.map((value) => <li key={value}>{value}</li>)}</ul></div>}
      <div className="mt-4 rounded-xl bg-stone-950 p-3 text-sm"><span className="font-semibold">AI recommendation: </span>{prompt.recommendation ? `${prompt.recommendation.answer} — ${prompt.recommendation.rationale}` : "No recommendation yet"}</div>
      {prompt.recommendation && <ExternalEvidenceCitations evidence={externalEvidence} evidenceIds={(prompt.recommendation as typeof prompt.recommendation & { externalEvidenceIds?: string[] }).externalEvidenceIds ?? []} />}
      {prompt.visualAid && <div className="mt-5"><p className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-400">Visual Aid</p><VisualAid aid={prompt.visualAid} /></div>}
      {preparedAudioUnavailable && <p role="status" className="mt-4 text-sm text-amber-200">Prepared prompt audio is unavailable; continue with the visible prompt.</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        {onAnswerNow && <button type="button" onClick={onAnswerNow} className="min-h-11 rounded-xl bg-sky-300 px-4 py-2 font-semibold text-stone-950">Answer now</button>}
        {onDefer && <button type="button" aria-expanded={showDeferral} aria-controls={`${noteId}-deferral`} onClick={() => setShowDeferral((value) => !value)} className="min-h-11 rounded-xl border border-stone-600 px-4 py-2 font-semibold">Defer</button>}
      </div>
      {onDefer && showDeferral && <div id={`${noteId}-deferral`} className="mt-3 rounded-xl border border-stone-700 bg-stone-950/60 p-3">
        <label htmlFor={noteId} className="text-sm font-semibold">Optional deferral note</label>
        <p id={`${noteId}-hint`} className="mt-1 text-sm text-stone-400">For example, name the committee or date needed. This note is not treated as the missing decision.</p>
        <input id={noteId} aria-describedby={`${noteId}-hint`} maxLength={500} value={deferralNote} onChange={(event) => setDeferralNote(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-stone-600 bg-stone-950 px-3" />
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={submitDeferral} className="min-h-11 rounded-lg bg-amber-300 px-4 font-semibold text-stone-950">Confirm deferral</button><button type="button" onClick={() => { setDeferralNote(""); setShowDeferral(false); }} className="min-h-11 rounded-lg border border-stone-600 px-4 font-semibold">Cancel</button></div>
      </div>}
    </section>
  );
}
