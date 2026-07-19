import type { VisualAid } from "@/domain/types";
import { DiagramFrame } from "./RoleMap";

export function ProcessFlow({ aid }: { aid: Extract<VisualAid, { kind: "process_flow" }> }) {
  return <DiagramFrame aid={aid} layout="grid-cols-1 sm:grid-cols-3" />;
}
