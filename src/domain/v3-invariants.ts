import type { QuestionRoadmap, SpecificationItem } from "./types";
import { specificationSchema } from "./schemas";
import type {
  AdaptiveWindowState,
  BrainLifecycleEvent,
  DecisionBatchEntry,
  InterviewWindow,
  PriorPermitDisposition,
  V3BrainOperation,
  V3Specification,
} from "./v3-schemas";
import { v3SpecificationSchema } from "./v3-schemas";

export interface V3ValidationResult {
  valid: boolean;
  errors: string[];
}

export const V3_INVARIANT_TABLE = Object.freeze({
  authoritativeRequest: "At most one authoritative Brain request is active.",
  revisionBarrier: "A validated complete revision applies before asynchronous work is revalidated or batched.",
  activeQuestion: "Exactly zero or one permitted detailed/spoken question is active.",
  answerIntakeScope: "The Communicator assesses only Brain-authored Answer Aspects for one active prompt.",
  answerIntakePrivacy: "Raw Answer Intake remains memory-only and only an explicitly confirmed edited Answer Summary reaches the Brain.",
  sequentialPermitPromotion: "Only the next unused permit for the exact in-flight operation may be promoted after active work is consumed.",
  permitIdentity: "Every mutable Realtime event matches exchange, prompt, permit, and cancellation-epoch identity.",
  confirmation: "Only individually PM-confirmed and freshly revalidated entries enter a Decision Batch.",
  batchAtomicity: "Request-local batch turns become durable only with a validated complete batch revision.",
  lastValidSpecification: "Failure, cancellation, timeout, and stale work preserve the last valid Specification.",
  lifecyclePrivacy: "Lifecycle events contain only allowlisted content-free fields.",
  checkpointPrivacy: "Only bounded confirmed queued entries and the content-free adaptive tuple extend the V2 checkpoint.",
  provenanceIsolation: "Live, Prepared Demo, and experimental harness provenance remain structurally distinct.",
});

function roadmapGraph(roadmap: QuestionRoadmap): {
  errors: string[];
  items: Map<string, QuestionRoadmap["items"][number]>;
  hasPath(from: string, to: string): boolean;
} {
  const errors: string[] = [];
  const items = new Map<string, QuestionRoadmap["items"][number]>();
  for (const item of roadmap.items) {
    if (items.has(item.id)) errors.push(`${item.id}: duplicate roadmap item ID`);
    items.set(item.id, item);
  }
  for (const item of roadmap.items) {
    for (const dependencyId of item.dependencyIds) {
      if (!items.has(dependencyId)) errors.push(`${item.id}: unknown dependency ${dependencyId}`);
      if (dependencyId === item.id) errors.push(`${item.id}: roadmap item cannot depend on itself`);
    }
  }

  const visitState = new Map<string, "visiting" | "visited">();
  const visit = (id: string): void => {
    if (visitState.get(id) === "visiting") {
      errors.push(`${id}: roadmap dependency cycle`);
      return;
    }
    if (visitState.get(id) === "visited") return;
    visitState.set(id, "visiting");
    for (const dependency of items.get(id)?.dependencyIds ?? []) if (items.has(dependency)) visit(dependency);
    visitState.set(id, "visited");
  };
  for (const id of items.keys()) visit(id);

  const hasPath = (from: string, to: string): boolean => {
    const pending = [...(items.get(from)?.dependencyIds ?? [])];
    const seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(items.get(id)?.dependencyIds ?? []));
    }
    return false;
  };
  return { errors, items, hasPath };
}

