import { describe, expect, it } from "vitest";

import { v3BrainModelOutputSchema, v3BrainRequestSchema } from "@/domain/v3-schemas";

import { validV3BrainOutput, validV3BrainRequest } from "./v3-test-fixtures";
import { validateV3BrainOutput, validateV3BrainRequest } from "./v3-semantic-validator";

function validOutputWithPermit() {
  const output = structuredClone(validV3BrainOutput());
  output.questionRoadmap.items.push({
    id: "ROADMAP-002",
    decisionKey: "billing_approval",
    topic: "Billing approval",
    status: "unresolved",
    priority: 2,
    dependencyIds: [],
    sourceItemIds: ["PROB-001"],
    staleReason: null,
  });
  output.interviewWindow.permits.push({
    id: "PERMIT-001",
    windowId: output.interviewWindow.id,
    roadmapItemId: "ROADMAP-002",
    prompt: {
      id: "PROMPT-002",
      decisionKey: "billing_approval",
      detailedQuestion: "Which roles must approve team billing changes?",
      spokenQuestion: "Which roles approve billing changes?",
      whyItMatters: "Approval roles define control over billing changes.",
      confirmedContext: ["team billing"],
      decisionImpact: ["Defines approval responsibility for billing changes."],
      answerAspects: [{
        id: "ASPECT-201",
        label: "Approver roles",
        description: "The roles that approve team billing changes.",
        required: true,
      }],
      recommendation: null,
      visualAid: null,
    },
    ordinal: 1,
    approvedAtRevision: 1,
    dependencyVersion: "DEPENDENCY-1",
    independentOfOperation: "answer",
    invalidationItemIds: [],
    domainKeys: ["billing", "approval"],
  });
  return output;
}

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

  it("gives content-free RegExp and prefix guidance for category-mismatched item IDs", () => {
    const output = structuredClone(validV3BrainOutput());
    output.specification.problemStatement[0].id = "FR-999";
    const validation = validateV3BrainOutput(validV3BrainRequest(), output);

    expect(validation.errors).toContain(
      "problemStatement item ID must match /^PROB-[0-9]{3,}$/ (required prefix PROB-) for category problem",
    );
    expect(validation.errors.some((error) => error.startsWith("FR-999: ID"))).toBe(false);
  });

  it.each([
    {
      name: "missing",
      mutate: (output: ReturnType<typeof validV3BrainOutput>) => { output.nextPrompt!.answerAspects = []; },
      expected: "must contain one to five",
    },
    {
      name: "duplicate",
      mutate: (output: ReturnType<typeof validV3BrainOutput>) => {
        output.nextPrompt!.answerAspects = [
          output.nextPrompt!.answerAspects[0],
          output.nextPrompt!.answerAspects[0],
        ];
      },
      expected: "duplicate Answer Aspect ID",
    },
    {
      name: "excessive",
      mutate: (output: ReturnType<typeof validV3BrainOutput>) => {
        output.nextPrompt!.answerAspects = Array.from({ length: 6 }, (_, index) => ({
          id: `ASPECT-${String(index + 301).padStart(3, "0")}`,
          label: `Billing role ${index + 1}`,
          description: `Billing role ${index + 1} permissions.`,
          required: index === 0,
        }));
      },
      expected: "must contain one to five",
    },
    {
      name: "no-required",
      mutate: (output: ReturnType<typeof validV3BrainOutput>) => {
        output.nextPrompt!.answerAspects = output.nextPrompt!.answerAspects.map((aspect) => ({
          ...aspect,
          required: false,
        }));
      },
      expected: "requires at least one required aspect",
    },
  ])("rejects $name nextPrompt Answer Aspects in schema and semantic validation", ({ mutate, expected }) => {
    const output = structuredClone(validV3BrainOutput());
    mutate(output);

    expect(v3BrainModelOutputSchema.safeParse(output).success).toBe(false);
    const semantic = validateV3BrainOutput(validV3BrainRequest(), output);
    expect(semantic.valid).toBe(false);
    expect(semantic.errors.some((error) => error.includes(expected))).toBe(true);
  });

  it("rejects duplicate aspect meaning even when IDs are unique", () => {
    const output = structuredClone(validV3BrainOutput());
    output.nextPrompt!.answerAspects = [
      output.nextPrompt!.answerAspects[0],
      { ...output.nextPrompt!.answerAspects[0], id: "ASPECT-999" },
    ];

    expect(v3BrainModelOutputSchema.safeParse(output).success).toBe(true);
    const validation = validateV3BrainOutput(validV3BrainRequest(), output);
    expect(validation.errors.some((error) => error.includes("unique, non-overlapping meanings"))).toBe(true);
  });

  it("rejects a nextPrompt aspect invented outside its current decision", () => {
    const output = structuredClone(validV3BrainOutput());
    output.nextPrompt!.answerAspects = [{
      id: "ASPECT-999",
      label: "Analytics retention",
      description: "The duration for storing analytics logs.",
      required: true,
    }];

    expect(v3BrainModelOutputSchema.safeParse(output).success).toBe(true);
    const validation = validateV3BrainOutput(validV3BrainRequest(), output);
    expect(validation.errors).toContain("nextPrompt.answerAspects[0] is outside the current decision scope");
  });

  it("validates Answer Aspects independently for every Question Permit prompt", () => {
    const valid = validOutputWithPermit();
    expect(validateV3BrainOutput(validV3BrainRequest(), valid)).toEqual({ valid: true, errors: [] });

    valid.interviewWindow.permits[0].prompt.answerAspects = [];
    const missing = validateV3BrainOutput(validV3BrainRequest(), valid);
    expect(missing.errors.some((error) =>
      error.includes("interviewWindow.permits[0].prompt.answerAspects must contain one to five"))).toBe(true);

    const outside = validOutputWithPermit();
    outside.interviewWindow.permits[0].prompt.answerAspects = [{
      id: "ASPECT-999",
      label: "Analytics retention",
      description: "The duration for storing analytics logs.",
      required: true,
    }];
    const scoped = validateV3BrainOutput(validV3BrainRequest(), outside);
    expect(scoped.errors).toContain(
      "interviewWindow.permits[0].prompt.answerAspects[0] is outside the current decision scope",
    );

    const reused = validOutputWithPermit();
    reused.interviewWindow.permits[0].prompt.answerAspects[0].id = "ASPECT-101";
    const ownership = validateV3BrainOutput(validV3BrainRequest(), reused);
    expect(ownership.errors).toContain(
      "ASPECT-101: Answer Aspect ID cannot be reused across prompt decisions",
    );
  });
});
