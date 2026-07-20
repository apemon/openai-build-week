import { questionRoadmapSchema } from "@/domain/schemas";
import {
  brainLifecycleEventSchema,
  decisionBatchSchema,
  interviewJobSchema,
  interviewWindowSchema,
  v3InterviewPromptSchema,
  type BrainLifecycleEvent,
  type DecisionBatch,
  type InterviewJob,
  type InterviewWindow,
  type V3Specification,
} from "@/domain/v3-schemas";
import { migrateSpecificationToV3, validateInterviewWindow } from "@/domain/v3-invariants";
import { specificationToMarkdown } from "@/export/to-markdown";
import { teamBillingPrompts, teamBillingSnapshots } from "./team-billing-snapshots";
import { preparedQuestionRoadmaps } from "./v2-prepared-flow";

export const PREPARED_V3_ACTION_STARTED_AT = "2026-07-21T00:00:00.000Z";

function at(elapsedMs: number): string {
  return new Date(Date.parse(PREPARED_V3_ACTION_STARTED_AT) + elapsedMs).toISOString();
}

const preparedRoadmap = questionRoadmapSchema.parse({
  ...preparedQuestionRoadmaps[1],
  dependencyVersion: "DEPENDENCY-PREPARED-V3-1",
  lookaheadApproval: null,
});

const billingBasisPrompt = v3InterviewPromptSchema.parse(teamBillingPrompts[2]);
const seatChangesPrompt = v3InterviewPromptSchema.parse(teamBillingPrompts[3]);

export const preparedV3InterviewWindow: InterviewWindow = interviewWindowSchema.parse({
  id: "WINDOW-PREPARED-V3-1",
  approvedAtRevision: 1,
  dependencyVersion: "DEPENDENCY-PREPARED-V3-1",
  independentOfOperation: "answer",
  applicationCap: 3,
  permits: [
    {
      id: "PERMIT-101",
      windowId: "WINDOW-PREPARED-V3-1",
      roadmapItemId: "ROADMAP-003",
      prompt: billingBasisPrompt,
      ordinal: 1,
      approvedAtRevision: 1,
      dependencyVersion: "DEPENDENCY-PREPARED-V3-1",
      independentOfOperation: "answer",
      invalidationItemIds: ["ROADMAP-005"],
      domainKeys: ["billing_basis"],
    },
    {
      id: "PERMIT-102",
      windowId: "WINDOW-PREPARED-V3-1",
      roadmapItemId: "ROADMAP-004",
      prompt: seatChangesPrompt,
      ordinal: 2,
      approvedAtRevision: 1,
      dependencyVersion: "DEPENDENCY-PREPARED-V3-1",
      independentOfOperation: "answer",
      invalidationItemIds: ["ROADMAP-005"],
      domainKeys: ["seat_lifecycle"],
    },
  ],
});

const firstSummary = {
  id: "SUMMARY-PREPARED-V3-BILLING",
  roadmapItemId: "ROADMAP-003",
  text: "Charge monthly in USD per active seat. Owners and Billing Admins count; suspended people and unaccepted invitations do not count.",
  uncertainties: ["Proration remains outside this decision."],
};

const secondSummary = {
  id: "SUMMARY-PREPARED-V3-SEATS",
  roadmapItemId: "ROADMAP-004",
  text: "Accepted invitations add a prorated seat immediately. Removal revokes access immediately and reduces billing at renewal without a refund.",
  uncertainties: [],
};

