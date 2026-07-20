import type { V3SessionEvent } from "./session-events";
import {
  adaptiveWindowStateSchema,
  interviewJobSchema,
  type AdaptiveWindowState,
  type BrainActivityState,
  type BrainLifecycleEvent,
  type DecisionBatch,
  type DecisionBatchEntry,
  type InterviewJob,
  type InterviewWindow,
  type RestoredAsyncEntry,
} from "./v3-schemas";
import { updateAdaptiveWindowState, validateLifecycleSequence } from "./v3-invariants";

export interface V3BrainActivity {
  state: BrainActivityState | "idle";
  requestId: string | null;
  actionId: string | null;
  baseRevision: number | null;
  cancelEpoch: number;
  acceptedAt: string | null;
  lastLifecycleAt: string | null;
  lastSequence: number | null;
}

export interface V3RuntimeState {
  interviewWindow: InterviewWindow | null;
  jobs: InterviewJob[];
  activeJobId: string | null;
  adaptiveWindow: AdaptiveWindowState;
  lockedDecisionBatch: DecisionBatch | null;
  restoredEntries: RestoredAsyncEntry[];
  restoredRevalidationCompleted: boolean;
  restoredInvalidationReasons: string[];
  questionsPaused: boolean;
  cancelEpoch: number;
  brainActivity: V3BrainActivity;
}

export function createInitialV3RuntimeState(restoredAdaptive?: AdaptiveWindowState): V3RuntimeState {
  const adaptiveWindow = restoredAdaptive
    ? adaptiveWindowStateSchema.parse(restoredAdaptive)
    : { eligibleOutcomes: [], applicationCap: 1 as const, singletonRecoveryStreak: 0 };
  return {
    interviewWindow: null,
    jobs: [],
    activeJobId: null,
    adaptiveWindow,
    lockedDecisionBatch: null,
    restoredEntries: [],
    restoredRevalidationCompleted: false,
    restoredInvalidationReasons: [],
    questionsPaused: false,
    cancelEpoch: 0,
    brainActivity: {
      state: "idle",
      requestId: null,
      actionId: null,
      baseRevision: null,
      cancelEpoch: 0,
      acceptedAt: null,
      lastLifecycleAt: null,
      lastSequence: null,
    },
  };
}

function applyLifecycle(state: V3RuntimeState, event: BrainLifecycleEvent): V3RuntimeState {
  const activity = state.brainActivity;
  if (!activity.requestId || !activity.actionId || activity.baseRevision === null) return state;
  const previous = activity.lastSequence === null || !activity.lastLifecycleAt
    ? null
    : {
        ...event,
        sequence: activity.lastSequence,
        observedAt: activity.lastLifecycleAt,
      };
  const validation = validateLifecycleSequence(previous, event, {
    requestId: activity.requestId,
    actionId: activity.actionId,
    baseRevision: activity.baseRevision,
    cancelEpoch: activity.cancelEpoch,
  });
  if (!validation.valid) return state;
  return {
    ...state,
    brainActivity: {
      ...activity,
      state: "working",
      lastLifecycleAt: event.observedAt,
      lastSequence: event.sequence,
    },
  };
}

function revalidateJobs(state: V3RuntimeState, freshWindow: InterviewWindow, dispositions: import("./v3-schemas").PriorPermitDisposition[]): V3RuntimeState {
  const dispositionByPermit = new Map(dispositions.map((disposition) => [disposition.priorPermitId, disposition] as const));
  const freshPermits = new Map(freshWindow.permits.map((permit) => [permit.id, permit] as const));
  let adaptiveWindow = state.adaptiveWindow;
  const jobs = state.jobs.map((job) => {
    if (job.permit.windowId !== state.interviewWindow?.id || ["applied", "not_applied"].includes(job.status)) return job;
    const disposition = dispositionByPermit.get(job.permit.id);
    if (!disposition || disposition.status === "dependency_invalidated") {
      if (job.decisionSummary && job.status !== "approved") {
        adaptiveWindow = updateAdaptiveWindowState(adaptiveWindow, "dependency_invalidated", state.interviewWindow?.applicationCap === 1);
      }
      return interviewJobSchema.parse({
        ...job,
        status: "not_applied",
        notAppliedReason: "dependency_invalidated",
        notAppliedExplanation: disposition?.status === "dependency_invalidated"
          ? disposition.reason
          : "The Brain did not issue a valid disposition for this prior permit.",
      });
    }
    const freshPermit = freshPermits.get(disposition.freshPermitId);
    if (!freshPermit) return job;
    const confirmed = job.status === "confirmed_queued" || job.status === "revalidation_pending";
    return interviewJobSchema.parse({
      ...job,
      permit: freshPermit,
      status: confirmed ? "ready_to_apply" : "revalidation_pending",
      revalidatedAtRevision: disposition.revalidatedAtRevision,
      revalidatedDependencyVersion: disposition.dependencyVersion,
      notAppliedReason: null,
      notAppliedExplanation: null,
    });
  });
  return {
    ...state,
    jobs,
    activeJobId: jobs.some((job) => job.id === state.activeJobId && job.status !== "not_applied") ? state.activeJobId : null,
    adaptiveWindow,
    interviewWindow: freshWindow,
  };
}

