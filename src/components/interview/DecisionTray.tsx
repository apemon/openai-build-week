"use client";

import { useRef, useState } from "react";
import type { InterviewJob, InterviewJobStatus, NotAppliedReason } from "@/domain/v3-schemas";

const STATUS_LABELS: Record<InterviewJobStatus, string> = {
  approved: "Draft",
  presenting: "Draft",
  clarifying: "Draft",
  summary_draft: "Draft",
  paused: "Draft · questions paused",
  confirmed_queued: "Confirmed — awaiting dependency check",
  revalidation_pending: "Revalidation Pending",
  ready_to_apply: "Ready to apply",
  applying: "Applying",
  apply_failed: "Apply failed — retry available",
  applied: "Applied",
  not_applied: "Not Applied",
};

const NOT_APPLIED_COPY: Record<NotAppliedReason, string> = {
  dependency_invalidated: "Dependency checking rejected this work before Brain submission.",
  batch_failed: "The Brain may have processed this work, but no validated complete revision applied it.",
  cancelled: "The application stopped waiting and attempted cancellation. Provider execution may have continued, but no validated revision applied this work.",
  abandoned: "The Product Manager explicitly entered Final Review without applying this work.",
  superseded: "A newer correction or decision replaced this work’s relevance.",
};

export interface DecisionTrayProps {
  jobs: readonly InterviewJob[];
  activeJobId: string | null;
  questionsPaused?: boolean;
  onConfirm?: (jobId: string) => void | Promise<void>;
  onPause?: () => void | Promise<void>;
  onResume?: () => void | Promise<void>;
  onDefer?: (jobId: string, note: string | null) => void | Promise<void>;
  onUndo?: (jobId: string) => void | Promise<void>;
  onRetry?: (jobId: string) => void | Promise<void>;
  onReuse?: (wording: string) => void;
}

function wordingFor(job: InterviewJob): string | null {
  return job.decisionSummary?.text ?? job.deferral?.note ?? null;
}

