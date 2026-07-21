import type { BrainModelOutput, BrainRequest, ConversationTurn } from "@/domain/types";
import {
  orderDecisionBatchEntries,
  validateExternalEvidence,
  validateInterviewWindow,
  validatePriorPermitDispositions,
  type V3ValidationResult,
} from "@/domain/v3-invariants";
import type {
  DecisionBatchEntry,
  ExternalEvidence,
  InterviewWindow,
  PriorPermitDisposition,
  V3BrainModelOutput,
  V3BrainRequest,
  V3InterviewPrompt,
  V3Specification,
} from "@/domain/v3-schemas";

import {
  validateBrainOutput,
  validateBrainRequest,
  validateAnswerAspectIdOwnership,
  validatePromptAnswerAspects,
} from "./semantic-validator";

const DEFERRED_WITHOUT_CONTEXT = "Deferred without additional context.";

function result(errors: string[]): V3ValidationResult {
  return { valid: errors.length === 0, errors };
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalEvidenceUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function legacyOperation(operation: V3BrainRequest["operation"]): BrainRequest["operation"] {
  return operation === "decision_batch" ? "resume"
    : operation === "revalidate_restored" ? "resume"
      : operation;
}

function batchTurn(entry: DecisionBatchEntry): ConversationTurn {
  return {
    id: entry.confirmedTurnId,
    promptId: entry.permitId,
    type: entry.kind === "decision_summary" ? "confirmed_decision_summary" : "deferred_prompt",
    text: entry.kind === "decision_summary"
      ? entry.text
      : entry.note?.trim() || DEFERRED_WITHOUT_CONTEXT,
    createdAt: entry.confirmedAt,
  };
}

function asLegacyRequest(request: V3BrainRequest, includeBatchTurns: boolean): BrainRequest {
  return {
    schemaVersion: request.schemaVersion,
    sessionId: request.sessionId,
    mode: request.mode,
    requestId: request.requestId,
    baseRevision: request.baseRevision,
    operation: legacyOperation(request.operation),
    turns: includeBatchTurns && request.decisionBatch
      ? [...request.turns, ...request.decisionBatch.entries.map(batchTurn)]
      : request.turns,
    currentSpecification: request.currentSpecification,
    currentPrompt: request.currentPrompt,
    confirmedContextDigest: request.confirmedContextDigest,
    relevantSourceExcerpts: request.relevantSourceExcerpts,
    questionRoadmap: request.questionRoadmap,
  };
}

function validateBatch(request: V3BrainRequest, errors: string[]): void {
  const batch = request.decisionBatch;
  if (!batch) return;
  if (batch.actionId !== request.actionId) errors.push("decisionBatch.actionId must match the authoritative action");
  if (batch.baseRevision !== request.baseRevision) errors.push("decisionBatch.baseRevision must match the request revision");
  if (batch.dependencyVersion !== request.questionRoadmap.dependencyVersion) {
    errors.push("decisionBatch.dependencyVersion must match the current roadmap");
  }
  if (!sameJson(batch.entries, orderDecisionBatchEntries(batch.entries))) {
    errors.push("decisionBatch.entries must use deterministic permit/confirmation/job order");
  }
  for (const field of ["jobId", "exchangeId", "permitId", "roadmapItemId", "confirmedTurnId"] as const) {
    for (const duplicate of duplicateValues(batch.entries.map((entry) => entry[field]))) {
      errors.push(`decisionBatch.entries contains duplicate ${field} ${duplicate}`);
    }
  }
  if (Date.parse(batch.lockedAt) < Date.parse(batch.createdAt)) {
    errors.push("decisionBatch.lockedAt cannot precede createdAt");
  }
  const durableTurnIds = new Set(request.turns.map((turn) => turn.id));
  const permits = new Map((request.priorInterviewWindow?.permits ?? []).map((permit) => [permit.id, permit] as const));
  for (const entry of batch.entries) {
    if (durableTurnIds.has(entry.confirmedTurnId)) {
      errors.push(`${entry.confirmedTurnId}: request-local batch turn is already durable`);
    }
    if (entry.revalidatedAtRevision !== request.baseRevision) {
      errors.push(`${entry.jobId}: batch entry was not revalidated at the current revision`);
    }
    if (entry.revalidatedDependencyVersion !== request.questionRoadmap.dependencyVersion) {
      errors.push(`${entry.jobId}: batch entry was not revalidated against the current dependency version`);
    }
    if (Date.parse(entry.confirmedAt) > Date.parse(batch.lockedAt)) {
      errors.push(`${entry.jobId}: batch entry was locked before confirmation`);
    }
    const permit = permits.get(entry.permitId);
    if (!permit) {
      errors.push(`${entry.jobId}: batch entry does not belong to the supplied prior Interview Window`);
      continue;
    }
    if (permit.roadmapItemId !== entry.roadmapItemId || permit.ordinal !== entry.permitOrdinal) {
      errors.push(`${entry.jobId}: batch entry does not exactly match its Question Permit`);
    }
  }
}

/** Enforces V3 operation gates before a provider or experimental harness runs. */
export function validateV3BrainRequest(request: V3BrainRequest): V3ValidationResult {
  const errors: string[] = [];
  const legacy = validateBrainRequest(asLegacyRequest(request, request.operation === "decision_batch"));
  errors.push(...legacy.errors);
  if (request.operation === "decision_batch") validateBatch(request, errors);
  if (request.operation === "revalidate_restored") {
    if (request.turns.some((turn) => request.restoredEntriesForRevalidation.some((entry) => entry.confirmedTurnId === turn.id))) {
      errors.push("restored request-local turns must not already be durable");
    }
    for (const entry of request.restoredEntriesForRevalidation) {
      if (entry.approvalRevision > request.baseRevision) errors.push(`${entry.jobId}: restored approval revision is in the future`);
      if (entry.revalidatedAtRevision > request.baseRevision) errors.push(`${entry.jobId}: restored revalidation revision is in the future`);
    }
  }
  return result(errors);
}

function evidenceReferences(specification: V3Specification, prompts: readonly V3InterviewPrompt[]): {
  items: Map<string, V3Specification["problemStatement"][number]>;
  prompts: Map<string, V3InterviewPrompt>;
} {
  const items = new Map([
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
  ].map((item) => [item.id, item] as const));
  return { items, prompts: new Map(prompts.map((prompt) => [prompt.id, prompt] as const)) };
}

function validateEvidence(
  request: V3BrainRequest,
  output: V3BrainModelOutput,
  errors: string[],
): void {
  errors.push(...validateExternalEvidence(output.specification).errors);
  const prompts = [
    ...(output.nextPrompt ? [output.nextPrompt] : []),
    ...output.interviewWindow.permits.map((permit) => permit.prompt),
  ];
  const references = evidenceReferences(output.specification, prompts);
  const evidenceById = new Map(output.specification.externalEvidence.map((evidence) => [evidence.id, evidence] as const));
  const canonicalUrls = new Set<string>();
  for (const evidence of output.specification.externalEvidence) {
    const canonical = canonicalEvidenceUrl(evidence.url);
    if (canonicalUrls.has(canonical)) errors.push(`${evidence.id}: duplicate canonical evidence URL`);
    canonicalUrls.add(canonical);
    const targetKeys = evidence.informedTargets.map((target) =>
      target.kind === "specification_item" ? `item:${target.itemId}` : `prompt:${target.promptId}`);
    for (const duplicate of duplicateValues(targetKeys)) errors.push(`${evidence.id}: duplicate informed target ${duplicate}`);
  }

  for (const item of references.items.values()) {
    for (const duplicate of duplicateValues(item.externalEvidenceIds)) {
      errors.push(`${item.id}: duplicate External Evidence reference ${duplicate}`);
    }
  }

  for (const prompt of prompts) {
    for (const duplicate of duplicateValues(prompt.recommendation?.externalEvidenceIds ?? [])) {
      errors.push(`${prompt.id}: duplicate recommendation evidence reference ${duplicate}`);
    }
    for (const evidenceId of prompt.recommendation?.externalEvidenceIds ?? []) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) errors.push(`${prompt.id}: recommendation references unknown External Evidence ${evidenceId}`);
      else if (!evidence.informedTargets.some((target) => target.kind === "prompt_recommendation" && target.promptId === prompt.id)) {
        errors.push(`${prompt.id}: External Evidence ${evidenceId} does not point back to the recommendation`);
      }
    }
  }
  for (const evidence of output.specification.externalEvidence) {
    for (const target of evidence.informedTargets) {
      if (target.kind === "prompt_recommendation") {
        const prompt = references.prompts.get(target.promptId);
        if (!prompt?.recommendation) errors.push(`${evidence.id}: target ${target.promptId} has no recommendation`);
        else if (!prompt.recommendation.externalEvidenceIds.includes(evidence.id)) {
          errors.push(`${evidence.id}: recommendation ${target.promptId} does not point back`);
        }
      }
    }
  }

  const oldEvidence = new Map(request.currentSpecification.externalEvidence.map((evidence) => [evidence.id, evidence] as const));
  const oldIdByUrl = new Map(request.currentSpecification.externalEvidence.map((evidence) => [canonicalEvidenceUrl(evidence.url), evidence.id] as const));
  for (const evidence of output.specification.externalEvidence) {
    const old = oldEvidence.get(evidence.id);
    if (old && (
      old.title !== evidence.title
      || old.retrievedAt !== evidence.retrievedAt
      || canonicalEvidenceUrl(old.url) !== canonicalEvidenceUrl(evidence.url)
    )) {
      errors.push(`${evidence.id}: existing External Evidence ID changed meaning`);
    }
    const oldId = oldIdByUrl.get(canonicalEvidenceUrl(evidence.url));
    if (oldId && oldId !== evidence.id) errors.push(`${evidence.id}: canonical evidence URL changed stable ID from ${oldId}`);
  }

  const bundle = new Map(request.externalEvidenceBundle.map((evidence) => [evidence.id, evidence] as const));
  const previousIds = new Set(request.currentSpecification.externalEvidence.map((evidence) => evidence.id));
  for (const evidence of output.specification.externalEvidence) {
    if (previousIds.has(evidence.id)) continue;
    const frozen = bundle.get(evidence.id);
    if (!frozen) errors.push(`${evidence.id}: new External Evidence is absent from the frozen evidence bundle`);
    else if (frozen.title !== evidence.title || frozen.url !== evidence.url || frozen.retrievedAt !== evidence.retrievedAt) {
      errors.push(`${evidence.id}: External Evidence changed frozen source metadata`);
    }
  }
}