export function v3RuntimeReducer(state: V3RuntimeState, event: V3SessionEvent): V3RuntimeState {
  let next = state;
  switch (event.type) {
    case "V3_RUNTIME_RESET":
      next = createInitialV3RuntimeState();
      break;
    case "V3_DEMO_FRAME_LOADED":
      next = {
        ...state,
        interviewWindow: event.interviewWindow,
        adaptiveWindow: event.interviewWindow
          ? { ...state.adaptiveWindow, applicationCap: event.interviewWindow.applicationCap }
          : state.adaptiveWindow,
        jobs: event.jobs,
        activeJobId: event.activeJobId,
        lockedDecisionBatch: event.lockedBatch,
        brainActivity: {
          state: event.activity.state,
          requestId: event.activity.state === "working" || event.activity.state === "taking_longer" ? "REQUEST-PREPARED-V3" : null,
          actionId: event.activity.state === "working" || event.activity.state === "taking_longer" ? "ACTION-PREPARED-V3" : null,
          baseRevision: event.activity.state === "working" || event.activity.state === "taking_longer" ? 1 : null,
          cancelEpoch: state.cancelEpoch,
          acceptedAt: event.activity.acceptedAt,
          lastLifecycleAt: event.activity.lastLifecycleAt,
          lastSequence: null,
        },
      };
      break;
    case "V3_BRAIN_ACTION_ACCEPTED":
      if (["working", "taking_longer"].includes(state.brainActivity.state)) return state;
      next = {
        ...state,
        cancelEpoch: event.cancelEpoch,
        brainActivity: {
          state: "working",
          requestId: event.requestId,
          actionId: event.actionId,
          baseRevision: null,
          cancelEpoch: event.cancelEpoch,
          acceptedAt: event.acceptedAt,
          lastLifecycleAt: event.acceptedAt,
          lastSequence: null,
        },
      };
      break;
    case "V3_BRAIN_LIFECYCLE_RECEIVED":
      if (state.brainActivity.baseRevision === null && state.brainActivity.requestId === event.event.requestId && state.brainActivity.actionId === event.event.actionId) {
        next = applyLifecycle({ ...state, brainActivity: { ...state.brainActivity, baseRevision: event.event.baseRevision } }, event.event);
      } else next = applyLifecycle(state, event.event);
      break;
    case "V3_BRAIN_STREAM_INTERRUPTED":
      if (state.brainActivity.requestId !== event.requestId || state.brainActivity.actionId !== event.actionId || state.brainActivity.cancelEpoch !== event.cancelEpoch) return state;
      next = { ...state, brainActivity: { ...state.brainActivity, state: "connection_interrupted", lastLifecycleAt: event.observedAt } };
      break;
    case "V3_BRAIN_TIMED_OUT":
      if (state.brainActivity.requestId !== event.requestId || state.brainActivity.actionId !== event.actionId || state.brainActivity.cancelEpoch !== event.cancelEpoch) return state;
      next = { ...state, brainActivity: { ...state.brainActivity, state: "timed_out", lastLifecycleAt: event.observedAt } };
      break;
    case "V3_BRAIN_RESPONSE_RECEIVED": {
      if (state.brainActivity.requestId !== event.response.requestId || state.brainActivity.baseRevision !== event.response.baseRevision) return state;
      if (state.restoredEntries.length > 0 && !state.restoredRevalidationCompleted && !state.lockedDecisionBatch) {
        const dispositionByPermit = new Map(event.response.output.priorPermitDispositions.map((disposition) => [disposition.priorPermitId, disposition] as const));
        const freshPermits = new Map(event.response.output.interviewWindow.permits.map((permit) => [permit.id, permit] as const));
        const restoredJobs: InterviewJob[] = [];
        const invalidationReasons: string[] = [];
        for (const entry of state.restoredEntries) {
          const disposition = dispositionByPermit.get(entry.permitId);
          if (!disposition || disposition.status === "dependency_invalidated") {
            invalidationReasons.push(disposition?.status === "dependency_invalidated"
              ? disposition.reason
              : "The Brain did not issue a valid disposition for a restored decision.");
            continue;
          }
          const permit = freshPermits.get(disposition.freshPermitId);
          if (!permit) {
            invalidationReasons.push("The Brain did not issue the fresh permit required for a restored decision.");
            continue;
          }
          restoredJobs.push(interviewJobSchema.parse({
            id: entry.jobId,
            exchangeId: entry.exchangeId,
            permit,
            status: "ready_to_apply",
            clarificationTurns: [],
            decisionSummary: entry.kind === "decision_summary"
              ? { id: `SUMMARY-${entry.jobId}`, roadmapItemId: entry.roadmapItemId, text: entry.text, uncertainties: entry.uncertainties }
              : null,
            deferral: entry.kind === "deferred_prompt" ? { id: `DEFERRAL-${entry.jobId}`, note: entry.note } : null,
            confirmedAt: entry.confirmedAt,
            revalidatedAtRevision: disposition.revalidatedAtRevision,
            revalidatedDependencyVersion: disposition.dependencyVersion,
            notAppliedReason: null,
            notAppliedExplanation: null,
          }));
        }
        next = {
          ...state,
          interviewWindow: event.response.output.interviewWindow,
          jobs: restoredJobs,
          activeJobId: null,
          restoredRevalidationCompleted: true,
          restoredInvalidationReasons: invalidationReasons,
          brainActivity: { ...state.brainActivity, state: "stopped", lastLifecycleAt: new Date().toISOString() },
        };
        break;
      }
      const revalidated = revalidateJobs(state, event.response.output.interviewWindow, event.response.output.priorPermitDispositions);
      let jobs = revalidated.jobs;
      let adaptiveWindow = revalidated.adaptiveWindow;
      if (state.lockedDecisionBatch) {
        const appliedIds = new Set(state.lockedDecisionBatch.entries.map((entry) => entry.jobId));
        jobs = jobs.map((job) => {
          if (!appliedIds.has(job.id)) return job;
          if (job.decisionSummary) adaptiveWindow = updateAdaptiveWindowState(adaptiveWindow, "applied", state.lockedDecisionBatch?.entries.length === 1);
          return { ...job, status: "applied" as const };
        });
      }
      next = {
        ...revalidated,
        jobs,
        adaptiveWindow,
        lockedDecisionBatch: null,
        brainActivity: { ...state.brainActivity, state: "revision_applied", lastLifecycleAt: new Date().toISOString() },
      };
      break;
    }
    case "V3_INTERVIEW_WINDOW_AVAILABLE":
      next = { ...state, interviewWindow: event.window };
      break;
    case "V3_PERMIT_PRESENTED":
      if (state.questionsPaused || state.activeJobId || event.permit.windowId !== state.interviewWindow?.id) return state;
      next = { ...state, activeJobId: event.job.id, jobs: [...state.jobs, interviewJobSchema.parse({ ...event.job, status: "presenting" })] };
      break;
    case "V3_JOB_UPDATED":
      if (!state.jobs.some((job) => job.id === event.job.id)) return state;
      next = { ...state, jobs: state.jobs.map((job) => job.id === event.job.id ? interviewJobSchema.parse(event.job) : job) };
      break;
    case "V3_JOB_CONFIRMED":
      next = {
        ...state,
        activeJobId: state.activeJobId === event.jobId ? null : state.activeJobId,
        jobs: state.jobs.map((job) => job.id === event.jobId && ["summary_draft", "paused"].includes(job.status)
          ? { ...job, status: "confirmed_queued" as const, confirmedAt: event.confirmedAt }
          : job),
      };
      break;
    case "V3_JOB_CONFIRMATION_UNDONE":
      if (state.lockedDecisionBatch?.entries.some((entry) => entry.jobId === event.jobId)) return state;
      next = { ...state, jobs: state.jobs.map((job) => job.id === event.jobId && job.status === "confirmed_queued" ? { ...job, status: "summary_draft" as const, confirmedAt: null } : job) };
      break;
    case "V3_JOB_REVALIDATION_PENDING":
      next = { ...state, jobs: state.jobs.map((job) => job.id === event.jobId && !["applied", "not_applied"].includes(job.status) ? { ...job, status: "revalidation_pending" as const } : job) };
      break;
    case "V3_JOB_NOT_APPLIED":
      next = { ...state, activeJobId: state.activeJobId === event.jobId ? null : state.activeJobId, jobs: state.jobs.map((job) => job.id === event.jobId ? interviewJobSchema.parse({ ...job, status: "not_applied", notAppliedReason: event.reason, notAppliedExplanation: event.explanation }) : job) };
      break;
    case "V3_QUESTIONS_PAUSED":
      next = { ...state, questionsPaused: true, cancelEpoch: event.nextCancelEpoch, jobs: state.jobs.map((job) => job.id === state.activeJobId && !["applied", "not_applied"].includes(job.status) ? { ...job, status: "paused" as const } : job) };
      break;
    case "V3_QUESTIONS_RESUMED":
      next = { ...state, questionsPaused: false, jobs: state.jobs.map((job) => job.id === state.activeJobId ? { ...job, permit: event.permit, status: job.decisionSummary ? "summary_draft" as const : "presenting" as const } : job) };
      break;
    case "V3_DECISION_BATCH_LOCKED": {
      if (state.lockedDecisionBatch) return state;
      const ids = new Set(event.batch.entries.map((entry) => entry.jobId));
      if (event.batch.entries.some((entry) => !state.jobs.some((job) => job.id === entry.jobId && job.status === "ready_to_apply"))) return state;
      next = { ...state, lockedDecisionBatch: event.batch, jobs: state.jobs.map((job) => ids.has(job.id) ? { ...job, status: "applying" as const } : job) };
      break;
    }
    case "V3_DECISION_BATCH_RETRY_REQUESTED":
      if (state.lockedDecisionBatch?.id !== event.batchId || !state.lockedDecisionBatch.entries.every((entry) => state.jobs.find((job) => job.id === entry.jobId)?.status === "apply_failed")) return state;
      next = { ...state, cancelEpoch: event.cancelEpoch, jobs: state.jobs.map((job) => state.lockedDecisionBatch?.entries.some((entry) => entry.jobId === job.id) ? { ...job, status: "applying" as const } : job) };
      break;
    case "V3_RESTORED_ENTRIES_LOADED":
      if (event.entries.length > 3) return state;
      next = { ...state, restoredEntries: event.entries, restoredRevalidationCompleted: false, restoredInvalidationReasons: [] };
      break;
    case "V3_CHECKPOINT_RESTORED":
      next = { ...createInitialV3RuntimeState(event.adaptiveWindow), restoredEntries: event.entries };
      break;
    case "V3_RESTORED_REVALIDATION_REQUESTED":
      if (state.restoredEntries.length === 0) return state;
      next = state;
      break;
    case "V3_RESTORED_SUBMISSION_REQUESTED":
      if (!state.restoredRevalidationCompleted || event.batch.entries.some((entry) => !state.jobs.some((job) => job.id === entry.jobId && job.status === "ready_to_apply"))) return state;
      next = {
        ...state,
        lockedDecisionBatch: event.batch,
        restoredEntries: [],
        restoredRevalidationCompleted: false,
        restoredInvalidationReasons: [],
        jobs: state.jobs.map((job) => event.batch.entries.some((entry) => entry.jobId === job.id) ? { ...job, status: "applying" as const } : job),
      };
      break;
    case "V3_RESTORED_ENTRIES_DISCARDED":
      next = { ...state, restoredEntries: [], restoredRevalidationCompleted: false, restoredInvalidationReasons: [], jobs: [] };
      break;
  }
  return assertV3RuntimeInvariants(next);
}

