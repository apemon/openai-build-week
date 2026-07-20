"use client";

import { useMemo, useRef, useState } from "react";
import {
  CONTEXT_FILE_MAX_BYTES,
  INITIAL_PROMPT_MAX_CHARACTERS,
  PASTED_CONTEXT_MAX_CHARACTERS,
  SUPPORTED_CONTEXT_EXTENSIONS,
  validateContextInput,
} from "@/context/limits";
import type { SessionMode } from "@/domain/types";

export interface PreparedContextSample {
  id: string;
  filename: string;
  description: string;
  markdown: string;
}

export interface ContextIntakeSubmission {
  initialPrompt: string;
  pastedContext: string;
  file: File | null;
  preparedSampleId: string | null;
}

export interface ContextIntakeProps {
  mode: SessionMode;
  disabled?: boolean;
  initialValues?: { initialPrompt?: string; pastedContext?: string };
  preparedSample?: PreparedContextSample;
  onPrepare: (input: ContextIntakeSubmission) => void | Promise<void>;
}

function Counter({ value, limit }: { value: number; limit: number }) {
  const nearLimit = value >= limit * 0.9;
  return <span className={`text-xs ${value > limit ? "text-red-300" : nearLimit ? "text-amber-200" : "text-stone-400"}`}>{value.toLocaleString()} / {limit.toLocaleString()}</span>;
}