function preparedJob(index: 0 | 1, overrides: Partial<InterviewJob> = {}): InterviewJob {
  const permit = preparedV3InterviewWindow.permits[index];
  const summary = index === 0 ? firstSummary : secondSummary;
  return interviewJobSchema.parse({
    id: `JOB-PREPARED-V3-${index + 1}`,
    exchangeId: `EXCHANGE-PREPARED-V3-${index + 1}`,
    permit,
    status: "summary_draft",
    clarificationTurns: index === 0 ? [
      { id: "CLARIFICATION-PREPARED-V3-1", role: "product_manager", text: "Use active seats billed monthly in USD.", createdAt: at(2_000) },
      { id: "CLARIFICATION-PREPARED-V3-2", role: "communicator", text: "Should suspended people and unaccepted invitations count?", createdAt: at(2_100) },
      { id: "CLARIFICATION-PREPARED-V3-3", role: "product_manager", text: "No, exclude both.", createdAt: at(2_200) },
    ] : [
      { id: "CLARIFICATION-PREPARED-V3-4", role: "product_manager", text: "Add the seat at acceptance and reduce it at renewal after removal.", createdAt: at(4_000) },
      { id: "CLARIFICATION-PREPARED-V3-5", role: "communicator", text: "Should removal revoke access immediately?", createdAt: at(4_100) },
      { id: "CLARIFICATION-PREPARED-V3-6", role: "product_manager", text: "Yes, immediately, with no mid-cycle refund.", createdAt: at(4_200) },
    ],
    decisionSummary: summary,
    deferral: null,
    confirmedAt: null,
    revalidatedAtRevision: null,
    revalidatedDependencyVersion: null,
    notAppliedReason: null,
    notAppliedExplanation: null,
    ...overrides,
  });
}

export const preparedV3DraftJobs = [preparedJob(0), preparedJob(1)] as const;
export const preparedV3ConfirmedJobs = [
  preparedJob(0, { status: "confirmed_queued", confirmedAt: at(3_000) }),
  preparedJob(1, { status: "confirmed_queued", confirmedAt: at(6_000) }),
] as const;
export const PREPARED_V3_INVALIDATION_REASON = "The applied permissions revision changed the seat-lifecycle dependency, so this exact prepared summary is no longer covered by a fresh permit.";
export const preparedV3RevalidatedJobs = [
  preparedJob(0, { status: "ready_to_apply", confirmedAt: at(3_000), revalidatedAtRevision: 2, revalidatedDependencyVersion: "DEPENDENCY-PREPARED-V3-2" }),
  preparedJob(1, { status: "not_applied", confirmedAt: at(6_000), revalidatedAtRevision: 2, revalidatedDependencyVersion: "DEPENDENCY-PREPARED-V3-2", notAppliedReason: "dependency_invalidated", notAppliedExplanation: PREPARED_V3_INVALIDATION_REASON }),
] as const;

export const preparedV3DecisionBatch: DecisionBatch = decisionBatchSchema.parse({
  id: "BATCH-PREPARED-V3-1",
  actionId: "ACTION-PREPARED-V3-BATCH",
  baseRevision: 2,
  dependencyVersion: "DEPENDENCY-PREPARED-V3-2",
  createdAt: at(34_000),
  lockedAt: at(34_000),
  entries: [{
    kind: "decision_summary",
    jobId: preparedV3RevalidatedJobs[0].id,
    exchangeId: preparedV3RevalidatedJobs[0].exchangeId,
    permitId: preparedV3RevalidatedJobs[0].permit.id,
    roadmapItemId: preparedV3RevalidatedJobs[0].permit.roadmapItemId,
    permitOrdinal: preparedV3RevalidatedJobs[0].permit.ordinal,
    confirmedTurnId: "TURN-PREPARED-V3-ASYNC-1",
    text: firstSummary.text,
    uncertainties: firstSummary.uncertainties,
    confirmedAt: at(3_000),
    revalidatedAtRevision: 2,
    revalidatedDependencyVersion: "DEPENDENCY-PREPARED-V3-2",
  }],
});

export const preparedV3AppliedJobs = [
  preparedJob(0, { status: "applied", confirmedAt: at(3_000), revalidatedAtRevision: 2, revalidatedDependencyVersion: "DEPENDENCY-PREPARED-V3-2" }),
  preparedV3RevalidatedJobs[1],
] as const;

export const preparedV3Specifications = {
  beforeRevision: migrateSpecificationToV3(teamBillingSnapshots[0]),
  authoritativeRevision: migrateSpecificationToV3(teamBillingSnapshots[1]),
  batchRevision: migrateSpecificationToV3(teamBillingSnapshots[2]),
  finalExport: migrateSpecificationToV3(teamBillingSnapshots.at(-1)),
} satisfies Record<string, V3Specification>;

