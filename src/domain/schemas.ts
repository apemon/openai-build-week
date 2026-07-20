import { z } from "zod";

const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(4_000);
const isoDate = z.string().datetime({ offset: true });
const entityId = z.string().regex(/^[A-Z][A-Z0-9_-]{1,63}$/);

export const schemaVersionSchema = z.literal(1);
export const sessionModeSchema = z.enum(["live", "demo"]);
export const sessionPhaseSchema = z.enum([
  "start",
  "preparing_context",
  "reviewing_context",
  "connecting",
  "presenting_prompt",
  "listening",
  "speech_detected",
  "transcribing",
  "reviewing_answer",
  "analyzing",
  "clarifying_lookahead",
  "reviewing_decision_summary",
  "queued_decision_summary",
  "final_review",
  "finalized",
  "recoverable_error",
]);
export const readinessStatusSchema = z.enum(["draft", "blocked", "ready_with_follow_ups", "ready"]);
export const itemStatusSchema = z.enum(["confirmed", "derived", "proposed", "unresolved"]);
export const itemKindSchema = z.enum([
  "problem",
  "user",
  "job",
  "functional_requirement",
  "non_functional_requirement",
  "assumption",
  "risk",
  "edge_case",
  "open_question",
  "blocker",
]);

export const visualNodeSchema = z.object({
  id: entityId,
  label: shortText,
  description: z.string().trim().max(500).nullable(),
});

export const visualEdgeSchema = z.object({
  id: entityId,
  from: entityId,
  to: entityId,
  label: z.string().trim().max(200).nullable(),
});

const visualAidBase = z.object({
  title: shortText,
  nodes: z.array(visualNodeSchema).max(8),
  edges: z.array(visualEdgeSchema).max(10),
  sourceItemIds: z.array(entityId).max(20),
});

export const visualAidSchema = z.discriminatedUnion("kind", [
  visualAidBase.extend({ kind: z.literal("role_map") }),
  visualAidBase.extend({ kind: z.literal("process_flow") }),
  visualAidBase.extend({ kind: z.literal("state_flow") }),
]);

export const specificationItemSchema = z.object({
  id: entityId,
  kind: itemKindSchema,
  statement: longText,
  status: itemStatusSchema,
  sourceTurnIds: z.array(entityId).max(30),
  rationale: z.string().trim().max(2_000),
  externalEvidenceIds: z.array(z.string().regex(/^EVID-[0-9]{3,}$/)).max(10).default([]),
});

export const acceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC-[0-9]{3,}$/),
  requirementIds: z.array(entityId).min(1).max(20),
  status: itemStatusSchema,
  sourceTurnIds: z.array(entityId).max(30),
  format: z.enum(["given_when_then", "measurable_assertion"]),
  given: z.string().trim().max(2_000).nullable(),
  when: z.string().trim().max(2_000).nullable(),
  then: z.string().trim().max(2_000).nullable(),
  assertion: z.string().trim().max(2_000).nullable(),
});

export const nextActionSchema = z.object({
  id: z.string().regex(/^NA-[0-9]{3,}$/),
  sourceItemIds: z.array(entityId).min(1).max(20),
  action: longText,
  intendedOutcome: longText,
  decisionOwnerRole: z.string().trim().max(200).nullable(),
  ownership: z.enum(["provisional", "confirmed", "owner_to_identify"]),
  status: z.enum(["open", "done"]),
});

export const readinessAssessmentSchema = z.object({
  status: readinessStatusSchema,
  evidence: z.array(shortText).max(20),
  blockerIds: z.array(entityId).max(30),
  openQuestionIds: z.array(entityId).max(30),
});

export const interviewPromptSchema = z.object({
  id: entityId,
  decisionKey: z.string().trim().min(1).max(200),
  detailedQuestion: longText,
  spokenQuestion: z.string().trim().min(1).max(600),
  whyItMatters: z.string().trim().min(1).max(2_000),
  confirmedContext: z.array(shortText).max(12),
  decisionImpact: z.array(shortText).max(12),
  recommendation: z
    .object({ answer: shortText, rationale: z.string().trim().min(1).max(2_000), externalEvidenceIds: z.array(z.string().regex(/^EVID-[0-9]{3,}$/)).max(10).default([]) })
    .nullable(),
  visualAid: visualAidSchema.nullable(),
});

export const contextSourceKindSchema = z.enum([
  "initial_prompt",
  "pasted_text",
  "uploaded_file",
  "prepared_sample",
]);

