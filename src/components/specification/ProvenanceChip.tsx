import type { ItemStatus } from "@/domain/types";

const labels: Record<ItemStatus, string> = { confirmed: "Confirmed", derived: "Derived", proposed: "Proposed", unresolved: "Unresolved" };
export function ProvenanceChip({ status }: { status: ItemStatus }) {
  const tone = status === "confirmed" ? "border-emerald-700 text-emerald-200" : status === "unresolved" ? "border-amber-700 text-amber-200" : "border-stone-600 text-stone-300";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>{labels[status]}</span>;
}
