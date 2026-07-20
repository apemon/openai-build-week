import { describe, expect, it, vi } from "vitest";
import { contextPreparationSchema, questionRoadmapSchema } from "@/domain/schemas";
import { preparedContextPreparation, preparedProjectContext, preparedSampleDocument } from "./v2-prepared-context";
import {
  PREPARED_STALE_REASON,
  preparedProcessingStages,
  preparedQuestionRoadmaps,
  preparedStaleDecisionSummary,
  runPreparedProgress,
} from "./v2-prepared-flow";

describe("V2 Prepared Demo fixtures", () => {
  it("keeps bundled context local, validated, and source-linked", () => {
    expect(contextPreparationSchema.parse(preparedContextPreparation).status).toBe("ready");
    expect(preparedSampleDocument.markdown).toContain("# Team billing project brief");
    expect(preparedProjectContext.sources.some((source) => source.kind === "prepared_sample")).toBe(true);
    expect(preparedProjectContext.statements.every((statement) => statement.sourceReferences.length > 0)).toBe(true);
  });

  it("has no more than one lookahead and deterministically quarantines the prepared summary", () => {
    preparedQuestionRoadmaps.forEach((roadmap) => questionRoadmapSchema.parse(roadmap));
    expect(preparedQuestionRoadmaps.filter((roadmap) => roadmap.lookaheadApproval !== null)).toHaveLength(1);
    expect(preparedStaleDecisionSummary.status).toBe("not_applied");
    expect(preparedStaleDecisionSummary.staleReason).toBe(PREPARED_STALE_REASON);
  });

  it("uses deterministic honest stages without a synthetic percentage", async () => {
    const onStage = vi.fn();
    const wait = vi.fn(async () => undefined);
    await runPreparedProgress(onStage, 180, wait);
    expect(onStage.mock.calls.map(([stage]) => stage)).toEqual(preparedProcessingStages);
    expect(wait).toHaveBeenCalledTimes(preparedProcessingStages.length);
  });
});
