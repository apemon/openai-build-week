"use client";

import { useId, useState } from "react";

export function TextComposer({ disabled = false, initialValue = "", actionLabel = "Review answer", onReview, onTyping }: { disabled?: boolean; initialValue?: string; actionLabel?: string; onReview: (text: string) => void; onTyping?: () => void }) {
  const id = useId();
  const [text, setText] = useState(initialValue);
  const nearLimit = text.length >= 3_600;
  const submit = () => { const trimmed = text.trim(); if (trimmed) onReview(trimmed); };
  return (
    <div className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
      <label htmlFor={id} className="font-semibold">Type an answer</label>
      <textarea id={id} rows={5} maxLength={4_000} disabled={disabled} value={text} onFocus={onTyping} onChange={(event) => { setText(event.target.value); onTyping?.(); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); } }} aria-describedby={`${id}-hint ${id}-count`} className="mt-2 w-full resize-y rounded-xl border border-stone-600 bg-stone-950 p-3 text-stone-50" />
      <div className="mt-2 flex items-center justify-between gap-3 text-sm">
        <span id={`${id}-hint`} className="text-stone-400">Enter adds a line · Ctrl/Cmd+Enter reviews</span>
        <span id={`${id}-count`} className={nearLimit ? "font-semibold text-amber-200" : "text-stone-400"}>{text.length}/4,000</span>
      </div>
      <button type="button" disabled={disabled || !text.trim()} onClick={submit} className="mt-3 min-h-11 rounded-xl bg-sky-300 px-5 py-2 font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-400">{actionLabel}</button>
    </div>
  );
}
