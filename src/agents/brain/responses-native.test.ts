import { describe, expect, it, vi } from "vitest";

import { runResponsesNativeBrain } from "./responses-native";
import { validV3BrainOutput, validV3BrainRequest } from "./v3-test-fixtures";

describe("responses_native experimental harness", () => {
  it("runs bounded analyst, critic, and synthesis passes with fixed privacy settings", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ status: "completed", output_parsed: {
        contradictions: [], dependencyFindings: [], missingDecisions: [], provenanceRisks: [],
      } })
      .mockResolvedValueOnce({ status: "completed", output_parsed: {
        corrections: [], authorityWarnings: [], permitCouplingRisks: [], acceptanceCriterionGaps: [],
      } })
      .mockResolvedValueOnce({
        status: "completed",
        model: "gpt-5.6-2026-07-01",
        output_parsed: validV3BrainOutput(),
      });
    const events: number[] = [];
    const response = await runResponsesNativeBrain(validV3BrainRequest(), {
      responses: { create, retrieve: vi.fn(), cancel: vi.fn() },
      onLifecycle: (event) => events.push(event.sequence),
    });
    expect(response.revision).toBe(1);
    expect(response.provenance).toMatchObject({
      source: "experimental_evaluation",
      harnessMode: "responses_native",
      publicSearchEnabled: false,
      localOnly: true,
    });
    expect(create).toHaveBeenCalledTimes(3);
    for (const [body] of create.mock.calls) {
      expect(body).toMatchObject({
        model: "gpt-5.6",
        reasoning: { effort: "medium" },
        background: true,
        store: false,
        text: { format: expect.objectContaining({ type: "json_schema" }) },
      });
    }
    expect(events).toEqual(events.map((_, index) => index));
  });
});
