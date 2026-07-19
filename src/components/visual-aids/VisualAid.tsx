import { visualAidSchema } from "@/domain/schemas";
import type { VisualAid as VisualAidValue } from "@/domain/types";
import { ProcessFlow } from "./ProcessFlow";
import { RoleMap } from "./RoleMap";
import { StateFlow } from "./StateFlow";

export function VisualAid({ aid }: { aid: VisualAidValue }) {
  const parsed = visualAidSchema.safeParse(aid);
  if (!parsed.success) return <p role="status" className="rounded-xl border border-amber-700 p-3 text-sm text-amber-100">This Visual Aid could not be validated. The Interview Prompt remains available in text.</p>;
  switch (parsed.data.kind) {
    case "role_map": return <RoleMap aid={parsed.data} />;
    case "process_flow": return <ProcessFlow aid={parsed.data} />;
    case "state_flow": return <StateFlow aid={parsed.data} />;
  }
}
