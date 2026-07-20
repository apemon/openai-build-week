import type {
  ActiveLookahead,
  ConfirmedProjectContextDigest,
  ProjectContextDigest,
  QuestionRoadmap,
} from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateProjectContextDigest(digest: ProjectContextDigest): ValidationResult {
  const errors: string[] = [];
  const sourceIds = new Set(digest.sources.map((source) => source.id));
  const statementIds = new Set<string>();

  for (const statement of digest.statements) {
    if (statementIds.has(statement.id)) errors.push(`${statement.id}: duplicate digest statement ID`);
    statementIds.add(statement.id);
    for (const reference of statement.sourceReferences) {
      if (!sourceIds.has(reference.sourceId)) {
        errors.push(`${statement.id}: unknown context source ${reference.sourceId}`);
      }
    }
  }

  if ((digest.coverage.omissions.length > 0 || digest.coverage.warnings.length > 0) && !digest.coverage.requiresAcknowledgement) {
    errors.push("Known context gaps require explicit acknowledgement");
  }

  return { valid: errors.length === 0, errors };
}

export function validateConfirmedProjectContextDigest(digest: ConfirmedProjectContextDigest): ValidationResult {
  const result = validateProjectContextDigest(digest);
  if (!digest.confirmedAt) result.errors.push("Confirmed context requires a confirmation timestamp");
  return { valid: result.errors.length === 0, errors: result.errors };
}

export function validateQuestionRoadmap(roadmap: QuestionRoadmap): ValidationResult {
  const errors: string[] = [];
  const itemIds = new Set<string>();
  for (const item of roadmap.items) {
    if (itemIds.has(item.id)) errors.push(`${item.id}: duplicate roadmap item ID`);
    itemIds.add(item.id);
  }

  for (const item of roadmap.items) {
    for (const dependencyId of item.dependencyIds) {
      if (!itemIds.has(dependencyId)) errors.push(`${item.id}: unknown dependency ${dependencyId}`);
      if (dependencyId === item.id) errors.push(`${item.id}: roadmap item cannot depend on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const itemsById = new Map(roadmap.items.map((item) => [item.id, item] as const));
  const visit = (itemId: string): void => {
    if (visiting.has(itemId)) {
      errors.push(`${itemId}: roadmap dependency cycle`);
      return;
    }
    if (visited.has(itemId)) return;
    visiting.add(itemId);
    for (const dependencyId of itemsById.get(itemId)?.dependencyIds ?? []) {
      if (itemsById.has(dependencyId)) visit(dependencyId);
    }
    visiting.delete(itemId);
    visited.add(itemId);
  };
  for (const item of roadmap.items) visit(item.id);

  for (const completedId of roadmap.completedItemIds) {
    if (itemsById.get(completedId)?.status !== "resolved") {
      errors.push(`${completedId}: completed roadmap item must be resolved`);
    }
  }

  if (roadmap.currentDecisionItemId && !itemIds.has(roadmap.currentDecisionItemId)) {
    errors.push("Current roadmap decision does not exist");
  }

  const approval = roadmap.lookaheadApproval;
  if (approval) {
    const approvedItem = itemsById.get(approval.roadmapItemId);
    if (!approvedItem) errors.push("Lookahead approval references an unknown roadmap item");
    else {
      if (approvedItem.status === "resolved") errors.push("Resolved roadmap work cannot be approved for lookahead");
      const unresolvedDependencies = approvedItem.dependencyIds.filter((dependencyId) => itemsById.get(dependencyId)?.status !== "resolved");
      if (unresolvedDependencies.length > 0) errors.push("Lookahead approval has unresolved dependencies");
    }
    if (approval.approvedAtRevision !== roadmap.baseRevision) {
      errors.push("Lookahead approval must be bound to the roadmap revision");
    }
    if (approval.dependencyVersion !== roadmap.dependencyVersion) {
      errors.push("Lookahead approval must be bound to the roadmap dependency version");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function revalidateLookahead(
  active: ActiveLookahead,
  roadmap: QuestionRoadmap,
): { valid: true; approval: NonNullable<QuestionRoadmap["lookaheadApproval"]> } | { valid: false; reason: string } {
  const roadmapValidation = validateQuestionRoadmap(roadmap);
  if (!roadmapValidation.valid) return { valid: false, reason: "The latest Question Roadmap did not validate." };

  const approval = roadmap.lookaheadApproval;
  if (!approval || approval.roadmapItemId !== active.approval.roadmapItemId) {
    const staleReason = roadmap.items.find((item) => item.id === active.approval.roadmapItemId)?.staleReason;
    return { valid: false, reason: staleReason ?? "The Brain no longer approves this decision for lookahead." };
  }
  if (approval.approvedAtRevision !== roadmap.baseRevision || approval.dependencyVersion !== roadmap.dependencyVersion) {
    return { valid: false, reason: "The lookahead approval no longer matches the latest dependency state." };
  }
  return { valid: true, approval };
}