export function deriveBrainActivity(state: V3RuntimeState, nowMs: number): BrainActivityState | "idle" {
  const activity = state.brainActivity;
  if (["connection_interrupted", "needs_attention", "timed_out", "revision_applied", "stopped", "idle"].includes(activity.state)) return activity.state;
  if (!activity.acceptedAt || !activity.lastLifecycleAt) return "needs_attention";
  if (nowMs - Date.parse(activity.lastLifecycleAt) >= 10_000) return "needs_attention";
  if (nowMs - Date.parse(activity.acceptedAt) >= 30_000) return "taking_longer";
  return "working";
}

export function getV3RuntimeInvariantErrors(state: V3RuntimeState): string[] {
  const errors: string[] = [];
  const active = state.jobs.filter((job) => ["presenting", "clarifying", "summary_draft", "paused"].includes(job.status));
  if (active.length > 1) errors.push("Only one Interview Job may present or clarify at a time");
  if (state.activeJobId && !active.some((job) => job.id === state.activeJobId)) errors.push("Active Interview Job identity must resolve to active work");
  if (state.interviewWindow && state.interviewWindow.permits.length > state.adaptiveWindow.applicationCap) errors.push("Interview Window exceeds the application cap");
  if (state.lockedDecisionBatch) {
    const unique = new Set(state.lockedDecisionBatch.entries.map((entry) => entry.jobId));
    if (unique.size !== state.lockedDecisionBatch.entries.length) errors.push("Decision Batch job membership must be unique");
  }
  if (state.restoredEntries.length > 3) errors.push("At most three confirmed queued entries may be restored");
  return errors;
}