export function ContextIntake({ mode, disabled = false, initialValues, preparedSample, onPrepare }: ContextIntakeProps) {
  const [initialPrompt, setInitialPrompt] = useState(initialValues?.initialPrompt ?? (mode === "demo" ? "We need team billing for our SaaS." : ""));
  const [pastedContext, setPastedContext] = useState(initialValues?.pastedContext ?? "");
  const [sourceMode, setSourceMode] = useState<"paste" | "file">("paste");
  const [file, setFile] = useState<File | null>(null);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionLock = useRef(false);
  const provenance = mode === "demo" ? "Prepared demo • no AI call" : "Live AI";
  const activePastedContext = mode === "demo" ? preparedSample?.markdown ?? "" : pastedContext;
  const canPrepare = useMemo(() => {
    if (mode === "demo") return Boolean(preparedSample && initialPrompt.trim());
    return validateContextInput({ initialPrompt, pastedContext: sourceMode === "paste" ? pastedContext : "", file: sourceMode === "file" ? file : null }).valid;
  }, [file, initialPrompt, mode, pastedContext, preparedSample, sourceMode]);

  const selectFile = (candidate: File | null) => {
    if (!candidate) return;
    const validation = validateContextInput({ initialPrompt: initialPrompt || "placeholder", pastedContext: "", file: candidate });
    if (!validation.valid) {
      setError(validation.message);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError("");
    if (file) setReplacement(candidate);
    else setFile(candidate);
  };

  const prepare = async () => {
    if (actionLock.current || disabled) return;
    const submission: ContextIntakeSubmission = {
      initialPrompt,
      pastedContext: mode === "demo" ? activePastedContext : sourceMode === "paste" ? pastedContext : "",
      file: mode === "live" && sourceMode === "file" ? file : null,
      preparedSampleId: mode === "demo" ? preparedSample?.id ?? null : null,
    };
    const validation = validateContextInput(submission);
    if (!validation.valid) {
      setError(validation.message);
      return;
    }
    actionLock.current = true;
    setPreparing(true);
    setError("");
    try {
      await onPrepare(submission);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Project context could not be prepared.");
      actionLock.current = false;
      setPreparing(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Project setup</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">Start with reviewed context</h1><p className="mt-3 max-w-3xl leading-7 text-stone-300">Add a short Initial Prompt and, optionally, either pasted Markdown/plain text or one supported document. Nothing affects the Specification until you confirm the Project Context Digest.</p></div>
        <span className={`rounded-full border px-3 py-1 text-sm ${mode === "demo" ? "border-amber-600 text-amber-100" : "border-sky-600 text-sky-100"}`}>{provenance}</span>
      </header>

      <section className="mt-7 rounded-3xl border border-stone-700 bg-stone-900 p-5 sm:p-7" aria-labelledby="initial-prompt-title">
        <div className="flex items-end justify-between gap-3"><label id="initial-prompt-title" htmlFor="initial-prompt" className="text-xl font-semibold">Initial Prompt <span className="text-sm font-normal text-stone-400">required</span></label><Counter value={initialPrompt.length} limit={INITIAL_PROMPT_MAX_CHARACTERS} /></div>
        <textarea id="initial-prompt" value={initialPrompt} disabled={disabled || preparing} onChange={(event) => setInitialPrompt(event.target.value)} rows={4} maxLength={INITIAL_PROMPT_MAX_CHARACTERS + 1} aria-describedby="initial-prompt-help" className="mt-3 w-full rounded-xl border border-stone-600 bg-stone-950 p-4" placeholder="What do you want to build, and what current pain should it solve?" />
        <p id="initial-prompt-help" className="mt-2 text-sm text-stone-400">This statement becomes Confirmed Input only after digest review.</p>
      </section>

      {mode === "demo" && preparedSample ? (
        <section className="mt-5 rounded-3xl border border-amber-700/70 bg-amber-950/20 p-5 sm:p-7" aria-labelledby="sample-context-title">
          <p className="text-sm font-semibold text-amber-200">Bundled sample document</p><h2 id="sample-context-title" className="mt-1 text-2xl font-semibold">{preparedSample.filename}</h2><p className="mt-2 text-stone-300">{preparedSample.description}</p><p className="mt-4 rounded-xl bg-stone-950 p-3 text-sm text-stone-300">This prepared source is bundled with the app. It does not read a user file or make a network, microphone, or AI call.</p>
        </section>
      ) : (
        <section className="mt-5 rounded-3xl border border-stone-700 bg-stone-900 p-5 sm:p-7" aria-labelledby="optional-context-title">
          <div><h2 id="optional-context-title" className="text-2xl font-semibold">Optional project context</h2><p className="mt-1 text-sm text-stone-400">Choose one source. Files: {SUPPORTED_CONTEXT_EXTENSIONS.join(", ")} · up to {(CONTEXT_FILE_MAX_BYTES / 1_000_000).toLocaleString()} MB.</p></div>
          <div role="tablist" aria-label="Context source" className="mt-4 grid grid-cols-2 rounded-xl border border-stone-700 p-1">
            <button type="button" role="tab" aria-selected={sourceMode === "paste"} disabled={preparing || disabled} onClick={() => setSourceMode("paste")} className={`min-h-11 rounded-lg px-3 ${sourceMode === "paste" ? "bg-stone-700 font-semibold" : "text-stone-300"}`}>Paste text</button>
            <button type="button" role="tab" aria-selected={sourceMode === "file"} disabled={preparing || disabled} onClick={() => setSourceMode("file")} className={`min-h-11 rounded-lg px-3 ${sourceMode === "file" ? "bg-stone-700 font-semibold" : "text-stone-300"}`}>Upload one file</button>
          </div>
          {sourceMode === "paste" ? <div className="mt-4"><div className="flex items-end justify-between gap-3"><label htmlFor="pasted-context" className="font-semibold">Markdown or plain text</label><Counter value={pastedContext.length} limit={PASTED_CONTEXT_MAX_CHARACTERS} /></div><textarea id="pasted-context" value={pastedContext} disabled={preparing || disabled} onChange={(event) => setPastedContext(event.target.value)} rows={14} maxLength={PASTED_CONTEXT_MAX_CHARACTERS + 1} className="mt-2 w-full rounded-xl border border-stone-600 bg-stone-950 p-4 font-mono text-sm" placeholder="# Project notes" /></div> : <div className="mt-4"><label htmlFor="context-file" className="font-semibold">Project document</label><input ref={fileInputRef} id="context-file" type="file" accept={SUPPORTED_CONTEXT_EXTENSIONS.join(",")} disabled={preparing || disabled} onChange={(event) => selectFile(event.target.files?.[0] ?? null)} className="mt-2 block min-h-11 w-full rounded-xl border border-stone-600 bg-stone-950 p-3 file:mr-4 file:rounded-lg file:border-0 file:bg-stone-200 file:px-3 file:py-2 file:font-semibold file:text-stone-950" />{file && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-stone-950 p-3"><span><strong>{file.name}</strong> <span className="text-sm text-stone-400">({(file.size / 1_000_000).toFixed(2)} MB)</span></span><button type="button" disabled={preparing || disabled} onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="min-h-11 rounded-lg border border-stone-600 px-3">Remove</button></div>}</div>}
        </section>
      )}

      {replacement && <section role="alertdialog" aria-labelledby="replace-file-title" aria-describedby="replace-file-description" className="mt-5 rounded-2xl border border-amber-700 bg-amber-950/30 p-4"><h2 id="replace-file-title" className="font-semibold">Replace the selected file?</h2><p id="replace-file-description" className="mt-1 text-sm text-stone-300">{replacement.name} will replace {file?.name}. The files will not be merged.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => { setFile(replacement); setReplacement(null); }} className="min-h-11 rounded-lg bg-amber-300 px-4 font-semibold text-stone-950">Replace file</button><button type="button" onClick={() => { setReplacement(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="min-h-11 rounded-lg border border-stone-600 px-4">Keep current file</button></div></section>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-100">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-3"><button type="button" disabled={!canPrepare || disabled || preparing} onClick={() => void prepare()} className="min-h-11 rounded-xl bg-amber-300 px-5 py-3 font-semibold text-stone-950 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400">{preparing ? "Preparing context…" : mode === "demo" ? "Prepare bundled context" : "Prepare context"}</button><p aria-live="polite" className="text-sm text-stone-300">{preparing ? "Input accepted. Validation and extraction are starting." : "You will review and confirm the digest before the interview starts."}</p></div>
    </main>
  );
}