export function DecisionTray({ jobs, activeJobId, questionsPaused = false, onConfirm, onPause, onResume, onDefer, onUndo, onRetry, onReuse }: DecisionTrayProps) {
  const [deferringJobId, setDeferringJobId] = useState<string | null>(null);
  const [deferralNote, setDeferralNote] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const locks = useRef(new Set<string>());
  const runOnce = async (key: string, callback: () => void | Promise<void>) => {
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setPendingAction(key);
    try { await callback(); } catch { locks.current.delete(key); setPendingAction((current) => current === key ? null : current); }
  };
  return (
    <section aria-labelledby="decision-tray-title" className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-200">Session-local</p><h2 id="decision-tray-title" className="mt-1 text-xl font-semibold">Decision Tray</h2><p className="mt-1 text-sm text-stone-400">Only validated Brain revisions change the Specification.</p></div>
        {questionsPaused ? onResume && <button type="button" disabled={pendingAction === "resume"} onClick={() => void runOnce("resume", onResume)} className="min-h-11 rounded-xl border border-violet-600 px-4 font-semibold disabled:text-stone-400">{pendingAction === "resume" ? "Resuming…" : "Resume questions"}</button> : onPause && <button type="button" disabled={pendingAction === "pause"} onClick={() => void runOnce("pause", onPause)} className="min-h-11 rounded-xl border border-stone-600 px-4 font-semibold disabled:text-stone-400">{pendingAction === "pause" ? "Pausing…" : "Pause questions"}</button>}
      </div>
      {jobs.length === 0 ? <p className="mt-4 text-sm text-stone-400">No asynchronous decisions yet.</p> : <ol className="mt-4 space-y-3">{jobs.map((job) => {
        const wording = wordingFor(job);
        const isActive = job.id === activeJobId;
        const canConfirm = job.status === "summary_draft" && Boolean(job.decisionSummary?.text.trim()) && Boolean(onConfirm);
        const canDefer = isActive && ["approved", "presenting", "clarifying", "summary_draft", "paused"].includes(job.status) && Boolean(onDefer);
        const confirmKey = `${job.id}:${job.status}:confirm`;
        const undoKey = `${job.id}:${job.status}:undo`;
        const retryKey = `${job.id}:${job.status}:retry`;
        const deferKey = `${job.id}:${job.status}:defer`;
        return <li key={job.id} className={`rounded-xl border p-3 ${isActive ? "border-violet-600 bg-violet-950/20" : "border-stone-700 bg-stone-950/40"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-stone-400">{job.permit.roadmapItemId}</span>{isActive && <span className="text-xs font-semibold text-violet-200">Active question</span>}</div><strong className="text-sm">{STATUS_LABELS[job.status]}</strong></div>
          {wording && <p className="mt-2 text-sm leading-6 text-stone-200">{wording}</p>}
          {job.status === "not_applied" && job.notAppliedReason && <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/20 p-3 text-sm"><p className="font-semibold">Not Applied · {job.notAppliedReason.replaceAll("_", " ")}</p><p className="mt-1 text-stone-300">{NOT_APPLIED_COPY[job.notAppliedReason]}</p>{job.notAppliedExplanation && <p className="mt-1 text-stone-300">Brain-owned reason: {job.notAppliedExplanation}</p>}</div>}
          <div className="mt-3 flex flex-wrap gap-2">
            {canConfirm && <button type="button" disabled={pendingAction === confirmKey} onClick={() => void runOnce(confirmKey, () => onConfirm?.(job.id))} className="min-h-11 rounded-xl bg-violet-300 px-4 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">{pendingAction === confirmKey ? "Confirming decision…" : "Confirm decision and continue"}</button>}
            {job.status === "confirmed_queued" && onUndo && <button type="button" disabled={pendingAction === undoKey} onClick={() => void runOnce(undoKey, () => onUndo(job.id))} className="min-h-11 rounded-xl border border-stone-600 px-4 font-semibold disabled:text-stone-400">{pendingAction === undoKey ? "Undoing confirmation…" : "Undo confirmation"}</button>}
            {job.status === "apply_failed" && onRetry && <button type="button" disabled={pendingAction === retryKey} onClick={() => void runOnce(retryKey, () => onRetry(job.id))} className="min-h-11 rounded-xl bg-stone-100 px-4 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">{pendingAction === retryKey ? "Retrying…" : "Retry"}</button>}
            {job.status === "not_applied" && wording && onReuse && <button type="button" onClick={() => onReuse(wording)} className="min-h-11 rounded-xl border border-amber-700 px-4 font-semibold text-amber-100">Reuse wording</button>}
            {canDefer && <button type="button" aria-expanded={deferringJobId === job.id} onClick={() => { setDeferringJobId((current) => current === job.id ? null : job.id); setDeferralNote(""); }} className="min-h-11 rounded-xl border border-stone-600 px-4 font-semibold">Defer this decision</button>}
          </div>
          {deferringJobId === job.id && <div className="mt-3 rounded-xl border border-stone-700 p-3"><label htmlFor={`defer-${job.id}`} className="text-sm font-semibold">Optional deferral note</label><p className="mt-1 text-xs text-stone-400">This note is not treated as the missing decision.</p><textarea id={`defer-${job.id}`} rows={3} maxLength={4_000} disabled={pendingAction === deferKey} value={deferralNote} onChange={(event) => setDeferralNote(event.target.value)} className="mt-2 w-full rounded-lg border border-stone-600 bg-stone-950 p-3" /><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={pendingAction === deferKey} onClick={() => void runOnce(deferKey, async () => { await onDefer?.(job.id, deferralNote.trim() || null); setDeferringJobId(null); setDeferralNote(""); })} className="min-h-11 rounded-lg bg-amber-300 px-4 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">{pendingAction === deferKey ? "Confirming deferral…" : "Confirm deferral"}</button><button type="button" disabled={pendingAction === deferKey} onClick={() => { setDeferringJobId(null); setDeferralNote(""); }} className="min-h-11 rounded-lg border border-stone-600 px-4 font-semibold">Cancel</button></div></div>}
        </li>;
      })}</ol>}
    </section>
  );
}
