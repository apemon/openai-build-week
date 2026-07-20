"use client";

import { useRef, useState } from "react";
import type { ProjectContextDigest, SessionMode, SourceReference } from "@/domain/types";

export type DigestConfirmationState = "idle" | "confirming" | "confirmed";

function referenceLabel(reference: SourceReference, sources: ProjectContextDigest["sources"]): string {
  const source = sources.find((candidate) => candidate.id === reference.sourceId);
  const name = source?.filename ?? (source?.kind === "initial_prompt" ? "Initial Prompt" : "Pasted context");
  return `${name} · ${reference.location}`;
}

export interface ProjectContextDigestReviewProps {
  digest: ProjectContextDigest;
  warningAcknowledged: boolean;
  mode: SessionMode;
  confirmationState?: DigestConfirmationState;
  onDigestChange: (digest: ProjectContextDigest) => void;
  onWarningAcknowledged: (acknowledged: boolean) => void;
  onConfirm: () => void | Promise<void>;
  onRetry?: () => void;
  onReplace?: () => void;
  onRemove?: () => void;
}

export function ProjectContextDigestReview(props: ProjectContextDigestReviewProps) {
  const [localState, setLocalState] = useState<DigestConfirmationState>(props.confirmationState ?? "idle");
  const lock = useRef(false);
  const confirmationState = props.confirmationState ?? localState;
  const acknowledgementRequired = props.digest.coverage.requiresAcknowledgement;
  const blocked = acknowledgementRequired && !props.warningAcknowledged;
  const updateStatement = (index: number, statement: string) => props.onDigestChange({ ...props.digest, statements: props.digest.statements.map((value, candidate) => candidate === index ? { ...value, statement } : value) });
  const confirm = async () => {
    if (lock.current || confirmationState !== "idle" || blocked || props.digest.statements.some((statement) => !statement.statement.trim())) return;
    lock.current = true;
    setLocalState("confirming");
    try { await props.onConfirm(); } catch { lock.current = false; setLocalState("idle"); }
  };
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Confirmation gate</p><h1 className="mt-2 text-4xl font-semibold">Review Project Context Digest</h1><p className="mt-3 max-w-3xl leading-7 text-stone-300">Edit each retained statement and check its source. Only the wording you explicitly confirm becomes Confirmed Input.</p></div><span className={`rounded-full border px-3 py-1 text-sm ${props.mode === "demo" ? "border-amber-600 text-amber-100" : "border-sky-600 text-sky-100"}`}>{props.mode === "demo" ? "Prepared demo • no AI call" : "Live AI"}</span></header>
      <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="space-y-4">{props.digest.statements.map((statement, index) => <article key={statement.id} className="rounded-2xl border border-stone-700 bg-stone-900 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={`digest-${statement.id}`} className="font-semibold">{statement.id}</label><span className="text-xs text-stone-400">Editable confirmed wording</span></div><textarea id={`digest-${statement.id}`} value={statement.statement} disabled={confirmationState !== "idle"} onChange={(event) => updateStatement(index, event.target.value)} rows={Math.min(7, Math.max(3, Math.ceil(statement.statement.length / 100)))} maxLength={4_000} className="mt-3 w-full rounded-xl border border-stone-600 bg-stone-950 p-3" /><ul aria-label={`${statement.id} sources`} className="mt-3 space-y-1 text-xs text-stone-400">{statement.sourceReferences.map((reference, referenceIndex) => <li key={`${reference.sourceId}-${reference.location}-${referenceIndex}`}>Source: {referenceLabel(reference, props.digest.sources)}</li>)}</ul></article>)}</div>
        <aside className="space-y-4"><section className="rounded-2xl border border-stone-700 bg-stone-900 p-4"><h2 className="font-semibold">Recovered coverage</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-300">{props.digest.coverage.coveredLocations.map((location) => <li key={location}>{location}</li>)}</ul></section>{props.digest.coverage.omissions.length > 0 && <section className="rounded-2xl border border-amber-700 bg-amber-950/20 p-4"><h2 className="font-semibold text-amber-100">Known omissions</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-200">{props.digest.coverage.omissions.map((omission) => <li key={omission}>{omission}</li>)}</ul></section>}{props.digest.coverage.warnings.length > 0 && <section className="rounded-2xl border border-amber-700 bg-amber-950/20 p-4"><h2 className="font-semibold text-amber-100">Extraction warnings</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-200">{props.digest.coverage.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}<section className="rounded-2xl border border-stone-700 bg-stone-900 p-4"><h2 className="font-semibold">Source handling</h2><p className="mt-2 text-sm leading-6 text-stone-300">Original file bytes were discarded after preparation. The active tab may temporarily retain the source-addressable extraction; the confirmed digest can survive reload, but deep source lookup then requires re-upload.</p></section></aside>
      </section>
      {acknowledgementRequired && <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-700 bg-amber-950/20 p-4"><input type="checkbox" checked={props.warningAcknowledged} disabled={confirmationState !== "idle"} onChange={(event) => props.onWarningAcknowledged(event.target.checked)} className="mt-1 h-5 w-5" /><span><strong>I reviewed the known gaps.</strong><span className="mt-1 block text-sm text-stone-300">I understand the digest may be confirmed only with these omissions and warnings visible; Spec Grill will not guess the missing content.</span></span></label>}
      <div className="mt-6 flex flex-wrap items-center gap-3"><button type="button" disabled={blocked || confirmationState !== "idle"} onClick={() => void confirm()} className="min-h-11 rounded-xl bg-amber-300 px-5 py-3 font-semibold text-stone-950 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400">{confirmationState === "confirming" ? "Confirming digest…" : confirmationState === "confirmed" ? "Digest confirmed" : props.mode === "demo" ? "Confirm prepared digest" : "Confirm digest and start interview"}</button>{props.onRetry && <button type="button" disabled={confirmationState !== "idle"} onClick={props.onRetry} className="min-h-11 rounded-xl border border-stone-600 px-4">Retry extraction</button>}{props.onReplace && <button type="button" disabled={confirmationState !== "idle"} onClick={props.onReplace} className="min-h-11 rounded-xl border border-stone-600 px-4">Replace source</button>}{props.onRemove && <button type="button" disabled={confirmationState !== "idle"} onClick={props.onRemove} className="min-h-11 rounded-xl border border-red-800 px-4 text-red-100">Remove source and continue with Initial Prompt</button>}<p aria-live="polite" className="text-sm text-stone-300">{blocked ? "Acknowledge the visible warnings before confirmation." : confirmationState === "confirming" ? "Confirmation accepted. The interview has not started yet." : "No source statement affects the Specification before this confirmation."}</p></div>
    </main>
  );
}
