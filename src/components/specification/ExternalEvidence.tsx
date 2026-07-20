import type { ExternalEvidence } from "@/domain/v3-schemas";

function safeHttpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function retrievalLabel(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC") : "retrieval time unavailable";
}

export function ExternalEvidenceCitations({ evidence, evidenceIds }: { evidence: readonly ExternalEvidence[]; evidenceIds: readonly string[] }) {
  const citations = evidenceIds.map((id) => evidence.find((item) => item.id === id)).filter((item): item is ExternalEvidence => Boolean(item));
  if (citations.length === 0) return null;
  return <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">External Evidence</p><ul className="mt-1 space-y-2 text-sm">{citations.map((item) => {
    const url = safeHttpsUrl(item.url);
    return <li key={item.id} className="rounded-lg border border-stone-700 bg-stone-950/40 p-2"><div><span className="font-mono text-xs text-stone-400">{item.id}</span><span aria-hidden="true"> · </span><strong>{item.title}</strong></div>{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open external evidence ${item.id}: ${item.title} in a new tab`} className="mt-1 block break-all text-cyan-200 underline decoration-cyan-700 underline-offset-4">{url}</a> : <p className="mt-1 text-stone-400">Unsafe or unavailable URL</p>}<p className="mt-1 text-xs text-stone-400">Retrieved <time dateTime={item.retrievedAt}>{retrievalLabel(item.retrievedAt)}</time></p></li>;
  })}</ul></div>;
}

export function ExternalEvidenceAppendix({ evidence }: { evidence: readonly ExternalEvidence[] }) {
  if (evidence.length === 0) return null;
  return <section id="external-evidence" aria-labelledby="external-evidence-title" className="border-t border-stone-700 py-5"><h3 id="external-evidence-title" className="text-lg font-semibold">External Evidence <span className="text-sm font-normal text-stone-400">{evidence.length}</span></h3><p className="mt-1 text-sm text-stone-400">Public references support proposed content; they are not Confirmed Input.</p><ol className="mt-3 space-y-3">{evidence.map((item) => {
    const url = safeHttpsUrl(item.url);
    const informedItemIds = item.informedTargets.filter((target) => target.kind === "specification_item").map((target) => target.itemId);
    return <li key={item.id} className="rounded-xl border border-stone-700 bg-stone-950/40 p-3"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-stone-400">{item.id}</span><strong>{item.title}</strong></div><p className="mt-2 text-sm">{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open external evidence ${item.id}: ${item.title} in a new tab`} className="break-all text-cyan-200 underline decoration-cyan-700 underline-offset-4">{url}</a> : <span className="text-stone-400">Unsafe or unavailable URL</span>}</p><p className="mt-2 text-xs text-stone-400">Retrieved <time dateTime={item.retrievedAt}>{retrievalLabel(item.retrievedAt)}</time> · Informed Specification Items: {informedItemIds.join(", ") || "none"}</p></li>;
  })}</ol></section>;
}