export const preparedV3FinalMarkdown = specificationToMarkdown(preparedV3Specifications.finalExport, {
  mode: "demo",
  finalized: true,
  exportedAt: new Date("2026-07-21T00:00:38.000Z"),
});

function lifecycle(sequence: number, elapsedMs: number, kind: BrainLifecycleEvent["kind"]): BrainLifecycleEvent {
  return brainLifecycleEventSchema.parse({ schemaVersion: 1, requestId: "REQUEST-PREPARED-V3-ANSWER", actionId: "ACTION-PREPARED-V3-ANSWER", baseRevision: 1, cancelEpoch: 0, attempt: 1, sequence, observedAt: at(elapsedMs), kind });
}

export const preparedV3LifecycleEvents = [
  lifecycle(1, 0, "request_accepted"),
  lifecycle(2, 1_000, "provider_queued"),
  lifecycle(3, 12_000, "provider_in_progress"),
  lifecycle(4, 31_000, "provider_in_progress"),
  lifecycle(5, 32_000, "validating_output"),
] as const;

export type PreparedV3Stage =
  | "digest_confirmed"
  | "answer_submitted"
  | "window_opened"
  | "first_decision_confirmed"
  | "second_decision_confirmed"
  | "taking_longer"
  | "authoritative_revision_applied"
  | "jobs_revalidated"
  | "batch_auto_submitted"
  | "batch_revision_applied"
  | "final_review"
  | "export_ready";

export interface PreparedV3Frame {
  stage: PreparedV3Stage;
  label: string;
  elapsedMs: number;
  activityState: "working" | "taking_longer" | "revision_applied" | "stopped";
  lastLifecycleAt: string | null;
  activeJobId: string | null;
  jobs: readonly InterviewJob[];
  interviewWindow: InterviewWindow | null;
  lockedBatch: DecisionBatch | null;
  specification: V3Specification;
  exportReady: boolean;
  exportMarkdown: string | null;
}

