import { z } from "zod";

import {
  brainRequestSchema,
  brainResponseSchema,
  clarificationTurnSchema,
  confirmedProjectContextDigestSchema,
  conversationTurnSchema,
  interviewPromptSchema,
  questionRoadmapSchema,
  sessionStateSchema,
  specificationItemSchema,
  specificationSchema,
} from "./schemas";

const entityId = z.string().regex(/^[A-Z][A-Z0-9_-]{1,63}$/);
const roadmapId = z.string().regex(/^ROADMAP-[0-9]{3,}$/);
const evidenceId = z.string().regex(/^EVID-[0-9]{3,}$/);
const isoDate = z.string().datetime({ offset: true });
const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(4_000);
const dependencyVersion = entityId;
const httpsUrl = z.string().trim().min(1).max(2_048)
  .regex(/^https:\/\/[^\s]+$/, "External evidence URLs must use HTTPS")
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "External evidence URLs must be valid HTTPS URLs");

export const v3BrainOperationSchema = z.enum([
  "initialize",
  "answer",
  "defer",
  "correct",
  "resume",
  "decision_summary",
  "decision_batch",
  "revalidate_restored",
]);

export const brainHarnessModeSchema = z.enum([
  "one_shot",
  "responses_native",
  "codex_ephemeral",
  "codex_sdk_persistent",
]);

export const codexThreadIdSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);

export const externalEvidenceTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("specification_item"), itemId: entityId }).strict(),
  z.object({ kind: z.literal("prompt_recommendation"), promptId: entityId }).strict(),
]);

export const externalEvidenceSchema = z
  .object({
    id: evidenceId,
    title: z.string().trim().min(1).max(300),
    url: httpsUrl,
    retrievedAt: isoDate,
    informedTargets: z.array(externalEvidenceTargetSchema).min(1).max(20),
  })
  .strict();