export function validateInterviewWindow(
  window: InterviewWindow,
  roadmap: QuestionRoadmap,
  expected: { revision: number; dependencyVersion: string; operation: V3BrainOperation; applicationCap: 1 | 3 },
): V3ValidationResult {
  const graph = roadmapGraph(roadmap);
  const errors = [...graph.errors];
  if (window.approvedAtRevision !== expected.revision) errors.push("Interview Window is bound to the wrong revision");
  if (window.dependencyVersion !== expected.dependencyVersion) errors.push("Interview Window is bound to the wrong dependency version");
  if (window.independentOfOperation !== expected.operation) errors.push("Interview Window is bound to the wrong operation");
  if (window.applicationCap !== expected.applicationCap) errors.push("Interview Window does not echo the requested application cap");
  if (window.permits.length > expected.applicationCap) errors.push("Interview Window exceeds the requested application cap");

  const permitIds = new Set<string>();
  const roadmapIds = new Set<string>();
  const promptIds = new Set<string>();
  const decisionKeys = new Set<string>();
  const ordinals = new Set<number>();

  for (const permit of window.permits) {
    if (permitIds.has(permit.id)) errors.push(`${permit.id}: duplicate permit ID`);
    permitIds.add(permit.id);
    if (roadmapIds.has(permit.roadmapItemId)) errors.push(`${permit.roadmapItemId}: duplicate permitted roadmap item`);
    roadmapIds.add(permit.roadmapItemId);
    if (promptIds.has(permit.prompt.id)) errors.push(`${permit.prompt.id}: duplicate permit prompt ID`);
    promptIds.add(permit.prompt.id);
    if (decisionKeys.has(permit.prompt.decisionKey)) errors.push(`${permit.prompt.decisionKey}: duplicate permit decision key`);
    decisionKeys.add(permit.prompt.decisionKey);
    if (ordinals.has(permit.ordinal)) errors.push(`${permit.ordinal}: duplicate permit ordinal`);
    ordinals.add(permit.ordinal);

    if (permit.windowId !== window.id) errors.push(`${permit.id}: permit belongs to a different window`);
    if (permit.approvedAtRevision !== window.approvedAtRevision) errors.push(`${permit.id}: permit revision does not match its window`);
    if (permit.dependencyVersion !== window.dependencyVersion) errors.push(`${permit.id}: permit dependency version does not match its window`);
    if (permit.independentOfOperation !== window.independentOfOperation) errors.push(`${permit.id}: permit operation does not match its window`);

    const item = graph.items.get(permit.roadmapItemId);
    if (!item) errors.push(`${permit.id}: permit references an unknown roadmap item`);
    else {
      if (item.status !== "unresolved") errors.push(`${permit.id}: permit roadmap item must be unresolved`);
      if (item.decisionKey !== permit.prompt.decisionKey) errors.push(`${permit.id}: permit prompt decision key does not match its roadmap item`);
      if (item.dependencyIds.some((dependencyId) => graph.items.get(dependencyId)?.status !== "resolved")) {
        errors.push(`${permit.id}: permit has unresolved dependencies`);
      }
    }
    const invalidationIds = new Set<string>();
    for (const id of permit.invalidationItemIds) {
      if (invalidationIds.has(id)) errors.push(`${permit.id}: duplicate invalidation reference ${id}`);
      invalidationIds.add(id);
      if (!graph.items.has(id)) errors.push(`${permit.id}: unknown invalidation reference ${id}`);
      if (id === permit.roadmapItemId) errors.push(`${permit.id}: permit cannot invalidate itself`);
      if (roadmapIds.has(id) || window.permits.some((candidate) => candidate.roadmapItemId === id)) {
        errors.push(`${permit.id}: permit cannot name another permitted roadmap item as invalidation input`);
      }
    }
  }

  for (let left = 0; left < window.permits.length; left += 1) {
    for (let right = left + 1; right < window.permits.length; right += 1) {
      const a = window.permits[left].roadmapItemId;
      const b = window.permits[right].roadmapItemId;
      if (graph.hasPath(a, b) || graph.hasPath(b, a)) errors.push(`${a} and ${b}: permitted decisions are dependency-coupled`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validatePriorPermitDispositions(
  priorWindow: InterviewWindow | null,
  freshWindow: InterviewWindow,
  dispositions: PriorPermitDisposition[],
): V3ValidationResult {
  const errors: string[] = [];
  const expected = new Map((priorWindow?.permits ?? []).map((permit) => [permit.id, permit] as const));
  const seen = new Set<string>();
  const freshById = new Map(freshWindow.permits.map((permit) => [permit.id, permit] as const));
  const usedFreshIds = new Set<string>();
  for (const disposition of dispositions) {
    if (seen.has(disposition.priorPermitId)) errors.push(`${disposition.priorPermitId}: duplicate prior permit disposition`);
    seen.add(disposition.priorPermitId);
    const prior = expected.get(disposition.priorPermitId);
    if (!prior || disposition.priorWindowId !== priorWindow?.id) {
      errors.push(`${disposition.priorPermitId}: disposition does not match a prior permit`);
      continue;
    }
    if (disposition.roadmapItemId !== prior.roadmapItemId) errors.push(`${disposition.priorPermitId}: disposition changed roadmap identity`);
    if (disposition.status === "reissued") {
      const fresh = freshById.get(disposition.freshPermitId);
      if (!fresh) errors.push(`${disposition.priorPermitId}: reissue does not reference a fresh permit`);
      else {
        if (fresh.roadmapItemId !== prior.roadmapItemId || fresh.prompt.decisionKey !== prior.prompt.decisionKey) {
          errors.push(`${disposition.priorPermitId}: reissue changed decision identity`);
        }
        if (usedFreshIds.has(fresh.id)) errors.push(`${fresh.id}: fresh permit cannot reissue multiple prior permits`);
        usedFreshIds.add(fresh.id);
      }
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) errors.push(`${id}: missing prior permit disposition`);
  return { valid: errors.length === 0, errors };
}

export function validateExternalEvidence(specification: V3Specification): V3ValidationResult {
  const errors: string[] = [];
  const evidenceById = new Map<string, V3Specification["externalEvidence"][number]>();
  const canonicalUrls = new Set<string>();
  for (const evidence of specification.externalEvidence) {
    if (evidenceById.has(evidence.id)) errors.push(`${evidence.id}: duplicate External Evidence ID`);
    evidenceById.set(evidence.id, evidence);
    const canonicalUrl = new URL(evidence.url).toString();
    if (canonicalUrls.has(canonicalUrl)) errors.push(`${evidence.id}: duplicate canonical evidence URL`);
    canonicalUrls.add(canonicalUrl);
  }
  const sections = [
    ...specification.problemStatement,
    ...specification.users,
    ...specification.jobsToBeDone,
    ...specification.functionalRequirements,
    ...specification.nonFunctionalRequirements,
    ...specification.assumptions,
    ...specification.risks,
    ...specification.edgeCases,
    ...specification.openQuestions,
    ...specification.blockers,
  ];
  const items = new Map(sections.map((item) => [item.id, item] as const));
  for (const item of sections) {
    for (const id of item.externalEvidenceIds) {
      const evidence = evidenceById.get(id);
      if (!evidence) errors.push(`${item.id}: unknown External Evidence ${id}`);
      else if (!evidence.informedTargets.some((target) => target.kind === "specification_item" && target.itemId === item.id)) {
        errors.push(`${item.id}: External Evidence ${id} does not point back to the item`);
      }
      if (item.sourceTurnIds.length === 0 && item.status !== "proposed") {
        errors.push(`${item.id}: evidence-only content must remain proposed`);
      }
    }
  }
  for (const evidence of specification.externalEvidence) {
    for (const target of evidence.informedTargets) {
      if (target.kind === "specification_item") {
        const item = items.get(target.itemId);
        if (!item) errors.push(`${evidence.id}: unknown informed Specification Item ${target.itemId}`);
        else if (!item.externalEvidenceIds.includes(evidence.id)) errors.push(`${evidence.id}: informed item ${target.itemId} does not point back`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function migrateSpecificationToV3(specification: unknown): V3Specification {
  const parsedV3 = v3SpecificationSchema.safeParse(specification);
  if (parsedV3.success) return parsedV3.data;
  const legacy = requireLegacySpecification(specification);
  const migrateItems = (items: SpecificationItem[]) => items.map((item) => ({ ...item, externalEvidenceIds: [] }));
  return v3SpecificationSchema.parse({
    ...legacy,
    problemStatement: migrateItems(legacy.problemStatement),
    users: migrateItems(legacy.users),
    jobsToBeDone: migrateItems(legacy.jobsToBeDone),
    functionalRequirements: migrateItems(legacy.functionalRequirements),
    nonFunctionalRequirements: migrateItems(legacy.nonFunctionalRequirements),
    assumptions: migrateItems(legacy.assumptions),
    risks: migrateItems(legacy.risks),
    edgeCases: migrateItems(legacy.edgeCases),
    openQuestions: migrateItems(legacy.openQuestions),
    blockers: migrateItems(legacy.blockers),
    externalEvidence: [],
  });
}

function requireLegacySpecification(value: unknown) {
  // Kept local to make the compatibility boundary explicit and one-way.
  const { externalEvidence: _ignored, ...candidate } = (value ?? {}) as Record<string, unknown>;
  void _ignored;
  return specificationSchema.parse(candidate);
}

export function updateAdaptiveWindowState(
  state: AdaptiveWindowState,
  outcome: "applied" | "dependency_invalidated",
  wasSingleton: boolean,
): AdaptiveWindowState {
  const eligibleOutcomes = [...state.eligibleOutcomes, outcome].slice(-3);
  if (state.applicationCap === 3 && eligibleOutcomes.filter((value) => value === "dependency_invalidated").length >= 2) {
    return { eligibleOutcomes, applicationCap: 1, singletonRecoveryStreak: 0 };
  }
  if (state.applicationCap === 1) {
    const singletonRecoveryStreak = wasSingleton && outcome === "applied" ? state.singletonRecoveryStreak + 1 : 0;
    if (singletonRecoveryStreak >= 2) return { eligibleOutcomes, applicationCap: 3, singletonRecoveryStreak: 0 };
    return { eligibleOutcomes, applicationCap: 1, singletonRecoveryStreak };
  }
  return { eligibleOutcomes, applicationCap: 3, singletonRecoveryStreak: 0 };
}

export function orderDecisionBatchEntries(entries: DecisionBatchEntry[]): DecisionBatchEntry[] {
  return [...entries].sort((left, right) =>
    left.permitOrdinal - right.permitOrdinal
    || Date.parse(left.confirmedAt) - Date.parse(right.confirmedAt)
    || left.jobId.localeCompare(right.jobId));
}

export function validateLifecycleSequence(
  previous: BrainLifecycleEvent | null,
  next: BrainLifecycleEvent,
  expected: Pick<BrainLifecycleEvent, "requestId" | "actionId" | "baseRevision" | "cancelEpoch">,
): V3ValidationResult {
  const errors: string[] = [];
  for (const key of ["requestId", "actionId", "baseRevision", "cancelEpoch"] as const) {
    if (next[key] !== expected[key]) errors.push(`Lifecycle ${key} does not match the active action`);
  }
  if (previous && next.sequence <= previous.sequence) errors.push("Lifecycle sequence must increase monotonically");
  return { valid: errors.length === 0, errors };
}
