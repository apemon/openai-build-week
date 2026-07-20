import type { z } from "zod";
import type {
  acceptanceCriterionSchema,
  activeLookaheadSchema,
  answerDraftSchema,
  apiErrorSchema,
  brainModelOutputSchema,
  brainOperationSchema,
  brainRequestSchema,
  brainResponseSchema,
  checkpointSchema,
  clarificationTurnSchema,
  confirmedProjectContextDigestSchema,
  contextDigestStatementSchema,
  contextPreparationSchema,
  contextPreparationFieldsSchema,
  contextPreparationResponseSchema,
  contextSourceMetadataSchema,
  conversationTurnSchema,
  decisionSummarySchema,
  extractedSourceExcerptSchema,
  interviewPromptSchema,
  itemKindSchema,
  itemStatusSchema,
  lookaheadApprovalSchema,
  nextActionSchema,
  processingStageSchema,
  projectContextDigestSchema,
  questionRoadmapSchema,
  readinessAssessmentSchema,
  readinessStatusSchema,
  roadmapItemSchema,
  realtimeSessionRequestSchema,
  realtimeSessionResponseSchema,
  recoverableErrorSchema,
  sessionModeSchema,
  sessionPhaseSchema,
  sessionProvenanceSchema,
  sessionStateSchema,
  sourceReferenceSchema,
  specificationItemSchema,
  specificationSchema,
  temporaryContextExtractionSchema,
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
export type ContextSourceMetadata = z.infer<typeof contextSourceMetadataSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type ContextDigestStatement = z.infer<typeof contextDigestStatementSchema>;
export type ProjectContextDigest = z.infer<typeof projectContextDigestSchema>;
export type ConfirmedProjectContextDigest = z.infer<typeof confirmedProjectContextDigestSchema>;
export type ExtractedSourceExcerpt = z.infer<typeof extractedSourceExcerptSchema>;
export type TemporaryContextExtraction = z.infer<typeof temporaryContextExtractionSchema>;
export type ContextPreparation = z.infer<typeof contextPreparationSchema>;
export type ContextPreparationFields = z.infer<typeof contextPreparationFieldsSchema>;
export type ContextPreparationResponse = z.infer<typeof contextPreparationResponseSchema>;
export type BrainOperation = z.infer<typeof brainOperationSchema>;
export type RoadmapItem = z.infer<typeof roadmapItemSchema>;
export type LookaheadApproval = z.infer<typeof lookaheadApprovalSchema>;
export type QuestionRoadmap = z.infer<typeof questionRoadmapSchema>;
export type ClarificationTurn = z.infer<typeof clarificationTurnSchema>;
export type DecisionSummary = z.infer<typeof decisionSummarySchema>;
export type ActiveLookahead = z.infer<typeof activeLookaheadSchema>;
export type ProcessingStage = z.infer<typeof processingStageSchema>;
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
