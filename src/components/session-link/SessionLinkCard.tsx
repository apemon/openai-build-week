"use client";

import { useId, useState } from "react";

export interface SessionLinkCardProps {
  sessionUrl: string;
  threadId: string;
  expiresAt: string;
  onCopy?: (sessionUrl: string) => void | Promise<void>;
}

type CopyState = "idle" | "copying" | "copied" | "failed";

function abbreviateThreadId(threadId: string): string {
  const bounded = threadId.trim().slice(0, 128);
  if (bounded.length <= 18) return bounded;
  return `${bounded.slice(0, 8)}…${bounded.slice(-6)}`;
}

function formatExpiry(expiresAt: string): string {
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) return "Expiry unavailable";
  return `Expires ${new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC")}`;
}

export function SessionLinkCard({ sessionUrl, threadId, expiresAt, onCopy }: SessionLinkCardProps) {
  const titleId = useId();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copy = async () => {
    if (copyState === "copying") return;
    setCopyState("copying");
    try {
      if (onCopy) await onCopy(sessionUrl);
      else {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(sessionUrl);
      }
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  const status = copyState === "copied"
    ? "Session link copied."
    : copyState === "failed"
      ? "Could not copy session link."
      : "";

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-sky-800 bg-sky-950/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-200">Live session</p>
          <h2 id={titleId} className="mt-1 text-lg font-semibold">Hackathon Codex session</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-300">Resumes on this machine only while the matching browser checkpoint and local Codex session exist.</p>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-stone-400">
            <div><dt className="inline font-semibold">Session ID</dt><dd className="ml-2 inline font-mono" title="Abbreviated session ID">{abbreviateThreadId(threadId)}</dd></div>
            <div><dt className="sr-only">Checkpoint expiry</dt><dd><time dateTime={expiresAt}>{formatExpiry(expiresAt)}</time></dd></div>
          </dl>
        </div>
        <button type="button" disabled={copyState === "copying"} onClick={() => void copy()} className="min-h-11 shrink-0 rounded-xl bg-sky-300 px-4 py-2 font-semibold text-stone-950 disabled:cursor-wait disabled:bg-stone-700 disabled:text-stone-400">{copyState === "copying" ? "Copying…" : "Copy session link"}</button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-stone-300">{status}</p>
    </section>
  );
}
