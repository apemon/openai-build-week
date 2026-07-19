import type { SessionProvenance } from "@/domain/types";

export function provenanceLabel(provenance: SessionProvenance): string {
  return provenance.source === "prepared_demo" ? "Prepared demo • no AI call" : "Live AI";
}
