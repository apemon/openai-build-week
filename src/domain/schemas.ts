import { z } from "zod";

const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(4_000);
const isoDate = z.string().datetime({ offset: true });
const entityId = z.string().regex(/^[A-Z][A-Z0-9_-]{1,63}$/);

export const schemaVersionSchema = z.literal(1);
export const sessionModeSchema = z.enum(["live", "demo"]);
export const sessionPhaseSchema = z.enum([
  "start",
  "connecting",
  "presenting_prompt",
  "listening",
  "speech_detected",
  "transcribing",
  "reviewing_answer",
  "analyzing",
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
    .object({ answer: shortText, rationale: z.string().trim().min(1).max(2_000) })
    .nullable(),
  visualAid: visualAidSchema.nullable(),
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
});

export const conversationTurnSchema = z.object({
  id: entityId,
  promptId: entityId.nullable(),
  type: z.enum(["confirmed_answer", "deferred_prompt", "correction"]),
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
  operation: z.enum(["answer", "defer", "correct", "resume"]),
  turns: z.array(conversationTurnSchema).max(50),
  currentSpecification: specificationSchema,
  currentPrompt: interviewPromptSchema.nullable(),
});

export const brainModelOutputSchema = z.object({
  specification: specificationSchema,
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
  state: sessionStateSchema.extend({ answerDraft: z.null(), pendingRequest: z.null(), error: z.null() }),
});
