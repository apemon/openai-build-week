import type { z } from "zod";
import type {
  acceptanceCriterionSchema,
  answerDraftSchema,
  apiErrorSchema,
  brainModelOutputSchema,
  brainRequestSchema,
  brainResponseSchema,
  checkpointSchema,
  conversationTurnSchema,
  interviewPromptSchema,
  itemKindSchema,
  itemStatusSchema,
  nextActionSchema,
  readinessAssessmentSchema,
  readinessStatusSchema,
  realtimeSessionRequestSchema,
  realtimeSessionResponseSchema,
  recoverableErrorSchema,
  sessionModeSchema,
  sessionPhaseSchema,
  sessionProvenanceSchema,
  sessionStateSchema,
  specificationItemSchema,
  specificationSchema,
  visualAidSchema,
} from "./schemas";

export type SessionMode = z.infer<typeof sessionModeSchema>;
export type SessionPhase = z.infer<typeof sessionPhaseSchema>;
export type ReadinessStatus = z.infer<typeof readinessStatusSchema>;
export type ItemStatus = z.infer<typeof itemStatusSchema>;
export type ItemKind = z.infer<typeof itemKindSchema>;
export type VisualAid = z.infer<typeof visualAidSchema>;
export type SpecificationItem = z.infer<typeof specificationItemSchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type NextAction = z.infer<typeof nextActionSchema>;
export type ReadinessAssessment = z.infer<typeof readinessAssessmentSchema>;
export type InterviewPrompt = z.infer<typeof interviewPromptSchema>;
export type Specification = z.infer<typeof specificationSchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export type AnswerDraft = z.infer<typeof answerDraftSchema>;
export type SessionProvenance = z.infer<typeof sessionProvenanceSchema>;
export type RecoverableError = z.infer<typeof recoverableErrorSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
export type BrainRequest = z.infer<typeof brainRequestSchema>;
export type BrainModelOutput = z.infer<typeof brainModelOutputSchema>;
export type BrainResponse = z.infer<typeof brainResponseSchema>;
export type RealtimeSessionRequest = z.infer<typeof realtimeSessionRequestSchema>;
export type RealtimeSessionResponse = z.infer<typeof realtimeSessionResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type SessionCheckpoint = z.infer<typeof checkpointSchema>;
