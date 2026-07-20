import { describe, expect, it } from "vitest";

import { validateV3BrainRequest } from "../v3-semantic-validator";
import { buildCodexEvaluationResponse, CodexEphemeralBrainHarness } from "./codex-ephemeral";
import { buildEvaluationRequest, syntheticEvaluationSessions } from "./dataset";
import { evaluatePromotionGate, nearestRankP95, type CandidateGateMetrics } from "./gates";
import { scoreTechnicalOutput } from "./technical-scorer";
import { validV3BrainOutput, validV3BrainRequest } from "../v3-test-fixtures";
import { labelExperimentalEvaluationResponse } from "./runner";

function metrics(candidate: CandidateGateMetrics["candidate"]): CandidateGateMetrics {
  return {
    candidate,
    totalSessions: 24,
    questionWins: candidate === "one_shot" ? 0 : 15,
    questionNonTies: 20,
    specificationWins: candidate === "one_shot" ? 0 : 15,
    specificationNonTies: 20,
    firstPassValidityRate: 0.9,
    dependencyAccuracy: candidate === "one_shot" ? 0.8 : 0.86,
    acceptanceCriterionScore: candidate === "one_shot" ? 3.5 : 3.8,
    authorityViolationCount: 0,
    privacyViolationCount: 0,
    securityViolationCount: 0,
    provenanceViolationCount: 0,
    inventedDecisionCount: 0,
    p95LatencyMs: candidate === "one_shot" ? 1_000 : 1_900,
    cancellationVerified: true,
    lateOutputRejectionVerified: true,
    retentionVerified: true,
    sandboxVerified: true,
    packagingVerified: true,
    targetHostVerified: true,
    eligibleThreePermitJobs: 12,
    dependencyInvalidatedThreePermitJobs: 3,
  };
}

describe("frozen Brain evaluation", () => {
  it("contains at least 24 validated synthetic, category-diverse sessions", () => {
    expect(syntheticEvaluationSessions).toHaveLength(24);
    expect(new Set(syntheticEvaluationSessions.map((session) => session.category)).size).toBeGreaterThanOrEqual(10);
    for (const session of syntheticEvaluationSessions) {
      expect(validateV3BrainRequest(buildEvaluationRequest(session)).valid).toBe(true);
    }
  });

  it("computes the frozen promotion and three-permit gates", () => {
    expect(evaluatePromotionGate(metrics("responses_native"), metrics("one_shot"))).toEqual({
      promoted: true,
      disqualified: false,
      reasons: [],
    });
    const unsafe = metrics("codex_ephemeral");
    unsafe.inventedDecisionCount = 1;
    expect(evaluatePromotionGate(unsafe, metrics("one_shot"))).toMatchObject({ promoted: false, disqualified: true });
    expect(nearestRankP95([1, 2, 3, 4, 5])).toBe(5);
  });

  it("keeps Codex public search disabled when query/source caps cannot be enforced", async () => {
    const harness = new CodexEphemeralBrainHarness({
      apiKey: "not-used-because-search-is-rejected",
      publicSearchEnabled: true,
      searchProcessingAcknowledged: true,
    });
    const iterate = harness.run(buildEvaluationRequest(syntheticEvaluationSessions[0]), new AbortController().signal);
    await expect(iterate[Symbol.asyncIterator]().next()).rejects.toThrow(/cannot be enforced/);
  });

  it("scores malformed candidate output as a deterministic technical failure", () => {
    expect(scoreTechnicalOutput(syntheticEvaluationSessions[0], { invalid: true })).toMatchObject({
      schemaValid: false,
      semanticValid: false,
      firstPassValid: false,
      evidenceAuthoritySafe: false,
    });
  });

  it("labels Codex output as local experimental evaluation, never ordinary Live", () => {
    const response = buildCodexEvaluationResponse(
      validV3BrainRequest(),
      validV3BrainOutput(),
      "codex_ephemeral",
      "2026-07-21T00:00:00.000Z",
    );
    expect(response.provenance).toEqual(expect.objectContaining({
      source: "experimental_evaluation",
      harnessMode: "codex_ephemeral",
      publicSearchEnabled: false,
      localOnly: true,
    }));
  });

  it("labels the one_shot baseline as experimental inside frozen evaluation artifacts", () => {
    const request = validV3BrainRequest();
    const response = labelExperimentalEvaluationResponse({
      schemaVersion: 1,
      requestId: request.requestId,
      baseRevision: request.baseRevision,
      revision: 1,
      provenance: {
        source: "live_ai",
        agent: "brain",
        requestedModel: "gpt-5.6",
        actualModel: "gpt-5.6",
        validatedAt: "2026-07-21T00:00:00.000Z",
        repairAttempted: false,
      },
      output: validV3BrainOutput(),
    }, "one_shot");
    expect(response.provenance).toMatchObject({
      source: "experimental_evaluation",
      harnessMode: "one_shot",
      localOnly: true,
    });
  });
});
