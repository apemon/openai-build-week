import type { SessionMode } from "@/domain/types";

export type ContextPreparationStage = "validating_input" | "extracting_text" | "building_digest" | "validating_digest";

const stageCopy: Record<ContextPreparationStage, { title: string; detail: string }> = {
  validating_input: { title: "Validating context", detail: "Checking the selected source, type, size, and agreed product limits." },
  extracting_text: { title: "Recovering source text", detail: "Reading temporary source locations. Original file bytes are discarded after this request." },
  building_digest: { title: "Building the digest", detail: "Preparing editable source-linked statements, coverage, omissions, and warnings." },
  validating_digest: { title: "Validating the digest", detail: "Checking provenance and coverage before anything can be shown for confirmation." },
};

export function ContextPreparationProgress({ stage, mode, sourceLabel }: { stage: ContextPreparationStage; mode: SessionMode; sourceLabel?: string }) {
  const copy = stageCopy[stage];
  return <main className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-8"><section role="status" aria-live="polite" className="w-full rounded-3xl border border-stone-700 bg-stone-900 p-7"><span className={`rounded-full border px-3 py-1 text-sm ${mode === "demo" ? "border-amber-600 text-amber-100" : "border-sky-600 text-sky-100"}`}>{mode === "demo" ? "Prepared demo • no AI call" : "Live AI"}</span><p className="mt-6 text-sm font-semibold uppercase tracking-wide text-amber-300">Project context preparation</p><h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1><p className="mt-3 leading-7 text-stone-300">{copy.detail}</p>{sourceLabel && <p className="mt-4 rounded-xl bg-stone-950 p-3 text-sm">Source: {sourceLabel}</p>}<p className="mt-5 text-sm text-stone-400">Progress reflects the current application stage; no completion percentage is estimated.</p></section></main>;
}