export const contextSourceMetadataSchema = z.object({
  id: entityId,
  kind: contextSourceKindSchema,
  filename: z.string().trim().min(1).max(255).nullable(),
  mimeType: z.string().trim().min(1).max(150).nullable(),
  sizeBytes: z.number().int().nonnegative().max(10_000_000).nullable(),
  characterCount: z.number().int().nonnegative().max(100_000),
  pageCount: z.number().int().positive().max(50).nullable(),
});

export const sourceReferenceSchema = z.object({
  sourceId: entityId,
  location: z.string().trim().min(1).max(500),
  page: z.number().int().positive().max(50).nullable(),
  heading: z.string().trim().min(1).max(500).nullable(),
  paragraph: z.number().int().positive().nullable(),
});

export const contextDigestStatementSchema = z.object({
  id: z.string().regex(/^CTX-[0-9]{3,}$/),
  statement: longText,
  sourceReferences: z.array(sourceReferenceSchema).min(1).max(10),
});

export const contextCoverageSchema = z.object({
  coveredLocations: z.array(shortText).max(100),
  omissions: z.array(shortText).max(50),
  warnings: z.array(shortText).max(50),
  requiresAcknowledgement: z.boolean(),
});

export const projectContextDigestSchema = z.object({
  id: entityId,
  initialPrompt: z.string().trim().min(1).max(4_000),
  statements: z.array(contextDigestStatementSchema).min(1).max(100),
  sources: z.array(contextSourceMetadataSchema).min(1).max(2),
  coverage: contextCoverageSchema,
  confirmedAt: isoDate.nullable(),
});

export const confirmedProjectContextDigestSchema = projectContextDigestSchema.extend({
  confirmedAt: isoDate,
});

export const extractedSourceExcerptSchema = z.object({
  id: entityId,
  sourceId: entityId,
  text: z.string().trim().min(1).max(10_000),
  reference: sourceReferenceSchema,
});

export const temporaryContextExtractionSchema = z
  .object({
    sourceId: entityId,
    excerpts: z.array(extractedSourceExcerptSchema).max(200),
    complete: z.boolean(),
    warnings: z.array(shortText).max(50),
  })
  .superRefine((value, context) => {
    const characters = value.excerpts.reduce((total, excerpt) => total + excerpt.text.length, 0);
    if (characters > 100_000) {
      context.addIssue({ code: "custom", message: "Extracted context exceeds 100,000 characters" });
    }
  });

export const contextPreparationSchema = z.object({
  requestId: entityId,
  status: z.enum(["extracting", "ready", "failed"]),
  draftDigest: projectContextDigestSchema.nullable(),
  temporaryExtraction: temporaryContextExtractionSchema.nullable(),
  warningAcknowledged: z.boolean(),
});

export const contextPreparationFieldsSchema = z.object({
  schemaVersion: schemaVersionSchema,
  sessionId: entityId,
  requestId: entityId,
  initialPrompt: z.string().trim().min(1).max(4_000),
  pastedContext: z.string().max(100_000),
});

export const contextPreparationResponseSchema = z.object({
  schemaVersion: schemaVersionSchema,
  requestId: entityId,
  digest: projectContextDigestSchema,
  temporaryExtraction: temporaryContextExtractionSchema.nullable(),
});

export const brainOperationSchema = z.enum([
  "initialize",
  "answer",
  "defer",
  "correct",
  "resume",
  "decision_summary",
  "decision_batch",
  "revalidate_restored",
]);

export const roadmapItemSchema = z.object({
  id: z.string().regex(/^ROADMAP-[0-9]{3,}$/),
  decisionKey: z.string().trim().min(1).max(200),
  topic: shortText,
  status: z.enum(["unresolved", "blocked", "resolved"]),
  priority: z.number().int().min(1).max(100),
  dependencyIds: z.array(z.string().regex(/^ROADMAP-[0-9]{3,}$/)).max(20),
  sourceItemIds: z.array(entityId).max(30),
  staleReason: z.string().trim().min(1).max(500).nullable(),
});

export const lookaheadApprovalSchema = z.object({
  roadmapItemId: z.string().regex(/^ROADMAP-[0-9]{3,}$/),
  prompt: interviewPromptSchema,
  approvedAtRevision: z.number().int().nonnegative(),
  dependencyVersion: entityId,
  independentOfOperation: brainOperationSchema,
});

