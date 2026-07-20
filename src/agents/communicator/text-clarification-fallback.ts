import { z } from "zod";

import { lookaheadApprovalSchema } from "@/domain/schemas";
import type { LookaheadApproval } from "@/domain/types";
import {
  exchangeIdentitySchema,
  questionPermitSchema,
  type ExchangeIdentity,
  type QuestionPermit,
} from "@/domain/v3-schemas";

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

export interface V3TextFallbackDecisionSummary {
  roadmapItemId: string;
  text: string;
  uncertainties: string[];
  provenance: "product_manager_text_only";
  identity: ExchangeIdentity;
}

/** V3 text fallback carries the same immutable application identity as voice
 * and remains non-authoritative until PM confirmation and revalidation. */
export function createV3TextFallbackDecisionSummary(
  permit: QuestionPermit,
  identity: ExchangeIdentity,
  productManagerInputs: string[],
): V3TextFallbackDecisionSummary {
  const scopedPermit = questionPermitSchema.parse(permit);
  const scopedIdentity = exchangeIdentitySchema.parse(identity);
  if (
    scopedIdentity.kind !== "permitted"
    || scopedIdentity.permitId !== scopedPermit.id
    || scopedIdentity.promptId !== scopedPermit.prompt.id
  ) throw new Error("Exchange identity does not match the Question Permit.");
  const inputs = z.array(clarificationInputSchema).min(1).max(20).parse(productManagerInputs);
  const text = inputs.join("\n\n");
  if (text.length > 4_000) {
    throw new Error("The verbatim text fallback summary exceeds the editable summary limit.");
  }
  return {
    roadmapItemId: scopedPermit.roadmapItemId,
    text,
    uncertainties: [],
    provenance: "product_manager_text_only",
    identity: scopedIdentity,
  };
}
