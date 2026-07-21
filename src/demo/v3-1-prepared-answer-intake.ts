import { validateAnswerIntakeAssessment } from "@/domain/answer-intake";
import { answerDraftSchema, answerIntakeAssessmentSchema, interviewPromptSchema } from "@/domain/schemas";
import type { AnswerDraft, AnswerIntakeAssessment, InterviewPrompt } from "@/domain/types";
import { teamBillingPrompts } from "./team-billing-snapshots";

export const preparedAnswerIntakePrompt: InterviewPrompt = interviewPromptSchema.parse(teamBillingPrompts[0]);

export const preparedInitialAnswerAssessment: AnswerIntakeAssessment = answerIntakeAssessmentSchema.parse({
  summary: "Build team billing for the SaaS.",
  coverage: [
    { aspectId: "ASPECT-001", status: "covered" },
    { aspectId: "ASPECT-002", status: "missing" },
  ],
  uncertainties: ["The current pain has not been described yet."],
  clarificationQuestion: "What current billing pain should team billing solve for workspace owners?",
  clarificationAspectIds: ["ASPECT-002"],
});

export const preparedAnswerClarification = {
  question: preparedInitialAnswerAssessment.clarificationQuestion!,
  answer: "Workspace owners cannot centrally pay for active members today.",
} as const;

export const preparedFinalAnswerAssessment: AnswerIntakeAssessment = answerIntakeAssessmentSchema.parse({
  summary: "Build team billing for the SaaS so workspace owners can centrally pay for active members.",
  coverage: [
    { aspectId: "ASPECT-001", status: "covered" },
    { aspectId: "ASPECT-002", status: "covered" },
  ],
  uncertainties: [],
  clarificationQuestion: null,
  clarificationAspectIds: [],
});

export const preparedAnswerSummaryDraft: AnswerDraft = answerDraftSchema.parse({
  text: preparedFinalAnswerAssessment.summary,
  source: "communicator_summary",
  promptId: preparedAnswerIntakePrompt.id,
  transcriptionItemId: null,
  coverage: preparedFinalAnswerAssessment.coverage,
  uncertainties: preparedFinalAnswerAssessment.uncertainties,
});

export function validatePreparedAnswerIntakeFixtures(): { success: true; aspectCount: number; initialMissingCount: number; clarificationCount: 1 } {
  const initial = validateAnswerIntakeAssessment(preparedAnswerIntakePrompt, preparedInitialAnswerAssessment);
  const final = validateAnswerIntakeAssessment(preparedAnswerIntakePrompt, preparedFinalAnswerAssessment);
  if (!initial.valid || !final.valid) throw new Error([...initial.errors, ...final.errors].join("\n"));
  const initialMissingCount = preparedInitialAnswerAssessment.coverage.filter((item) => item.status === "missing").length;
  if (initialMissingCount !== 1 || !preparedInitialAnswerAssessment.clarificationQuestion) throw new Error("Prepared Answer Intake must contain exactly one missing aspect and one clarification");
  return { success: true, aspectCount: preparedAnswerIntakePrompt.answerAspects.length, initialMissingCount, clarificationCount: 1 };
}