export const frozenExternalEvidenceSchema = z
  .object({
    id: evidenceId,
    title: z.string().trim().min(1).max(300),
    url: httpsUrl,
    retrievedAt: isoDate,
    factualAbstract: z.string().trim().min(1).max(2_000),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export const v3SpecificationItemSchema = specificationItemSchema.extend({
  externalEvidenceIds: z.array(evidenceId).max(10),
});

export const v3InterviewPromptSchema = interviewPromptSchema.extend({
  recommendation: z
    .object({
      answer: shortText,
      rationale: z.string().trim().min(1).max(2_000),
      externalEvidenceIds: z.array(evidenceId).max(10),
    })
    .nullable(),
});

export const v3SpecificationSchema = specificationSchema.extend({
  problemStatement: z.array(v3SpecificationItemSchema).max(20),
  users: z.array(v3SpecificationItemSchema).max(30),
  jobsToBeDone: z.array(v3SpecificationItemSchema).max(30),
  functionalRequirements: z.array(v3SpecificationItemSchema).max(100),
  nonFunctionalRequirements: z.array(v3SpecificationItemSchema).max(60),
  assumptions: z.array(v3SpecificationItemSchema).max(60),
  risks: z.array(v3SpecificationItemSchema).max(60),
  edgeCases: z.array(v3SpecificationItemSchema).max(60),
  openQuestions: z.array(v3SpecificationItemSchema).max(60),
  blockers: z.array(v3SpecificationItemSchema).max(60),
  externalEvidence: z.array(externalEvidenceSchema).max(20),
});

export const questionPermitSchema = z
  .object({
    id: z.string().regex(/^PERMIT-[0-9]{3,}$/),
    windowId: z.string().regex(/^WINDOW-[A-Z0-9_-]{1,56}$/),
    roadmapItemId: roadmapId,
    prompt: v3InterviewPromptSchema,
    ordinal: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    approvedAtRevision: z.number().int().nonnegative(),
    dependencyVersion,
    independentOfOperation: v3BrainOperationSchema,
    invalidationItemIds: z.array(roadmapId).max(20),
    domainKeys: z.array(z.string().trim().min(1).max(100)).max(10),
  })
  .strict();

export const interviewWindowSchema = z
  .object({
    id: z.string().regex(/^WINDOW-[A-Z0-9_-]{1,56}$/),
    approvedAtRevision: z.number().int().nonnegative(),
    dependencyVersion,
    independentOfOperation: v3BrainOperationSchema,
    applicationCap: z.union([z.literal(1), z.literal(3)]),
    permits: z.array(questionPermitSchema).max(3),
  })
  .strict()
  .superRefine((window, context) => {
    if (window.permits.length > window.applicationCap) {
      context.addIssue({ code: "custom", path: ["permits"], message: "Interview Window exceeds the application cap" });
    }
  });

export const permittedDeferralSchema = z
  .object({
    id: entityId,
    note: z.string().trim().max(4_000).nullable(),
  })
  .strict();

export const interviewJobStatusSchema = z.enum([
  "approved",
  "presenting",
  "clarifying",
  "summary_draft",
  "paused",
  "confirmed_queued",
  "revalidation_pending",
  "ready_to_apply",
  "applying",
  "apply_failed",
  "applied",
  "not_applied",
]);

export const notAppliedReasonSchema = z.enum([
  "dependency_invalidated",
  "batch_failed",
  "cancelled",
  "abandoned",
  "superseded",
]);

export const v3DecisionSummarySchema = z
  .object({
    id: entityId,
    roadmapItemId: roadmapId,
    text: longText,
    uncertainties: z.array(shortText).max(20),
  })
  .strict();

export const interviewJobSchema = z
  .object({
    id: z.string().regex(/^JOB-[A-Z0-9_-]{1,59}$/),
    exchangeId: z.string().regex(/^EXCHANGE-[A-Z0-9_-]{1,54}$/),
    permit: questionPermitSchema,
    status: interviewJobStatusSchema,
    clarificationTurns: z.array(clarificationTurnSchema).max(20),
    decisionSummary: v3DecisionSummarySchema.nullable(),
    deferral: permittedDeferralSchema.nullable(),
    confirmedAt: isoDate.nullable(),
    revalidatedAtRevision: z.number().int().nonnegative().nullable(),
    revalidatedDependencyVersion: dependencyVersion.nullable(),
    notAppliedReason: notAppliedReasonSchema.nullable(),
    notAppliedExplanation: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.decisionSummary && job.deferral) {
      context.addIssue({ code: "custom", message: "An Interview Job cannot contain both a Decision Summary and a deferral" });
    }
    if (job.status === "not_applied" && (!job.notAppliedReason || !job.notAppliedExplanation)) {
      context.addIssue({ code: "custom", message: "Not Applied work requires a reason and explanation" });
    }
    if (job.status !== "not_applied" && (job.notAppliedReason || job.notAppliedExplanation)) {
      context.addIssue({ code: "custom", message: "Only Not Applied work may carry a Not Applied reason" });
    }
  });

export const priorPermitDispositionSchema = z.discriminatedUnion("status", [
  z
    .object({
      priorWindowId: z.string().regex(/^WINDOW-[A-Z0-9_-]{1,56}$/),
      priorPermitId: z.string().regex(/^PERMIT-[0-9]{3,}$/),
      roadmapItemId: roadmapId,
      status: z.literal("reissued"),
      freshPermitId: z.string().regex(/^PERMIT-[0-9]{3,}$/),
      revalidatedAtRevision: z.number().int().nonnegative(),
      dependencyVersion,
    })
    .strict(),
  z
    .object({
      priorWindowId: z.string().regex(/^WINDOW-[A-Z0-9_-]{1,56}$/),
      priorPermitId: z.string().regex(/^PERMIT-[0-9]{3,}$/),
      roadmapItemId: roadmapId,
      status: z.literal("dependency_invalidated"),
      reason: z.string().trim().min(1).max(500),
      revalidatedAtRevision: z.number().int().nonnegative(),
      dependencyVersion,
    })
    .strict(),
]);

export const exchangeIdentitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("permitted"),
      exchangeId: z.string().regex(/^EXCHANGE-[A-Z0-9_-]{1,54}$/),
      promptId: entityId,
      permitId: z.string().regex(/^PERMIT-[0-9]{3,}$/),
      cancelEpoch: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("authoritative_or_app_prompt"),
      exchangeId: z.string().regex(/^EXCHANGE-[A-Z0-9_-]{1,54}$/),
      promptId: entityId,
      permitId: z.null(),
      cancelEpoch: z.number().int().nonnegative(),
    })
    .strict(),
]);

const decisionBatchEntryBase = z.object({
  jobId: z.string().regex(/^JOB-[A-Z0-9_-]{1,59}$/),
  exchangeId: z.string().regex(/^EXCHANGE-[A-Z0-9_-]{1,54}$/),
  permitId: z.string().regex(/^PERMIT-[0-9]{3,}$/),
  roadmapItemId: roadmapId,
  permitOrdinal: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  confirmedTurnId: entityId,
  confirmedAt: isoDate,
  revalidatedAtRevision: z.number().int().nonnegative(),
  revalidatedDependencyVersion: dependencyVersion,
});

export const decisionBatchEntrySchema = z.discriminatedUnion("kind", [
  decisionBatchEntryBase.extend({
    kind: z.literal("decision_summary"),
    text: longText,
    uncertainties: z.array(shortText).max(20),
  }).strict(),
  decisionBatchEntryBase.extend({
    kind: z.literal("deferred_prompt"),
    note: z.string().trim().max(4_000).nullable(),
  }).strict(),
]);