export const questionRoadmapSchema = z.object({
  id: entityId,
  baseRevision: z.number().int().nonnegative(),
  dependencyVersion: entityId,
  items: z.array(roadmapItemSchema).max(100),
  currentDecisionItemId: z.string().regex(/^ROADMAP-[0-9]{3,}$/).nullable(),
  completedItemIds: z.array(z.string().regex(/^ROADMAP-[0-9]{3,}$/)).max(100),
  unresolvedDependencyIds: z.array(z.string().regex(/^ROADMAP-[0-9]{3,}$/)).max(100),
  lookaheadApproval: lookaheadApprovalSchema.nullable(),
});

export const clarificationTurnSchema = z.object({
  id: entityId,
  role: z.enum(["product_manager", "communicator"]),
  text: longText,
  createdAt: isoDate,
});

export const decisionSummarySchema = z.object({
  id: entityId,
  roadmapItemId: z.string().regex(/^ROADMAP-[0-9]{3,}$/),
  text: longText,
  uncertainties: z.array(shortText).max(20),
  status: z.enum(["draft", "confirmed_queued", "not_applied", "submitted"]),
  approvedAtRevision: z.number().int().nonnegative(),
  dependencyVersion: entityId,
  confirmedAt: isoDate.nullable(),
  staleReason: z.string().trim().min(1).max(500).nullable(),
});

export const activeLookaheadSchema = z.object({
  approval: lookaheadApprovalSchema,
  status: z.enum(["approved", "clarifying", "summary_draft", "queued", "not_applied"]),
  clarificationTurns: z.array(clarificationTurnSchema).max(20),
  decisionSummary: decisionSummarySchema.nullable(),
});

export const processingStageSchema = z.enum([
  "idle",
  "validating_confirmed_input",
  "reviewing_contradictions",
  "reviewing_dependencies",
  "revising_specification",
  "planning_next_question",
]);

export const externalEvidenceTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("specification_item"), itemId: entityId }),
  z.object({ kind: z.literal("prompt_recommendation"), promptId: entityId }),
]);

export const externalEvidenceSchema = z.object({
  id: z.string().regex(/^EVID-[0-9]{3,}$/),
  title: z.string().trim().min(1).max(300),
  url: z.string().url().max(2_048).refine((value) => value.startsWith("https://"), "External evidence URLs must use HTTPS"),
  retrievedAt: isoDate,
  informedTargets: z.array(externalEvidenceTargetSchema).min(1).max(20),
});

export const specificationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  problemStatement: z.array(specificationItemSchema).max(20),
  users: z.array(specificationItemSchema).max(30),
  jobsToBeDone: z.array(specificationItemSchema).max(30),
  functionalRequirements: z.array(specificationItemSchema).max(100),
  nonFunctionalRequirements: z.array(specificationItemSchema).max(60),
  assumptions: z.array(specificationItemSchema).max(60),
  risks: z.array(specificationItemSchema).max(60),
  edgeCases: z.array(specificationItemSchema).max(60),
  openQuestions: z.array(specificationItemSchema).max(60),
  blockers: z.array(specificationItemSchema).max(60),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).max(150),
  nextActions: z.array(nextActionSchema).max(60),
  readiness: readinessAssessmentSchema,
  externalEvidence: z.array(externalEvidenceSchema).max(20).default([]),
});

export const conversationTurnSchema = z.object({
  id: entityId,
  promptId: entityId.nullable(),
  type: z.enum(["confirmed_answer", "confirmed_decision_summary", "deferred_prompt", "correction"]),
  text: z.string().trim().min(1).max(4_000),
  createdAt: isoDate,
});

export const answerDraftSchema = z.object({
  text: z.string().max(4_000),
  source: z.enum(["typed", "transcription"]),
  promptId: entityId.nullable(),
  transcriptionItemId: z.string().trim().min(1).max(200).nullable(),
});

export const sessionProvenanceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("prepared_demo"), scenario: z.literal("team_billing"), validatedAt: isoDate }),
  z.object({
    source: z.literal("live_ai"),
    brainModel: z.string().trim().min(1).max(100),
    realtimeModel: z.string().trim().min(1).max(100).nullable(),
  }),
]);

export const recoverableErrorSchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
  returnPhase: sessionPhaseSchema,
});

export const pendingRequestSchema = z.object({
  requestId: entityId,
  baseRevision: z.number().int().nonnegative(),
  operation: brainOperationSchema,
  actionId: entityId,
});

