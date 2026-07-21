import { answerIntakeAssessmentSchema } from "./schemas";
import type { AnswerIntakeAssessment, InterviewPrompt } from "./types";

export const MAX_ANSWER_INTAKE_CONTRIBUTIONS = 3;
export const MAX_ANSWER_CLARIFICATIONS = 2;

export interface AnswerIntakeValidationResult {
  valid: boolean;
  assessment: AnswerIntakeAssessment | null;
  errors: string[];
}

export function validateAnswerIntakeAssessment(
  prompt: InterviewPrompt,
  candidate: unknown,
): AnswerIntakeValidationResult {
  const parsed = answerIntakeAssessmentSchema.safeParse(candidate);
  if (!parsed.success) {
    return { valid: false, assessment: null, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const expectedIds = new Set(prompt.answerAspects.map((aspect) => aspect.id));
  const actualIds = new Set(parsed.data.coverage.map((coverage) => coverage.aspectId));
  const errors: string[] = [];
  for (const id of expectedIds) if (!actualIds.has(id)) errors.push(`${id}: missing coverage assessment`);
  for (const id of actualIds) if (!expectedIds.has(id)) errors.push(`${id}: unknown coverage assessment`);
  if (actualIds.size !== parsed.data.coverage.length) errors.push("Coverage aspect IDs must be unique");
  for (const id of parsed.data.clarificationAspectIds) {
    if (!expectedIds.has(id)) errors.push(`${id}: clarification targets an unknown Answer Aspect`);
  }

  return errors.length
    ? { valid: false, assessment: null, errors }
    : { valid: true, assessment: parsed.data, errors: [] };
}

export function requiredAnswerAspectsCovered(
  prompt: InterviewPrompt,
  assessment: AnswerIntakeAssessment,
): boolean {
  const coverage = new Map(assessment.coverage.map((item) => [item.aspectId, item.status] as const));
  return prompt.answerAspects
    .filter((aspect) => aspect.required)
    .every((aspect) => coverage.get(aspect.id) === "covered");
}