export const decisionBatchSchema = z
  .object({
    id: z.string().regex(/^BATCH-[A-Z0-9_-]{1,57}$/),
    actionId: entityId,
    baseRevision: z.number().int().nonnegative(),
    dependencyVersion,
    createdAt: isoDate,
    lockedAt: isoDate,
    entries: z.array(decisionBatchEntrySchema).min(1).max(3),
  })
  .strict();

export const restoredAsyncEntrySchema = z.discriminatedUnion("kind", [
  decisionBatchEntryBase.extend({
    kind: z.literal("decision_summary"),
    text: longText,
    uncertainties: z.array(shortText).max(20),
    windowId: z.string().regex(/^WINDOW-[A-Z0-9_-]{1,56}$/),
    approvalRevision: z.number().int().nonnegative(),
    approvalDependencyVersion: dependencyVersion,
  }).strict(),
  decisionBatchEntryBase.extend({
    kind: z.literal("deferred_prompt"),
    note: z.string().trim().max(4_000).nullable(),
    windowId: z.string().regex(/^WINDOW-[A-Z0-9_-]{1,56}$/),
    approvalRevision: z.number().int().nonnegative(),
    approvalDependencyVersion: dependencyVersion,
  }).strict(),
]);

export const adaptiveWindowStateSchema = z
  .object({
    eligibleOutcomes: z.array(z.enum(["applied", "dependency_invalidated"])).max(3),
    applicationCap: z.union([z.literal(1), z.literal(3)]),
    singletonRecoveryStreak: z.number().int().min(0).max(2),
  })
  .strict();

export const brainActivityStateSchema = z.enum([
  "working",
  "taking_longer",
  "connection_interrupted",
  "needs_attention",
  "timed_out",
  "revision_applied",
  "stopped",
]);

export const brainLifecycleKindSchema = z.enum([
  "request_accepted",
  "provider_queued",
  "provider_in_progress",
  "provider_attempt_terminal",
  "validating_output",
  "repair_started",
  "cancellation_requested",
]);

export const brainLifecycleEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: entityId,
    actionId: entityId,
    baseRevision: z.number().int().nonnegative(),
    cancelEpoch: z.number().int().nonnegative(),
    attempt: z.union([z.literal(1), z.literal(2)]),
    sequence: z.number().int().nonnegative(),
    observedAt: isoDate,
    kind: brainLifecycleKindSchema,
  })
  .strict();

export const v3BrainRequestSchema = brainRequestSchema
  .omit({ operation: true, currentSpecification: true, currentPrompt: true })
  .extend({
    operation: v3BrainOperationSchema,
    currentSpecification: v3SpecificationSchema,
    currentPrompt: v3InterviewPromptSchema.nullable(),
    actionId: entityId,
    cancelEpoch: z.number().int().nonnegative(),
    requestedApplicationCap: z.union([z.literal(1), z.literal(3)]),
    priorInterviewWindow: interviewWindowSchema.nullable(),
    restoredEntriesForRevalidation: z.array(restoredAsyncEntrySchema).max(3),
    decisionBatch: decisionBatchSchema.nullable(),
    externalEvidenceBundle: z.array(frozenExternalEvidenceSchema).max(20),
    codexThreadId: codexThreadIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.operation === "decision_batch") {
      if (!request.decisionBatch) context.addIssue({ code: "custom", path: ["decisionBatch"], message: "decision_batch requires one batch" });
      if (request.restoredEntriesForRevalidation.length > 0) context.addIssue({ code: "custom", path: ["restoredEntriesForRevalidation"], message: "decision_batch cannot revalidate restored entries" });
    } else if (request.operation === "revalidate_restored") {
      if (request.decisionBatch) context.addIssue({ code: "custom", path: ["decisionBatch"], message: "revalidate_restored cannot carry a batch" });
      if (request.restoredEntriesForRevalidation.length === 0) context.addIssue({ code: "custom", path: ["restoredEntriesForRevalidation"], message: "revalidate_restored requires one to three entries" });
    } else if (request.decisionBatch || request.restoredEntriesForRevalidation.length > 0) {
      context.addIssue({ code: "custom", message: "Only V3 batch operations may carry asynchronous entries" });
    }
  });

export const v3BrainModelOutputSchema = z
  .object({
    specification: v3SpecificationSchema,
    questionRoadmap: questionRoadmapSchema,
    nextPrompt: v3InterviewPromptSchema.nullable(),
    changeSummary: z.array(shortText).max(20),
    interviewWindow: interviewWindowSchema,
    priorPermitDispositions: z.array(priorPermitDispositionSchema).max(3),
  })
  .strict();

