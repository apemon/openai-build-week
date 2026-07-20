import { describe, expect, it } from "vitest";

import { v3BrainRequestSchema } from "@/domain/v3-schemas";

import { validV3BrainOutput, validV3BrainRequest } from "./v3-test-fixtures";
import { validateV3BrainOutput, validateV3BrainRequest } from "./v3-semantic-validator";

describe("V3 Brain semantic validation", () => {
  it("accepts a complete V3 snapshot", () => {
    expect(validateV3BrainRequest(validV3BrainRequest())).toEqual({ valid: true, errors: [] });
    expect(validateV3BrainOutput(validV3BrainRequest(), validV3BrainOutput())).toEqual({ valid: true, errors: [] });
  });

  it("enforces operation-conditional request fields", () => {
    const request = validV3BrainRequest();
    expect(v3BrainRequestSchema.safeParse({
      ...request,
      operation: "decision_batch",
      decisionBatch: null,
    }).success).toBe(false);
    expect(v3BrainRequestSchema.safeParse({
      ...request,
      operation: "revalidate_restored",
      restoredEntriesForRevalidation: [],
    }).success).toBe(false);
  });

  it("requires exact prior-permit disposition membership", () => {
    const request = validV3BrainRequest();
    const output = validV3BrainOutput();
    const permit = {
      id: "PERMIT-001",
      windowId: "WINDOW-PRIOR",
      roadmapItemId: "ROADMAP-001",
      prompt: output.nextPrompt!,
      ordinal: 1 as const,
      approvedAtRevision: 0,
      dependencyVersion: "DEPENDENCY-0",
      independentOfOperation: "answer" as const,
      invalidationItemIds: [],
      domainKeys: ["billing"],
    };
    const withPrior = v3BrainRequestSchema.parse({
      ...request,
      priorInterviewWindow: {
        id: "WINDOW-PRIOR",
        approvedAtRevision: 0,
        dependencyVersion: "DEPENDENCY-0",
        independentOfOperation: "answer",
        applicationCap: 3,
        permits: [permit],
      },
    });
    const validation = validateV3BrainOutput(withPrior, output);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("PERMIT-001: missing prior permit disposition");
  });

  it("validates exact Decision Batch membership against the supplied permits", () => {
    const request = validV3BrainRequest();
    const prompt = validV3BrainOutput().nextPrompt!;
    const permit = {
      id: "PERMIT-001",
      windowId: "WINDOW-PRIOR",
      roadmapItemId: "ROADMAP-001",
      prompt,
      ordinal: 1 as const,
      approvedAtRevision: 0,
      dependencyVersion: "DEPENDENCY-0",
      independentOfOperation: "decision_batch" as const,
      invalidationItemIds: [],
      domainKeys: ["billing"],
    };
    const batchRequest = v3BrainRequestSchema.parse({
      ...request,
      operation: "decision_batch",
      currentPrompt: prompt,
      questionRoadmap: {
        ...request.questionRoadmap,
        items: [{
          id: "ROADMAP-001",
          decisionKey: prompt.decisionKey,
          topic: "Billing roles",
          status: "unresolved",
          priority: 1,
          dependencyIds: [],
          sourceItemIds: [],
          staleReason: null,
        }],
        currentDecisionItemId: "ROADMAP-001",
      },
      priorInterviewWindow: {
        id: "WINDOW-PRIOR",
        approvedAtRevision: 0,
        dependencyVersion: "DEPENDENCY-0",
        independentOfOperation: "decision_batch",
        applicationCap: 3,
        permits: [permit],
      },
      decisionBatch: {
        id: "BATCH-001",
        actionId: request.actionId,
        baseRevision: 0,
        dependencyVersion: "DEPENDENCY-0",
        createdAt: "2026-07-21T00:00:01.000Z",
        lockedAt: "2026-07-21T00:00:02.000Z",
        entries: [{
          kind: "decision_summary",
          jobId: "JOB-001",
          exchangeId: "EXCHANGE-001",
          permitId: "PERMIT-001",
          roadmapItemId: "ROADMAP-001",
          permitOrdinal: 1,
          confirmedTurnId: "TURN-BATCH-001",
          text: "Owners and Billing Admins manage billing.",
          uncertainties: [],
          confirmedAt: "2026-07-21T00:00:01.000Z",
          revalidatedAtRevision: 0,
          revalidatedDependencyVersion: "DEPENDENCY-0",
        }],
      },
    });
    expect(validateV3BrainRequest(batchRequest)).toEqual({ valid: true, errors: [] });
    const mismatched = structuredClone(batchRequest);
    mismatched.decisionBatch!.entries[0].permitOrdinal = 2;
    const validation = validateV3BrainRequest(mismatched);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes("does not exactly match its Question Permit"))).toBe(true);
  });

  it("rejects unknown External Evidence references atomically", () => {
    const output = structuredClone(validV3BrainOutput());
    output.specification.problemStatement[0].externalEvidenceIds = ["EVID-999"];
    const validation = validateV3BrainOutput(validV3BrainRequest(), output);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes("unknown External Evidence EVID-999"))).toBe(true);
  });
});
