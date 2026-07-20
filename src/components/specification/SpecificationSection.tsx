"use client";

import type { SpecificationItem } from "@/domain/types";
import type { ExternalEvidence } from "@/domain/v3-schemas";
import { ExternalEvidenceCitations } from "./ExternalEvidence";
import { ProvenanceChip } from "./ProvenanceChip";

type EvidenceAwareItem = SpecificationItem & { externalEvidenceIds?: string[] };

export function SpecificationSection({ id, title, items, changedItemIds = [], onCorrect, externalEvidence = [] }: { id: string; title: string; items: EvidenceAwareItem[]; changedItemIds?: string[]; onCorrect?: (item: SpecificationItem) => void; externalEvidence?: readonly ExternalEvidence[] }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-stone-700 py-5 first:border-t-0 first:pt-0">
      <h3 id={`${id}-title`} className="text-lg font-semibold">{title} <span className="text-sm font-normal text-stone-400">{items.length}</span></h3>
      {items.length ? <ul className="mt-3 space-y-3">{items.map((item) => <li key={item.id} className={`rounded-xl border p-3 ${changedItemIds.includes(item.id) ? "border-sky-600 bg-sky-950/25" : "border-stone-700 bg-stone-950/40"}`}>
        <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-stone-400">{item.id}</span><ProvenanceChip status={item.status} />{changedItemIds.includes(item.id) && <span className="text-xs font-semibold text-sky-200">Changed this revision</span>}</div>
        <p className="mt-2 leading-6 text-stone-200">{item.statement}</p>
        <p className="mt-2 text-xs text-stone-400">Sources: {item.sourceTurnIds.join(", ") || "none"}</p>
        <ExternalEvidenceCitations evidence={externalEvidence} evidenceIds={item.externalEvidenceIds ?? []} />
        {onCorrect && <button type="button" onClick={() => onCorrect(item)} className="mt-2 min-h-11 rounded-lg px-3 text-sm font-semibold text-sky-200 underline decoration-sky-700 underline-offset-4">Correct or challenge</button>}
      </li>)}</ul> : <p className="mt-2 text-sm text-stone-400">Nothing recorded yet.</p>}
    </section>
  );
}
