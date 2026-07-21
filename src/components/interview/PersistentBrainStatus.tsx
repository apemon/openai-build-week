"use client";

import { useEffect, useMemo, useState } from "react";
import type { BrainActivityState } from "@/domain/v3-schemas";

export interface PersistentBrainActivity {
  state: BrainActivityState;
  actionId: string | null;
  acceptedAt: string | null;
  lastLifecycleAt: string | null;
  lastSequence: number | null;
}

export interface DerivedBrainStatus {
  state: BrainActivityState;
  label: string;
  detail: string;
  elapsedSeconds: number | null;
  lastActivityAgeSeconds: number | null;
  activeAnimation: boolean;
  announcement: string;
}

const STATE_COPY: Record<BrainActivityState, { label: string; detail: string }> = {
  working: { label: "Brain working", detail: "The last valid Specification remains available while this action runs." },
  taking_longer: { label: "Taking longer than usual", detail: "The Brain is still reporting verified activity." },
  connection_interrupted: { label: "Connection interrupted · Brain state unknown", detail: "No automatic restart was attempted." },
  needs_attention: {
    label: "Waiting for verified activity",
    detail: "No new verified lifecycle event has arrived. The current request may still be running; no automatic retry was started.",
  },
  timed_out: { label: "Timed out", detail: "No validated revision was applied." },
  revision_applied: { label: "Revision applied", detail: "The complete validated Specification revision is now current." },
  stopped: { label: "Stopped", detail: "No validated revision was applied after work stopped." },
};

function secondsBetween(start: string | null, nowMs: number): number | null {
  if (!start) return null;
  const parsed = Date.parse(start);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 1_000));
}

export function derivePersistentBrainStatus(activity: PersistentBrainActivity, nowMs: number): DerivedBrainStatus {
  const elapsedSeconds = secondsBetween(activity.acceptedAt, nowMs);
  const lastActivityAgeSeconds = secondsBetween(activity.lastLifecycleAt ?? activity.acceptedAt, nowMs);
  let state = activity.state;

  if (state === "working" || state === "taking_longer") {
    if (lastActivityAgeSeconds !== null && lastActivityAgeSeconds >= 10) state = "needs_attention";
    else if (elapsedSeconds !== null && elapsedSeconds >= 30) state = "taking_longer";
    else state = "working";
  }

  const copy = STATE_COPY[state];
  return {
    state,
    ...copy,
    elapsedSeconds,
    lastActivityAgeSeconds,
    activeAnimation: state === "working" || state === "taking_longer",
    announcement: state === "working" ? "" : `${copy.label}. ${copy.detail}`,
  };
}

function duration(seconds: number | null): string {
  if (seconds === null) return "not available";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export interface PersistentBrainStatusProps {
  activity: PersistentBrainActivity;
  nowMs?: number;
  mode?: "live" | "demo";
  onRetry?: () => void;
  onDismiss?: () => void;
  sticky?: boolean;
}

export function PersistentBrainStatus({ activity, nowMs, mode = "live", onRetry, onDismiss, sticky = true }: PersistentBrainStatusProps) {
  const [clock, setClock] = useState(() => nowMs ?? Date.now());
  useEffect(() => {
    if (nowMs !== undefined) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [nowMs]);

  const preparedClock = mode === "demo"
    ? Math.max(Date.parse(activity.acceptedAt ?? "") || 0, Date.parse(activity.lastLifecycleAt ?? "") || 0)
    : 0;
  const effectiveNow = nowMs ?? (preparedClock > 0 ? preparedClock : clock);
  const status = useMemo(() => derivePersistentBrainStatus(activity, effectiveNow), [activity, effectiveNow]);
  const requiresAction = status.state === "connection_interrupted" || status.state === "needs_attention" || status.state === "timed_out" || status.state === "stopped";

  return (
    <section aria-label="Persistent Brain Status" data-state={status.state} className={`${sticky ? "sticky top-2 z-[9]" : ""} rounded-2xl border border-stone-700 bg-stone-950/95 px-4 py-3 shadow-lg backdrop-blur`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="relative flex h-4 w-4 shrink-0 items-center justify-center">
            {status.activeAnimation && <span className="absolute h-4 w-4 animate-ping rounded-full bg-sky-300/45 motion-reduce:hidden" />}
            <span className={`h-2.5 w-2.5 rounded-full ${status.activeAnimation ? "bg-sky-300" : status.state === "revision_applied" ? "bg-emerald-300" : "bg-amber-300"}`} />
          </span>
          <div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><strong>{status.label}</strong>{mode === "demo" && <span className="text-xs font-semibold text-amber-200">Prepared fixture clock</span>}</div><p className="text-sm text-stone-300">{status.detail}</p></div>
        </div>
        <dl className="flex shrink-0 gap-4 text-xs text-stone-300"><div><dt className="font-semibold text-stone-400">Elapsed</dt><dd>{duration(status.elapsedSeconds)}</dd></div><div><dt className="font-semibold text-stone-400">Last verified</dt><dd>{duration(status.lastActivityAgeSeconds)} ago</dd></div></dl>
        {requiresAction && (onRetry || onDismiss) && <div className="flex flex-wrap gap-2">{onRetry && <button type="button" onClick={onRetry} className="min-h-11 rounded-xl bg-stone-100 px-4 font-semibold text-stone-950">Retry</button>}{onDismiss && <button type="button" onClick={onDismiss} className="min-h-11 rounded-xl border border-stone-600 px-4 font-semibold">Dismiss</button>}</div>}
      </div>
      <p aria-live="polite" aria-atomic="true" className="sr-only">{status.announcement}</p>
    </section>
  );
}
