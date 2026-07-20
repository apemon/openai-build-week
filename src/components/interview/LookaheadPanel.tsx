"use client";

import { useRef, useState } from "react";
import type { ActiveLookahead, SessionMode } from "@/domain/types";

export interface LookaheadPanelProps {
  active: ActiveLookahead;
  mode: SessionMode;
  disabled?: boolean;
  onClarification: (text: string) => void | Promise<void>;
  onRequestSummary: () => void | Promise<void>;
  onSummaryChange: (text: string) => void;
  onConfirmSummary: () => void | Promise<void>;
}

type PendingAction = { action: "clarification" | "summary" | "confirm"; resetKey: string } | null;

export function LookaheadPanel({ active, mode, disabled = false, onClarification, onRequestSummary, onSummaryChange, onConfirmSummary }: LookaheadPanelProps) {
  const [clarification, setClarification] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const lock = useRef<string | null>(null);
  const resetKey = `${active.status}:${active.clarificationTurns.length}:${active.decisionSummary?.status ?? "none"}`;
  const visiblePendingAction = pendingAction?.resetKey === resetKey ? pendingAction.action : null;
  const runOnce = async (action: NonNullable<PendingAction>["action"], callback: () => void | Promise<void>) => {
    if (lock.current === resetKey || disabled) return;
    lock.current = resetKey;
    setPendingAction({ action, resetKey });
    try { await callback(); } catch { lock.current = null; setPendingAction(null); }
  };
  const summary = active.decisionSummary;
  const queued = active.status === "queued" || summary?.status === "confirmed_queued";
  return (
    <section aria-labelledby="lookahead-title" className="rounded-2xl border border-violet-700 bg-violet-950/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-200">One safe lookahead</p><h2 id="lookahead-title" className="mt-1 text-xl font-semibold">{active.approval.prompt.detailedQuestion}</h2></div><span className="rounded-full border border-violet-600 px-3 py-1 text-xs">Brain-approved · revision {active.approval.approvedAtRevision}</span></div>
      {mode === "demo" && <p className="mt-3 text-sm font-medium text-amber-100">Prepared demo • no AI call</p>}
      <p className="mt-3 text-sm leading-6 text-stone-300">{active.approval.prompt.whyItMatters}</p>
      <p className="mt-2 text-xs text-stone-400">This clarification stays within one approved decision: {active.approval.roadmapItemId}. It cannot change the Specification.</p>
      {active.clarificationTurns.length > 0 && <ol aria-label="Clarification exchange" className="mt-4 space-y-2">{active.clarificationTurns.map((turn) => <li key={turn.id} className={`rounded-xl p-3 text-sm ${turn.role === "product_manager" ? "ml-5 bg-stone-800" : "mr-5 border border-stone-700 bg-stone-950"}`}><strong>{turn.role === "product_manager" ? "Product Manager" : "Communicator"}:</strong> {turn.text}</li>)}</ol>}
      {!summary && !queued && <div className="mt-4"><label htmlFor="lookahead-clarification" className="font-semibold">Clarify this decision</label><textarea id="lookahead-clarification" value={clarification} disabled={disabled || Boolean(visiblePendingAction)} onChange={(event) => setClarification(event.target.value)} rows={4} maxLength={4_000} className="mt-2 w-full rounded-xl border border-stone-600 bg-stone-950 p-3" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={disabled || Boolean(visiblePendingAction) || !clarification.trim()} onClick={() => void runOnce("clarification", async () => { await onClarification(clarification.trim()); setClarification(""); })} className="min-h-11 rounded-xl bg-violet-300 px-4 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">{visiblePendingAction === "clarification" ? "Sending clarification…" : "Send clarification"}</button><button type="button" disabled={disabled || Boolean(visiblePendingAction) || active.clarificationTurns.length === 0} onClick={() => void runOnce("summary", onRequestSummary)} className="min-h-11 rounded-xl border border-violet-600 px-4 font-semibold text-violet-100 disabled:border-stone-700 disabled:text-stone-500">{visiblePendingAction === "summary" ? "Creating summary…" : "Create Decision Summary"}</button></div></div>}
      {summary && <div className="mt-4 rounded-2xl border border-stone-600 bg-stone-950 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="decision-summary" className="font-semibold">Decision Summary</label><span className="rounded-full border border-stone-600 px-2 py-1 text-xs">Non-authoritative</span></div><textarea id="decision-summary" value={summary.text} disabled={disabled || queued || Boolean(visiblePendingAction)} onChange={(event) => onSummaryChange(event.target.value)} rows={5} maxLength={4_000} className="mt-3 w-full rounded-xl border border-stone-600 bg-stone-900 p-3" />{summary.uncertainties.length > 0 && <div className="mt-3 rounded-xl border border-amber-800 bg-amber-950/20 p-3"><p className="font-semibold text-amber-100">Uncertainty retained</p><ul className="mt-1 list-disc pl-5 text-sm text-stone-300">{summary.uncertainties.map((uncertainty) => <li key={uncertainty}>{uncertainty}</li>)}</ul></div>}<button type="button" disabled={disabled || queued || Boolean(visiblePendingAction) || !summary.text.trim()} onClick={() => void runOnce("confirm", onConfirmSummary)} className="mt-4 min-h-11 rounded-xl bg-violet-300 px-4 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">{queued ? "Queued pending revalidation" : visiblePendingAction === "confirm" ? "Queueing summary…" : "Confirm and queue pending revalidation"}</button><p aria-live="polite" className="mt-2 text-xs text-stone-400">{queued ? "Confirmed wording is queued. It reaches the Brain only if the authoritative revision applies first and dependency revalidation succeeds." : "Confirmation does not apply this summary to the Specification."}</p></div>}
    </section>
  );
}
