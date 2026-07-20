"use client";

import { useRef, useState } from "react";
import type { ActiveLookahead, DecisionSummary, SessionState } from "@/domain/types";

type PendingRequest = NonNullable<SessionState["pendingRequest"]>;

export interface PendingWorkReviewProps {
  pendingRequest: PendingRequest | null;
  activeLookahead: ActiveLookahead | null;
  staleSummaries: DecisionSummary[];
  onAbandonAndReview: (reason: string) => void | Promise<void>;
  onKeepWorking: () => void;
}

export function PendingWorkReview({ pendingRequest, activeLookahead, staleSummaries, onAbandonAndReview, onKeepWorking }: PendingWorkReviewProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const lock = useRef(false);
  const pendingSummary = activeLookahead?.decisionSummary;
  const abandon = async () => {
    if (!confirmed || lock.current) return;
    lock.current = true;
    setAbandoning(true);
    try { await onAbandonAndReview("Pending Brain and lookahead work was explicitly abandoned for Final Review."); } catch { lock.current = false; setAbandoning(false); }
  };
  return <main className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-8"><section role="alertdialog" aria-labelledby="pending-review-title" aria-describedby="pending-review-description" className="w-full rounded-3xl border border-amber-700 bg-stone-900 p-6"><p className="text-sm font-semibold uppercase tracking-wide text-amber-300">Pending work</p><h1 id="pending-review-title" className="mt-2 text-3xl font-semibold">Review the last valid Specification?</h1><p id="pending-review-description" className="mt-3 leading-7 text-stone-300">Final Review can show the last validated revision now, but pending work must be explicitly abandoned. Late responses will be stale and rejected.</p><ul className="mt-4 space-y-2 text-sm">{pendingRequest && <li className="rounded-xl bg-stone-950 p-3">Authoritative Brain request <strong>{pendingRequest.requestId}</strong> is still pending.</li>}{activeLookahead && <li className="rounded-xl bg-stone-950 p-3">Lookahead <strong>{activeLookahead.approval.roadmapItemId}</strong> is {activeLookahead.status.replaceAll("_", " ")}.</li>}{pendingSummary && <li className="rounded-xl border border-amber-800 bg-amber-950/20 p-3">Decision Summary wording will be retained as <strong>not applied</strong>: {pendingSummary.text}</li>}{staleSummaries.length > 0 && <li className="rounded-xl bg-stone-950 p-3">{staleSummaries.length} earlier not-applied {staleSummaries.length === 1 ? "summary remains" : "summaries remain"} available for reuse.</li>}</ul><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-stone-600 p-3"><input type="checkbox" checked={confirmed} disabled={abandoning} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5" /><span>I understand pending work will not change the Specification and want to review the last valid revision.</span></label><div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={!confirmed || abandoning} onClick={() => void abandon()} className="min-h-11 rounded-xl bg-amber-300 px-4 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">{abandoning ? "Abandoning pending work…" : "Abandon pending work and review"}</button><button type="button" disabled={abandoning} onClick={onKeepWorking} className="min-h-11 rounded-xl border border-stone-600 px-4 font-semibold">Keep working</button></div><p aria-live="polite" className="mt-3 text-sm text-stone-400">{abandoning ? "Abandonment accepted. Late work will be rejected as stale." : "No pending work is abandoned until the explicit action above."}</p></section></main>;
}