export const preparedV3Frames: readonly PreparedV3Frame[] = [
  { stage: "digest_confirmed", label: "Prepared Project Context Digest confirmed", elapsedMs: 0, activityState: "stopped", lastLifecycleAt: null, activeJobId: null, jobs: [], interviewWindow: null, lockedBatch: null, specification: preparedV3Specifications.beforeRevision, exportReady: false, exportMarkdown: null },
  { stage: "answer_submitted", label: "Prepared answer submitted", elapsedMs: 0, activityState: "working", lastLifecycleAt: at(0), activeJobId: null, jobs: [], interviewWindow: null, lockedBatch: null, specification: preparedV3Specifications.beforeRevision, exportReady: false, exportMarkdown: null },
  { stage: "window_opened", label: "Two-permit Interview Window opened", elapsedMs: 1_000, activityState: "working", lastLifecycleAt: at(1_000), activeJobId: preparedV3DraftJobs[0].id, jobs: [preparedV3DraftJobs[0]], interviewWindow: preparedV3InterviewWindow, lockedBatch: null, specification: preparedV3Specifications.beforeRevision, exportReady: false, exportMarkdown: null },
  { stage: "first_decision_confirmed", label: "First prepared decision individually confirmed", elapsedMs: 3_000, activityState: "working", lastLifecycleAt: at(1_000), activeJobId: preparedV3DraftJobs[1].id, jobs: [preparedV3ConfirmedJobs[0], preparedV3DraftJobs[1]], interviewWindow: preparedV3InterviewWindow, lockedBatch: null, specification: preparedV3Specifications.beforeRevision, exportReady: false, exportMarkdown: null },
  { stage: "second_decision_confirmed", label: "Second prepared decision individually confirmed", elapsedMs: 6_000, activityState: "working", lastLifecycleAt: at(1_000), activeJobId: null, jobs: preparedV3ConfirmedJobs, interviewWindow: preparedV3InterviewWindow, lockedBatch: null, specification: preparedV3Specifications.beforeRevision, exportReady: false, exportMarkdown: null },
  { stage: "taking_longer", label: "Prepared clock advanced beyond 30 seconds", elapsedMs: 31_000, activityState: "taking_longer", lastLifecycleAt: at(31_000), activeJobId: null, jobs: preparedV3ConfirmedJobs, interviewWindow: preparedV3InterviewWindow, lockedBatch: null, specification: preparedV3Specifications.beforeRevision, exportReady: false, exportMarkdown: null },
  { stage: "authoritative_revision_applied", label: "Authoritative prepared revision applied first", elapsedMs: 32_000, activityState: "revision_applied", lastLifecycleAt: at(32_000), activeJobId: null, jobs: preparedV3ConfirmedJobs, interviewWindow: null, lockedBatch: null, specification: preparedV3Specifications.authoritativeRevision, exportReady: false, exportMarkdown: null },
  { stage: "jobs_revalidated", label: "One result remained valid and one became Not Applied", elapsedMs: 33_000, activityState: "revision_applied", lastLifecycleAt: at(32_000), activeJobId: null, jobs: preparedV3RevalidatedJobs, interviewWindow: null, lockedBatch: null, specification: preparedV3Specifications.authoritativeRevision, exportReady: false, exportMarkdown: null },
  { stage: "batch_auto_submitted", label: "One-entry prepared Decision Batch submitted automatically", elapsedMs: 34_000, activityState: "working", lastLifecycleAt: at(34_000), activeJobId: null, jobs: [preparedJob(0, { status: "applying", confirmedAt: at(3_000), revalidatedAtRevision: 2, revalidatedDependencyVersion: "DEPENDENCY-PREPARED-V3-2" }), preparedV3RevalidatedJobs[1]], interviewWindow: null, lockedBatch: preparedV3DecisionBatch, specification: preparedV3Specifications.authoritativeRevision, exportReady: false, exportMarkdown: null },
  { stage: "batch_revision_applied", label: "Prepared batch revision applied atomically", elapsedMs: 36_000, activityState: "revision_applied", lastLifecycleAt: at(36_000), activeJobId: null, jobs: preparedV3AppliedJobs, interviewWindow: null, lockedBatch: null, specification: preparedV3Specifications.batchRevision, exportReady: false, exportMarkdown: null },
  { stage: "final_review", label: "Prepared Final Review", elapsedMs: 37_000, activityState: "stopped", lastLifecycleAt: at(36_000), activeJobId: null, jobs: preparedV3AppliedJobs, interviewWindow: null, lockedBatch: null, specification: preparedV3Specifications.finalExport, exportReady: false, exportMarkdown: null },
  { stage: "export_ready", label: "Prepared Markdown export ready", elapsedMs: 38_000, activityState: "stopped", lastLifecycleAt: at(36_000), activeJobId: null, jobs: preparedV3AppliedJobs, interviewWindow: null, lockedBatch: null, specification: preparedV3Specifications.finalExport, exportReady: true, exportMarkdown: preparedV3FinalMarkdown },
];

export class PreparedV3DemoRunner {
  #index = 0;

  constructor() { validatePreparedV3Fixtures(); }
  get index() { return this.#index; }
  get current() { return preparedV3Frames[this.#index]; }
  get complete() { return this.#index === preparedV3Frames.length - 1; }
  advance(): PreparedV3Frame {
    if (!this.complete) this.#index += 1;
    return this.current;
  }
  reset(): PreparedV3Frame { this.#index = 0; return this.current; }
}

export function validatePreparedV3Fixtures(): { success: true; frameCount: number } {
  const validation = validateInterviewWindow(preparedV3InterviewWindow, preparedRoadmap, { revision: 1, dependencyVersion: "DEPENDENCY-PREPARED-V3-1", operation: "answer", applicationCap: 3 });
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  preparedV3Frames.forEach((frame) => frame.jobs.forEach((job) => interviewJobSchema.parse(job)));
  Object.values(preparedV3Specifications).forEach((specification) => { void specification; });
  decisionBatchSchema.parse(preparedV3DecisionBatch);
  return { success: true, frameCount: preparedV3Frames.length };
}
