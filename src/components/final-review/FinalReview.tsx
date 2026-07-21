"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { DecisionSummary, NextAction, SessionMode, Specification } from "@/domain/types";
import type { BrainHarnessMode } from "@/domain/v3-schemas";
import { copyMarkdown } from "@/export/copy-markdown";
import { downloadMarkdown } from "@/export/download-markdown";
import { markdownFilename, specificationToMarkdown } from "@/export/to-markdown";
import { SpecificationPanel } from "../specification/SpecificationPanel";
import { NextActionEditor } from "./NextActionEditor";
import { StaleWorkPanel } from "../interview/StaleWorkPanel";

export function FinalReview({ specification, revision, mode, finalized, brainModel, realtimeModel, staleDecisionSummaries = [], persistentBrainStatus, decisionTray, sessionLink, experimental, onNextActionsChange, onFinalize, onResume, onExit }: { specification: Specification; revision: number; mode: SessionMode; finalized: boolean; brainModel?: string | null; realtimeModel?: string | null; staleDecisionSummaries?: DecisionSummary[]; persistentBrainStatus?: ReactNode; decisionTray?: ReactNode; sessionLink?: ReactNode; experimental?: { adapter: BrainHarnessMode; publicSearchEnabled: boolean } | null; onNextActionsChange: (actions: NextAction[]) => void; onFinalize: () => void; onResume: () => void; onExit: () => void }) {
  const [fallback, setFallback] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmingExit, setConfirmingExit] = useState(false);
  const markdown = useMemo(() => specificationToMarkdown(specification, { mode, finalized, brainModel, realtimeModel, experimental }), [specification, mode, finalized, brainModel, realtimeModel, experimental]);
  const update = (next: NextAction) => onNextActionsChange(specification.nextActions.map((value) => value.id === next.id ? next : value));
  const download = () => { if (downloadMarkdown(markdown, markdownFilename(specification.title))) setNotice("Markdown download started."); else { setFallback(markdown); setNotice("Download is unavailable. A selectable preview is shown."); } };
  const copy = async () => { if (await copyMarkdown(markdown)) setNotice("Markdown copied."); else { setFallback(markdown); setNotice("Clipboard is unavailable. A selectable preview is shown."); } };
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-8">
      <header className="mb-6 rounded-3xl border border-stone-700 bg-stone-900 p-5"><p className="text-sm font-semibold uppercase tracking-wide text-amber-300">Final Review</p><div className="mt-2 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">{specification.title}</h1><p className="mt-1 text-stone-300">Readiness: <strong>{specification.readiness.status.replaceAll("_", " ")}</strong></p></div><span className={`rounded-full border px-3 py-1 text-sm ${mode === "demo" ? "border-amber-600 text-amber-100" : "border-sky-600 text-sky-100"}`}>{mode === "demo" ? "Prepared demo • no AI call" : "Live AI"}</span></div><ul className="mt-4 list-disc pl-5 text-sm text-stone-300">{specification.readiness.evidence.map((value) => <li key={value}>{value}</li>)}</ul></header>
      {sessionLink && <div className="mb-6">{sessionLink}</div>}
      {persistentBrainStatus && <div className="sticky top-2 z-10 mb-6">{persistentBrainStatus}</div>}
      {specification.nextActions.length > 0 && <section aria-labelledby="next-actions-title" className="mb-6 rounded-3xl border border-stone-700 bg-stone-900 p-5"><h2 id="next-actions-title" className="text-2xl font-semibold">Next Actions</h2><p className="mt-1 text-sm text-stone-300">Confirm or edit the role-based Decision Owner and intended outcome.</p><div className="mt-4 space-y-4">{specification.nextActions.map((action) => <NextActionEditor key={action.id} action={action} onChange={update} />)}</div></section>}
      {staleDecisionSummaries.length > 0 && <div className="mb-6"><StaleWorkPanel staleReason={null} summaries={staleDecisionSummaries} mode={mode} /></div>}
      {decisionTray && <div className="mb-6">{decisionTray}</div>}
      <SpecificationPanel specification={specification} revision={revision} />
      <div className="sticky bottom-3 mt-6 flex flex-wrap gap-3 rounded-2xl border border-stone-700 bg-stone-950/95 p-3 shadow-xl"><button type="button" onClick={download} className="min-h-11 rounded-xl bg-amber-300 px-4 font-semibold text-stone-950">Download Markdown</button><button type="button" onClick={copy} className="min-h-11 rounded-xl border border-stone-600 px-4 font-semibold">Copy Markdown</button>{!finalized && <button type="button" onClick={onFinalize} className="min-h-11 rounded-xl border border-emerald-700 px-4 font-semibold text-emerald-200">Finalize specification</button>}<button type="button" onClick={onResume} className="min-h-11 rounded-xl border border-sky-700 px-4 font-semibold text-sky-200">Resume grilling</button>{confirmingExit ? <div role="group" aria-label="Confirm session exit" className="flex flex-wrap items-center gap-2"><span className="text-sm text-red-100">Clear all app-held Session Data?</span><button type="button" onClick={onExit} className="min-h-11 rounded-xl bg-red-800 px-4 font-semibold text-white">Yes, exit and clear</button><button type="button" onClick={() => setConfirmingExit(false)} className="min-h-11 rounded-xl border border-stone-600 px-4 font-semibold">Cancel</button></div> : <button type="button" onClick={() => setConfirmingExit(true)} className="min-h-11 rounded-xl border border-red-800 px-4 font-semibold text-red-200">Exit and clear session</button>}</div>
      <p aria-live="polite" className="mt-3 text-sm text-stone-300">{notice}</p>{fallback && <section className="mt-4"><label htmlFor="markdown-preview" className="font-semibold">Selectable Markdown preview</label><textarea id="markdown-preview" readOnly value={fallback} rows={16} className="mt-2 w-full rounded-xl border border-stone-600 bg-stone-950 p-3 font-mono text-sm" /></section>}
    </main>
  );
}