export function assertV3RuntimeInvariants(state: V3RuntimeState): V3RuntimeState {
  const errors = getV3RuntimeInvariantErrors(state);
  if (errors.length) throw new Error(errors.join("; "));
  return state;
}

export function createDecisionBatchEntries(jobs: InterviewJob[]): DecisionBatchEntry[] {
  return jobs.filter((job) => job.status === "ready_to_apply" && job.confirmedAt && job.revalidatedAtRevision !== null && job.revalidatedDependencyVersion)
    .map((job): DecisionBatchEntry => {
      const base = {
        jobId: job.id,
        exchangeId: job.exchangeId,
        permitId: job.permit.id,
        roadmapItemId: job.permit.roadmapItemId,
        permitOrdinal: job.permit.ordinal,
        confirmedTurnId: `TURN-${job.id}`,
        confirmedAt: job.confirmedAt!,
        revalidatedAtRevision: job.revalidatedAtRevision!,
        revalidatedDependencyVersion: job.revalidatedDependencyVersion!,
      };
      if (job.decisionSummary) return { ...base, kind: "decision_summary", text: job.decisionSummary.text, uncertainties: job.decisionSummary.uncertainties };
      return { ...base, kind: "deferred_prompt", note: job.deferral?.note ?? null };
    })
    .sort((left, right) => left.permitOrdinal - right.permitOrdinal || left.confirmedAt.localeCompare(right.confirmedAt) || left.jobId.localeCompare(right.jobId));
}

