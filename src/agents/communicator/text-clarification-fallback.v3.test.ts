import { describe, expect, it } from "vitest";

import { initialInterviewPrompt } from "@/domain/initial-state";
import type { ExchangeIdentity, QuestionPermit } from "@/domain/v3-schemas";

import { createV3TextFallbackDecisionSummary } from "./text-clarification-fallback";

const permit: QuestionPermit = {
  id: "PERMIT-001",
  windowId: "WINDOW-TEXT",
  roadmapItemId: "ROADMAP-001",
  prompt: {
    ...initialInterviewPrompt,
    id: "PROMPT-TEXT",
    recommendation: null,
  },
  ordinal: 1,
  approvedAtRevision: 1,
  dependencyVersion: "DEPENDENCY-1",
  independentOfOperation: "answer",
  invalidationItemIds: [],
  domainKeys: [],
};

const identity: ExchangeIdentity = {
  kind: "permitted",
  exchangeId: "EXCHANGE-TEXT",
  promptId: "PROMPT-TEXT",
  permitId: "PERMIT-001",
  cancelEpoch: 0,
};

describe("V3 text clarification fallback", () => {
  it("preserves verbatim PM wording and immutable exchange identity", () => {
    expect(createV3TextFallbackDecisionSummary(permit, identity, ["Owners.", "Billing admins too."]))
      .toEqual({
        roadmapItemId: "ROADMAP-001",
        text: "Owners.\n\nBilling admins too.",
        uncertainties: [],
        provenance: "product_manager_text_only",
        identity,
      });
  });

  it("rejects identity from another permit", () => {
    expect(() => createV3TextFallbackDecisionSummary(
      permit,
      { ...identity, permitId: "PERMIT-002" },
      ["Owners."],
    )).toThrow("does not match the Question Permit");
  });
});
