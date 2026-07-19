import type { VisualAid } from "@/domain/types";
import { DiagramFrame } from "./RoleMap";

export function StateFlow({ aid }: { aid: Extract<VisualAid, { kind: "state_flow" }> }) {
  return <DiagramFrame aid={aid} layout="grid-cols-1 sm:grid-cols-3" />;
}
