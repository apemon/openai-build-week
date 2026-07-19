import type { VisualAid } from "@/domain/types";

type RoleMapAid = Extract<VisualAid, { kind: "role_map" }>;

export function RoleMap({ aid }: { aid: RoleMapAid }) {
  return <DiagramFrame aid={aid} layout="grid-cols-1 sm:grid-cols-3" />;
}

export function DiagramFrame({ aid, layout }: { aid: VisualAid; layout: string }) {
  const labelById = new Map(aid.nodes.map((node) => [node.id, node.label]));
  return (
    <figure aria-labelledby={`${aid.nodes[0]?.id ?? "visual"}-title`} className="rounded-2xl border border-stone-700 bg-stone-950/60 p-4">
      <figcaption id={`${aid.nodes[0]?.id ?? "visual"}-title`} className="font-semibold text-stone-100">{aid.title}</figcaption>
      <div className={`mt-3 grid gap-3 ${layout}`} aria-hidden="true">
        {aid.nodes.map((node) => <div key={node.id} className="min-h-20 rounded-xl border border-sky-800 bg-sky-950/40 p-3"><strong className="block text-sky-100">{node.label}</strong>{node.description && <span className="mt-1 block text-sm text-stone-300">{node.description}</span>}</div>)}
      </div>
      <ul className="sr-only">
        {aid.nodes.map((node) => <li key={node.id}>{node.label}: {node.description ?? "No additional description"}</li>)}
        {aid.edges.map((edge) => <li key={edge.id}>{labelById.get(edge.from) ?? edge.from} {edge.label ?? "connects to"} {labelById.get(edge.to) ?? edge.to}</li>)}
      </ul>
      {aid.edges.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-sm text-stone-300" aria-hidden="true">{aid.edges.map((edge) => <span key={edge.id} className="rounded-full bg-stone-800 px-3 py-1">{labelById.get(edge.from)} → {edge.label && `${edge.label} → `}{labelById.get(edge.to)}</span>)}</div>}
    </figure>
  );
}
