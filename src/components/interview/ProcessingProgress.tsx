import type { ProcessingStage, SessionMode } from "@/domain/types";

const processingCopy: Record<ProcessingStage, { title: string; detail: string }> = {
  idle: { title: "Waiting for confirmed input", detail: "No authoritative Brain revision is currently running." },
  validating_confirmed_input: { title: "Validating confirmed input", detail: "Checking the Product Manager-confirmed wording and request boundary." },
  reviewing_contradictions: { title: "Reviewing contradictions", detail: "Checking the confirmed state for conflicts that need to remain visible." },
  reviewing_dependencies: { title: "Reviewing decision dependencies", detail: "Checking which unresolved decision areas depend on the current work." },
  revising_specification: { title: "Revising the Specification", detail: "Building a complete candidate revision while the last valid Specification stays visible." },
  planning_next_question: { title: "Planning the next decision", detail: "Validating the Question Roadmap and whether one independent lookahead is safe." },
};

export function ProcessingProgress({ stage, mode, currentTopic }: { stage: ProcessingStage; mode: SessionMode; currentTopic?: string | null }) {
  const copy = processingCopy[stage];
  return <section role="status" aria-live="polite" className="rounded-2xl border border-sky-800 bg-sky-950/30 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{copy.title}</p>{mode === "demo" && <span className="rounded-full border border-amber-600 px-2 py-1 text-xs text-amber-100">Prepared demo • no AI call</span>}</div><p className="mt-2 text-sm leading-6 text-stone-300">{copy.detail}</p>{currentTopic && <p className="mt-3 rounded-lg bg-stone-950/70 p-3 text-sm"><span className="text-stone-400">Current decision area:</span> {currentTopic}</p>}<p className="mt-3 text-xs text-stone-400">This is an application/provider lifecycle stage, not an estimated completion percentage or hidden reasoning.</p></section>;
}
