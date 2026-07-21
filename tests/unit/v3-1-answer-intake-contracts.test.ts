import { describe, expect, it } from "vitest";

import {
  requiredAnswerAspectsCovered,
  validateAnswerIntakeAssessment,
} from "@/domain/answer-intake";
import { initialInterviewPrompt } from "@/domain/initial-state";
import { answerIntakeAssessmentSchema, interviewPromptSchema } from "@/domain/schemas";

const validAssessment = {
  summary: "Build a focused product interview that turns vague intent into a testable specification.",
  coverage: [
    { aspectId: "ASPECT-001", status: "covered" },
    { aspectId: "ASPECT-002", status: "covered" },
  ],
  uncertainties: [],
  clarificationQuestion: null,
  clarificationAspectIds: [],
} as const;

describe("V3.1 Answer Intake contracts", () => {
  it("requires unique Brain-authored aspects and one required aspect", () => {
    expect(interviewPromptSchema.parse(initialInterviewPrompt).answerAspects).toHaveLength(2);
    expect(interviewPromptSchema.safeParse({
      ...initialInterviewPrompt,
      answerAspects: initialInterviewPrompt.answerAspects.map((aspect) => ({ ...aspect, required: false })),
    }).success).toBe(false);
    expect(interviewPromptSchema.safeParse({
      ...initialInterviewPrompt,
      answerAspects: [initialInterviewPrompt.answerAspects[0], initialInterviewPrompt.answerAspects[0]],
    }).success).toBe(false);
  });

  it("accepts exact aspect coverage and detects required completion", () => {
    const result = validateAnswerIntakeAssessment(initialInterviewPrompt, validAssessment);
    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(requiredAnswerAspectsCovered(initialInterviewPrompt, result.assessment!)).toBe(true);
  });

  it("rejects missing, extra, duplicate, and covered clarification targets", () => {
    expect(validateAnswerIntakeAssessment(initialInterviewPrompt, {
      ...validAssessment,
      coverage: validAssessment.coverage.slice(0, 1),
    }).errors).toContain("ASPECT-002: missing coverage assessment");
    expect(validateAnswerIntakeAssessment(initialInterviewPrompt, {
      ...validAssessment,
      coverage: [...validAssessment.coverage, { aspectId: "ASPECT-999", status: "missing" }],
    }).errors).toContain("ASPECT-999: unknown coverage assessment");
    expect(answerIntakeAssessmentSchema.safeParse({
      ...validAssessment,
      clarificationQuestion: "What pain should it solve?",
      clarificationAspectIds: ["ASPECT-001"],
    }).success).toBe(false);
  });

  it("allows one clarification only for a missing or uncertain aspect", () => {
    const result = validateAnswerIntakeAssessment(initialInterviewPrompt, {
      ...validAssessment,
      coverage: [
        { aspectId: "ASPECT-001", status: "covered" },
        { aspectId: "ASPECT-002", status: "missing" },
      ],
      uncertainties: ["The current pain is not yet stated."],
      clarificationQuestion: "What current pain should this product solve?",
      clarificationAspectIds: ["ASPECT-002"],
    });
    expect(result.valid).toBe(true);
    expect(requiredAnswerAspectsCovered(initialInterviewPrompt, result.assessment!)).toBe(false);
  });
});