export const sessionStateSchema = z.object({
  sessionId: entityId,
  mode: sessionModeSchema,
  phase: sessionPhaseSchema,
  startedAt: isoDate,
  expiresAt: isoDate,
  revision: z.number().int().nonnegative(),
  turns: z.array(conversationTurnSchema).max(50),
  specification: specificationSchema,
  currentPrompt: interviewPromptSchema.nullable(),
  contextPreparation: contextPreparationSchema.nullable(),
  confirmedContextDigest: confirmedProjectContextDigestSchema.nullable(),
  temporaryExtractionAvailable: z.boolean(),
  questionRoadmap: questionRoadmapSchema,
  activeLookahead: activeLookaheadSchema.nullable(),
  staleLookaheadReason: z.string().trim().min(1).max(500).nullable(),
  staleDecisionSummaries: z.array(decisionSummarySchema).max(20),
  processingStage: processingStageSchema,
  answerDraft: answerDraftSchema.nullable(),
  lastFinalizedRevision: z.number().int().nonnegative().nullable(),
  finalizedSpecification: specificationSchema.nullable(),
  provenance: sessionProvenanceSchema,
  pendingRequest: pendingRequestSchema.nullable(),
  error: recoverableErrorSchema.nullable(),
});

export const brainRequestSchema = z.object({
  schemaVersion: schemaVersionSchema,
  sessionId: entityId,
  mode: z.literal("live"),
  requestId: entityId,
  baseRevision: z.number().int().nonnegative(),
  operation: brainOperationSchema,
  turns: z.array(conversationTurnSchema).max(50),
  confirmedContextDigest: confirmedProjectContextDigestSchema,
  questionRoadmap: questionRoadmapSchema,
  relevantSourceExcerpts: z.array(extractedSourceExcerptSchema).max(20),
  currentSpecification: specificationSchema,
  currentPrompt: interviewPromptSchema.nullable(),
});

export const brainModelOutputSchema = z.object({
  specification: specificationSchema,
  questionRoadmap: questionRoadmapSchema.default({
    id: "ROADMAP-STATE",
    baseRevision: 0,
    dependencyVersion: "DEPENDENCY-0",
    items: [],
    currentDecisionItemId: null,
    completedItemIds: [],
    unresolvedDependencyIds: [],
    lookaheadApproval: null,
  }),
  nextPrompt: interviewPromptSchema.nullable(),
  changeSummary: z.array(shortText).max(20),
});

export const brainResponseSchema = z.object({
  schemaVersion: schemaVersionSchema,
  requestId: entityId,
  baseRevision: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  provenance: z.object({
    source: z.literal("live_ai"),
    agent: z.literal("brain"),
    requestedModel: z.string().trim().min(1).max(100),
    actualModel: z.string().trim().min(1).max(100),
    validatedAt: isoDate,
    repairAttempted: z.boolean(),
  }),
  output: brainModelOutputSchema,
});

export const realtimeSessionRequestSchema = z.object({
  schemaVersion: schemaVersionSchema,
  sessionId: entityId,
});

export const realtimeSessionResponseSchema = z.object({
  schemaVersion: schemaVersionSchema,
  clientSecret: z.string().min(1),
  expiresAt: isoDate,
  configuration: z.object({
    realtimeModel: z.string().trim().min(1).max(100),
    transcriptionModel: z.string().trim().min(1).max(100),
    voice: z.string().trim().min(1).max(100),
  }),
});

export const apiErrorCodeSchema = z.enum([
  "LIVE_DISABLED",
  "INVALID_REQUEST",
  "MODEL_TIMEOUT",
  "MODEL_REFUSAL",
  "INVALID_MODEL_OUTPUT",
  "REALTIME_UNAVAILABLE",
  "UNSUPPORTED_CONTEXT",
  "CONTEXT_OVER_LIMIT",
  "CONTEXT_EXTRACTION_FAILED",
  "INVALID_CONTEXT_OUTPUT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
    requestId: z.string().trim().min(1).max(100),
  }),
});

export const checkpointSchema = z.object({
  schemaVersion: schemaVersionSchema,
  savedAt: isoDate,
  state: sessionStateSchema.extend({
    answerDraft: z.null(),
    pendingRequest: z.null(),
    error: z.null(),
    contextPreparation: z.null(),
    temporaryExtractionAvailable: z.literal(false),
    activeLookahead: z.null(),
    staleLookaheadReason: z.null(),
    staleDecisionSummaries: z.tuple([]),
    processingStage: z.literal("idle"),
  }),
});
