"use client";

import type { Specification, SpecificationItem } from "@/domain/types";
import type { ExternalEvidence } from "@/domain/v3-schemas";
import { ExternalEvidenceAppendix } from "./ExternalEvidence";
import { ProvenanceChip } from "./ProvenanceChip";
import { SpecificationSection } from "./SpecificationSection";

const sections = [
  ["problem", "Problem", "problemStatement"], ["users", "Users", "users"], ["jobs", "Jobs to be done", "jobsToBeDone"], ["functional", "Functional requirements", "functionalRequirements"], ["nonfunctional", "Non-functional requirements", "nonFunctionalRequirements"], ["assumptions", "Assumptions", "assumptions"], ["risks", "Risks", "risks"], ["edges", "Edge cases", "edgeCases"], ["blockers", "Blockers", "blockers"], ["questions", "Open Questions", "openQuestions"],
] as const;

export function SpecificationPanel({ specification, revision, changedItemIds, onCorrect }: { specification: Specification; revision: number; changedItemIds?: string[]; onCorrect?: (item: SpecificationItem) => void }) {
  const externalEvidence = "externalEvidence" in specification ? specification.externalEvidence as ExternalEvidence[] : [];
  return (
    <section aria-labelledby="specification-title" className="rounded-3xl border border-stone-700 bg-stone-900 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-wide text-stone-400">Revision {revision}</p><h2 id="specification-title" className="text-2xl font-semibold">{specification.title}</h2></div><span className="rounded-full border border-stone-600 px-3 py-1 text-sm">Readiness: {specification.readiness.status.replaceAll("_", " ")}</span></div>
      <nav aria-label="Specification sections" className="my-5 flex gap-2 overflow-x-auto pb-2">{sections.map(([id, title]) => <a key={id} href={`#${id}`} className="min-h-11 shrink-0 rounded-full border border-stone-700 px-3 py-3 text-sm text-stone-300">{title}</a>)}</nav>
      {sections.map(([id, title, key]) => <SpecificationSection key={id} id={id} title={title} items={specification[key]} changedItemIds={changedItemIds} onCorrect={onCorrect} externalEvidence={externalEvidence} />)}
      <section className="border-t border-stone-700 py-5"><h3 className="text-lg font-semibold">Acceptance Criteria <span className="text-sm font-normal text-stone-400">{specification.acceptanceCriteria.length}</span></h3><ul className="mt-3 space-y-3">{specification.acceptanceCriteria.map((criterion) => <li key={criterion.id} className="rounded-xl border border-stone-700 bg-stone-950/40 p-3"><div className="flex gap-2"><span className="font-mono text-xs text-stone-400">{criterion.id}</span><ProvenanceChip status={criterion.status} /></div><p className="mt-2">{criterion.format === "given_when_then" ? `Given ${criterion.given}; when ${criterion.when}; then ${criterion.then}.` : criterion.assertion}</p></li>)}</ul></section>
      <ExternalEvidenceAppendix evidence={externalEvidence} />
    </section>
  );
}