export function createRestoredAsyncEntries(jobs: InterviewJob[]): RestoredAsyncEntry[] {
  return jobs
    .filter((job) => ["confirmed_queued", "revalidation_pending", "ready_to_apply", "applying", "apply_failed"].includes(job.status) && job.confirmedAt)
    .slice(0, 3)
    .map((job): RestoredAsyncEntry => {
      const base = {
        jobId: job.id,
        exchangeId: job.exchangeId,
        permitId: job.permit.id,
        roadmapItemId: job.permit.roadmapItemId,
        permitOrdinal: job.permit.ordinal,
        confirmedTurnId: `TURN-${job.id}`,
        confirmedAt: job.confirmedAt!,
        revalidatedAtRevision: job.revalidatedAtRevision ?? job.permit.approvedAtRevision,
        revalidatedDependencyVersion: job.revalidatedDependencyVersion ?? job.permit.dependencyVersion,
        windowId: job.permit.windowId,
        approvalRevision: job.permit.approvedAtRevision,
        approvalDependencyVersion: job.permit.dependencyVersion,
      };
      if (job.decisionSummary) return { ...base, kind: "decision_summary", text: job.decisionSummary.text, uncertainties: job.decisionSummary.uncertainties };
      return { ...base, kind: "deferred_prompt", note: job.deferral?.note ?? null };
    });
}