export const experimentalBrainProvenanceSchema = z.object({
  source: z.literal("experimental_evaluation"),
  agent: z.literal("brain"),
  harnessMode: brainHarnessModeSchema,
  publicSearchEnabled: z.boolean(),
  localOnly: z.literal(true),
  requestedModel: z.string().trim().min(1).max(100),
  actualModel: z.string().trim().min(1).max(100),
  validatedAt: isoDate,
  repairAttempted: z.boolean(),
}).strict();

export const v3BrainResponseSchema = brainResponseSchema
  .omit({ output: true, provenance: true })
  .extend({
    provenance: z.union([brainResponseSchema.shape.provenance, experimentalBrainProvenanceSchema]),
    output: v3BrainModelOutputSchema,
    codexThreadId: codexThreadIdSchema.nullable().optional(),
  })
  .strict();

export const brainStreamEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lifecycle"), event: brainLifecycleEventSchema }).strict(),
  z.object({ type: z.literal("result"), response: v3BrainResponseSchema }).strict(),
  z.object({
    type: z.literal("error"),
    error: z.object({
      error: z.object({
        code: z.enum([
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
        ]),
        message: z.string().trim().min(1).max(500),
        retryable: z.boolean(),
        requestId: z.string().trim().min(1).max(100),
      }).strict(),
    }).strict(),
  }).strict(),
]);

export const v3SessionStateSchema = sessionStateSchema.extend({
  interviewWindow: interviewWindowSchema.nullable(),
  interviewJobs: z.array(interviewJobSchema).max(20),
  activeInterviewJobId: z.string().regex(/^JOB-[A-Z0-9_-]{1,59}$/).nullable(),
  adaptiveWindow: adaptiveWindowStateSchema,
  lockedDecisionBatch: decisionBatchSchema.nullable(),
  restoredEntries: z.array(restoredAsyncEntrySchema).max(3),
  cancelEpoch: z.number().int().nonnegative(),
  brainActivity: z
    .object({
      state: brainActivityStateSchema,
      actionId: entityId.nullable(),
      acceptedAt: isoDate.nullable(),
      lastLifecycleAt: isoDate.nullable(),
      lastSequence: z.number().int().nonnegative().nullable(),
    })
    .strict(),
});

export const v3CheckpointSchema = z
  .object({
    schemaVersion: z.literal(3),
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
    confirmedQueuedEntries: z.array(restoredAsyncEntrySchema).max(3),
    adaptiveWindow: adaptiveWindowStateSchema,
    codexThreadId: codexThreadIdSchema.nullable().optional(),
  })
  .strict();

export type V3Specification = z.infer<typeof v3SpecificationSchema>;
export type V3InterviewPrompt = z.infer<typeof v3InterviewPromptSchema>;
export type ExternalEvidence = z.infer<typeof externalEvidenceSchema>;
export type FrozenExternalEvidence = z.infer<typeof frozenExternalEvidenceSchema>;
export type InterviewWindow = z.infer<typeof interviewWindowSchema>;
export type QuestionPermit = z.infer<typeof questionPermitSchema>;
export type InterviewJob = z.infer<typeof interviewJobSchema>;
export type InterviewJobStatus = z.infer<typeof interviewJobStatusSchema>;
export type NotAppliedReason = z.infer<typeof notAppliedReasonSchema>;
export type PriorPermitDisposition = z.infer<typeof priorPermitDispositionSchema>;
export type ExchangeIdentity = z.infer<typeof exchangeIdentitySchema>;
export type DecisionBatch = z.infer<typeof decisionBatchSchema>;
export type DecisionBatchEntry = z.infer<typeof decisionBatchEntrySchema>;
export type RestoredAsyncEntry = z.infer<typeof restoredAsyncEntrySchema>;
export type AdaptiveWindowState = z.infer<typeof adaptiveWindowStateSchema>;
export type BrainActivityState = z.infer<typeof brainActivityStateSchema>;
export type BrainLifecycleEvent = z.infer<typeof brainLifecycleEventSchema>;
export type BrainStreamEnvelope = z.infer<typeof brainStreamEnvelopeSchema>;
export type V3BrainOperation = z.infer<typeof v3BrainOperationSchema>;
export type V3BrainRequest = z.infer<typeof v3BrainRequestSchema>;
export type V3BrainModelOutput = z.infer<typeof v3BrainModelOutputSchema>;
export type V3BrainResponse = z.infer<typeof v3BrainResponseSchema>;
export type V3SessionState = z.infer<typeof v3SessionStateSchema>;
export type V3Checkpoint = z.infer<typeof v3CheckpointSchema>;
export type BrainHarnessMode = z.infer<typeof brainHarnessModeSchema>;
export type ConfirmedContextForV3 = z.infer<typeof confirmedProjectContextDigestSchema>;
export type DurableTurnForV3 = z.infer<typeof conversationTurnSchema>;
