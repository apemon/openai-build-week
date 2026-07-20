import { z } from "zod";

import { lookaheadApprovalSchema } from "@/domain/schemas";
import type { LookaheadApproval } from "@/domain/types";

const clarificationInputSchema = z.string().trim().min(1).max(4_000);

export interface TextFallbackDecisionSummary {
  roadmapItemId: string;
  text: string;
  uncertainties: string[];
  provenance: "product_manager_text_only";
}

/** Deterministic text fallback for sessions without a Realtime connection.
 * It preserves Product Manager wording verbatim and performs no interpretation,
 * reconciliation, recommendation, or authority-bearing state mutation. */
export function createTextFallbackDecisionSummary(
  approval: LookaheadApproval,
  productManagerInputs: string[],
): TextFallbackDecisionSummary {
  const scopedApproval = lookaheadApprovalSchema.parse(approval);
  const inputs = z.array(clarificationInputSchema).min(1).max(20).parse(productManagerInputs);
  const text = inputs.join("\n\n");
  if (text.length > 4_000) {
    throw new Error("The verbatim text fallback summary exceeds the editable summary limit.");
  }

  return {
    roadmapItemId: scopedApproval.roadmapItemId,
    text,
    uncertainties: [],
    provenance: "product_manager_text_only",
  };
}