function validateRestoredDispositions(
  request: V3BrainRequest,
  freshWindow: InterviewWindow,
  dispositions: PriorPermitDisposition[],
  errors: string[],
): void {
  const expected = new Map(request.restoredEntriesForRevalidation.map((entry) => [entry.permitId, entry] as const));
  const seen = new Set<string>();
  const fresh = new Map(freshWindow.permits.map((permit) => [permit.id, permit] as const));
  for (const disposition of dispositions) {
    if (seen.has(disposition.priorPermitId)) errors.push(`${disposition.priorPermitId}: duplicate restored disposition`);
    seen.add(disposition.priorPermitId);
    const entry = expected.get(disposition.priorPermitId);
    if (!entry || disposition.priorWindowId !== entry.windowId || disposition.roadmapItemId !== entry.roadmapItemId) {
      errors.push(`${disposition.priorPermitId}: disposition does not exactly match a restored entry`);
      continue;
    }
    if (disposition.status === "reissued") {
      const permit = fresh.get(disposition.freshPermitId);
      if (!permit || permit.roadmapItemId !== entry.roadmapItemId) {
        errors.push(`${disposition.priorPermitId}: restored reissue has no compatible fresh permit`);
      }
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) errors.push(`${id}: missing restored permit disposition`);
}

/** Validates a complete V3 model snapshot atomically. */
export function validateV3BrainOutput(
  request: V3BrainRequest,
  output: V3BrainModelOutput,
): V3ValidationResult {
  const errors: string[] = [];
  const nextRevision = request.operation === "revalidate_restored" ? request.baseRevision : request.baseRevision + 1;
  if (output.questionRoadmap.lookaheadApproval !== null) {
    errors.push("V3 output must not retain the legacy singleton lookahead approval");
  }

  if (request.operation === "revalidate_restored") {
    if (!sameJson(output.specification, request.currentSpecification)) errors.push("revalidate_restored must not change the Specification");
    if (!sameJson(output.questionRoadmap, request.questionRoadmap)) errors.push("revalidate_restored must not change the Question Roadmap");
    if (!sameJson(output.nextPrompt, request.currentPrompt)) errors.push("revalidate_restored must not change the current Interview Prompt");
    if (output.changeSummary.length !== 0) errors.push("revalidate_restored must have an empty change summary");
  } else {
    const legacy = validateBrainOutput(
      asLegacyRequest(request, request.operation === "decision_batch"),
      output as BrainModelOutput,
    );
    errors.push(...legacy.errors);
  }

  const window = validateInterviewWindow(output.interviewWindow, output.questionRoadmap, {
    revision: nextRevision,
    dependencyVersion: output.questionRoadmap.dependencyVersion,
    operation: request.operation,
    applicationCap: request.requestedApplicationCap,
  });
  errors.push(...window.errors);
  for (const [index, permit] of output.interviewWindow.permits.entries()) {
    const roadmapItem = output.questionRoadmap.items.find((item) => item.id === permit.roadmapItemId);
    errors.push(...validatePromptAnswerAspects(
      permit.prompt,
      `interviewWindow.permits[${index}].prompt`,
      roadmapItem ? [roadmapItem.decisionKey, roadmapItem.topic] : [],
    ));
    if (permit.ordinal !== index + 1) errors.push(`${permit.id}: permit ordinal must match Brain-issued presentation order`);
    if (permit.roadmapItemId === output.questionRoadmap.currentDecisionItemId) {
      errors.push(`${permit.id}: Interview Window cannot repeat the current authoritative decision`);
    }
    if (output.nextPrompt && (permit.prompt.id === output.nextPrompt.id || permit.prompt.decisionKey === output.nextPrompt.decisionKey)) {
      errors.push(`${permit.id}: Interview Window prompt identity must be distinct from the current prompt`);
    }
  }
  errors.push(...validateAnswerAspectIdOwnership([
    ...(output.nextPrompt ? [output.nextPrompt] : []),
    ...output.interviewWindow.permits.map((permit) => permit.prompt),
  ]));

  if (request.operation === "revalidate_restored") {
    validateRestoredDispositions(request, output.interviewWindow, output.priorPermitDispositions, errors);
  } else {
    errors.push(...validatePriorPermitDispositions(
      request.priorInterviewWindow,
      output.interviewWindow,
      output.priorPermitDispositions,
    ).errors);
  }
  for (const disposition of output.priorPermitDispositions) {
    if (disposition.revalidatedAtRevision !== nextRevision) errors.push(`${disposition.priorPermitId}: disposition revision is stale`);
    if (disposition.dependencyVersion !== output.questionRoadmap.dependencyVersion) {
      errors.push(`${disposition.priorPermitId}: disposition dependency version is stale`);
    }
  }
  validateEvidence(request, output, errors);
  return result(errors);
}

export const BRAIN_V3_NON_ANSWER_MARKER = DEFERRED_WITHOUT_CONTEXT;

export function externalEvidenceHasStableMeaning(left: ExternalEvidence, right: ExternalEvidence): boolean {
  return left.id === right.id
    && left.title === right.title
    && left.retrievedAt === right.retrievedAt
    && canonicalEvidenceUrl(left.url) === canonicalEvidenceUrl(right.url);
}
