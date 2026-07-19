import type {
  AcceptanceCriterion,
  BrainModelOutput,
  BrainRequest,
  ConversationTurn,
  InterviewPrompt,
  Specification,
  SpecificationItem,
  VisualAid,
} from "@/domain/types";

export interface SemanticValidationResult {
  valid: boolean;
  errors: string[];
}

type ItemSection = Exclude<
  keyof Specification,
  "title" | "acceptanceCriteria" | "nextActions" | "readiness"
>;

const itemSections: Array<{
  key: ItemSection;
  kind: SpecificationItem["kind"];
  idPattern: RegExp;
}> = [
  { key: "problemStatement", kind: "problem", idPattern: /^PROB-[0-9]{3,}$/ },
  { key: "users", kind: "user", idPattern: /^USER-[0-9]{3,}$/ },
  { key: "jobsToBeDone", kind: "job", idPattern: /^JOB-[0-9]{3,}$/ },
  { key: "functionalRequirements", kind: "functional_requirement", idPattern: /^FR-[0-9]{3,}$/ },
  { key: "nonFunctionalRequirements", kind: "non_functional_requirement", idPattern: /^NFR-[0-9]{3,}$/ },
  { key: "assumptions", kind: "assumption", idPattern: /^ASM-[0-9]{3,}$/ },
  { key: "risks", kind: "risk", idPattern: /^RISK-[0-9]{3,}$/ },
  { key: "edgeCases", kind: "edge_case", idPattern: /^EDGE-[0-9]{3,}$/ },
  { key: "openQuestions", kind: "open_question", idPattern: /^OQ-[0-9]{3,}$/ },
  { key: "blockers", kind: "blocker", idPattern: /^BLK-[0-9]{3,}$/ },
];

const demoMarker = /\b(?:prepared[ _-]?demo|demo[ _-]?mode|prepared[ _-]?scenario|no ai call)\b/i;
const consequentialToken = /\b(?:must|shall|only|never|always|cannot|can't|may not|required?|prohibited?)\b|\b\d+(?:\.\d+)?%?\b/gi;
const insignificantWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "can",
  "could",
  "how",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

function itemMap(specification: Specification): Map<string, SpecificationItem> {
  return new Map(itemSections.flatMap(({ key }) => specification[key]).map((item) => [item.id, item]));
}

function normalizedMeaningWords(statement: string): Set<string> {
  return new Set(
    statement
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !insignificantWords.has(word)),
  );
}

function retainedMeaningIsCompatible(before: string, after: string): boolean {
  if (before.trim().toLowerCase() === after.trim().toLowerCase()) return true;
  const oldWords = normalizedMeaningWords(before);
  const newWords = normalizedMeaningWords(after);
  if (oldWords.size === 0 || newWords.size === 0) return false;
  let overlap = 0;
  for (const word of oldWords) if (newWords.has(word)) overlap += 1;
  return overlap / Math.min(oldWords.size, newWords.size) >= 0.4;
}

function exactlyOneQuestion(text: string): boolean {
  return (text.match(/\?/g) ?? []).length === 1;
}

function questionsShareDecision(detailed: string, spoken: string): boolean {
  const detailedWords = normalizedMeaningWords(detailed);
  const spokenWords = normalizedMeaningWords(spoken);
  return [...spokenWords].some((word) => detailedWords.has(word));
}

function setEquals(actual: readonly string[], expected: readonly string[]): boolean {
  const left = new Set(actual);
  const right = new Set(expected);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateDerivedItem(
  item: SpecificationItem,
  turnsById: ReadonlyMap<string, ConversationTurn>,
  errors: string[],
): void {
  if (item.status !== "derived") return;
  if (item.sourceTurnIds.length === 0) {
    errors.push(`${item.id}: derived items require confirmed source turns`);
    return;
  }

  const sourceText = item.sourceTurnIds
    .map((id) => turnsById.get(id))
    .filter(
      (turn): turn is ConversationTurn =>
        turn !== undefined && (turn.type === "confirmed_answer" || turn.type === "correction"),
    )
    .map((turn) => turn.text)
    .join(" ")
    .toLowerCase();

  const hasOnlyConfirmedSources = item.sourceTurnIds.every((id) => {
    const turn = turnsById.get(id);
    return turn?.type === "confirmed_answer" || turn?.type === "correction";
  });
  if (!hasOnlyConfirmedSources) {
    errors.push(`${item.id}: derived items may cite only confirmed answers or corrections`);
  }

  const unsupportedConstraints = [...item.statement.matchAll(consequentialToken)]
    .map((match) => match[0].toLowerCase())
    .filter((token) => !sourceText.includes(token));
  if (unsupportedConstraints.length > 0) {
    errors.push(`${item.id}: derived item introduces unsupported constraint ${unsupportedConstraints[0]}`);
  }
  if (item.rationale.trim().length === 0) errors.push(`${item.id}: derived item requires an entailment rationale`);
}

function validateAcceptanceCriterion(
  criterion: AcceptanceCriterion,
  validRequirementIds: ReadonlySet<string>,
  turnsById: ReadonlyMap<string, ConversationTurn>,
  errors: string[],
): void {
  for (const requirementId of criterion.requirementIds) {
    if (!validRequirementIds.has(requirementId)) {
      errors.push(`${criterion.id}: unknown requirement reference ${requirementId}`);
    }
  }
  for (const sourceTurnId of criterion.sourceTurnIds) {
    if (!turnsById.has(sourceTurnId)) errors.push(`${criterion.id}: unknown source turn ${sourceTurnId}`);
  }
  if (criterion.sourceTurnIds.length === 0) errors.push(`${criterion.id}: sourceTurnIds must not be empty`);
  if (criterion.status === "confirmed" || criterion.status === "derived") {
    const hasOnlyConfirmedSources = criterion.sourceTurnIds.every((id) => {
      const turn = turnsById.get(id);
      return turn?.type === "confirmed_answer" || turn?.type === "correction";
    });
    if (!hasOnlyConfirmedSources) {
      errors.push(`${criterion.id}: ${criterion.status} criteria require confirmed sources`);
    }
  }

  if (
    criterion.format === "given_when_then" &&
    (!criterion.given || !criterion.when || !criterion.then || criterion.assertion !== null)
  ) {
    errors.push(`${criterion.id}: given_when_then requires given/when/then and a null assertion`);
  }
  if (
    criterion.format === "measurable_assertion" &&
    (!criterion.assertion || criterion.given !== null || criterion.when !== null || criterion.then !== null)
  ) {
    errors.push(`${criterion.id}: measurable_assertion requires only assertion`);
  }
}

function validateVisualAid(
  visualAid: VisualAid,
  validItemIds: ReadonlySet<string>,
  errors: string[],
): void {
  if (visualAid.nodes.length > 8) errors.push("nextPrompt.visualAid: more than eight nodes");
  if (visualAid.edges.length > 10) errors.push("nextPrompt.visualAid: more than ten edges");
  const nodeIds = new Set<string>();
  for (const node of visualAid.nodes) {
    if (nodeIds.has(node.id)) errors.push(`nextPrompt.visualAid: duplicate node ID ${node.id}`);
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of visualAid.edges) {
    if (edgeIds.has(edge.id)) errors.push(`nextPrompt.visualAid: duplicate edge ID ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      errors.push(`nextPrompt.visualAid: edge ${edge.id} references an unknown node`);
    }
  }
  for (const sourceItemId of visualAid.sourceItemIds) {
    if (!validItemIds.has(sourceItemId)) {
      errors.push(`nextPrompt.visualAid: unknown source item ${sourceItemId}`);
    }
  }
  if (visualAid.sourceItemIds.length === 0) {
    errors.push("nextPrompt.visualAid: sourceItemIds must not be empty");
  }
}

function validatePrompt(
  prompt: InterviewPrompt,
  specification: Specification,
  validItemIds: ReadonlySet<string>,
  errors: string[],
): void {
  if (!exactlyOneQuestion(prompt.detailedQuestion)) {
    errors.push("nextPrompt.detailedQuestion must contain exactly one question");
  }
  if (!exactlyOneQuestion(prompt.spokenQuestion)) {
    errors.push("nextPrompt.spokenQuestion must contain exactly one question");
  }
  if (!questionsShareDecision(prompt.detailedQuestion, prompt.spokenQuestion)) {
    errors.push("nextPrompt detailed and spoken forms must ask the same decision");
  }
  const detailedConstraints = new Set(
    [...prompt.detailedQuestion.matchAll(consequentialToken)].map((match) => match[0].toLowerCase()),
  );
  const spokenAddsConstraint = [...prompt.spokenQuestion.matchAll(consequentialToken)]
    .map((match) => match[0].toLowerCase())
    .some((token) => !detailedConstraints.has(token));
  if (spokenAddsConstraint) errors.push("nextPrompt.spokenQuestion adds a constraint absent from detailedQuestion");

  if (prompt.recommendation) {
    const hasConfirmedEvidence = itemSections.some(({ key }) =>
      specification[key].some((item) => item.status === "confirmed" && item.sourceTurnIds.length > 0),
    );
    if (!hasConfirmedEvidence || prompt.confirmedContext.length === 0) {
      errors.push("nextPrompt.recommendation lacks confirmed evidence");
    }
  }
  if (prompt.visualAid) validateVisualAid(prompt.visualAid, validItemIds, errors);
}

/**
 * Enforces deterministic cross-reference and provenance rules after Zod parsing.
 * Content-level entailment is additionally constrained by the Brain prompt; this
 * validator rejects unsupported numbers and policy modals in derived items.
 */
export function validateBrainOutput(
  request: BrainRequest,
  output: BrainModelOutput,
): SemanticValidationResult {
  const errors: string[] = [];
  const validTurnIds = new Set(request.turns.map((turn) => turn.id));
  const turnsById = new Map(request.turns.map((turn) => [turn.id, turn]));
  const oldItems = itemMap(request.currentSpecification);
  const outputItems = itemMap(output.specification);
  const allIds = new Set<string>();

  for (const { key, kind, idPattern } of itemSections) {
    for (const item of output.specification[key]) {
      if (item.kind !== kind) errors.push(`${item.id}: kind does not match ${key}`);
      if (!idPattern.test(item.id)) errors.push(`${item.id}: ID does not match category ${kind}`);
      if (allIds.has(item.id)) errors.push(`${item.id}: duplicate ID`);
      allIds.add(item.id);
      if (item.sourceTurnIds.length === 0) errors.push(`${item.id}: sourceTurnIds must not be empty`);
      for (const sourceTurnId of item.sourceTurnIds) {
        if (!validTurnIds.has(sourceTurnId)) errors.push(`${item.id}: unknown source turn ${sourceTurnId}`);
      }
      if (item.status === "confirmed") {
        const hasOnlyConfirmedSources = item.sourceTurnIds.every((id) => {
          const turn = turnsById.get(id);
          return turn?.type === "confirmed_answer" || turn?.type === "correction";
        });
        if (!hasOnlyConfirmedSources) {
          errors.push(`${item.id}: confirmed items require confirmed answers or corrections`);
        }
      }
      const oldItem = oldItems.get(item.id);
      if (oldItem && (oldItem.kind !== item.kind || !retainedMeaningIsCompatible(oldItem.statement, item.statement))) {
        errors.push(`${item.id}: existing ID changed meaning or category`);
      }
      validateDerivedItem(item, turnsById, errors);
    }
  }

  const validRequirementIds = new Set([
    ...output.specification.functionalRequirements.map((item) => item.id),
    ...output.specification.nonFunctionalRequirements.map((item) => item.id),
  ]);
  for (const criterion of output.specification.acceptanceCriteria) {
    if (allIds.has(criterion.id)) errors.push(`${criterion.id}: duplicate ID`);
    allIds.add(criterion.id);
    validateAcceptanceCriterion(criterion, validRequirementIds, turnsById, errors);
  }
  for (const action of output.specification.nextActions) {
    if (allIds.has(action.id)) errors.push(`${action.id}: duplicate ID`);
    allIds.add(action.id);
    for (const sourceItemId of action.sourceItemIds) {
      if (!outputItems.has(sourceItemId)) errors.push(`${action.id}: unknown source item ${sourceItemId}`);
    }
  }

  const expectedBlockers = output.specification.blockers.map((item) => item.id);
  const expectedOpenQuestions = output.specification.openQuestions.map((item) => item.id);
  if (!setEquals(output.specification.readiness.blockerIds, expectedBlockers)) {
    errors.push("readiness.blockerIds must exactly match blockers");
  }
  if (!setEquals(output.specification.readiness.openQuestionIds, expectedOpenQuestions)) {
    errors.push("readiness.openQuestionIds must exactly match open questions");
  }
  if (output.specification.readiness.status === "ready" && expectedBlockers.length + expectedOpenQuestions.length > 0) {
    errors.push("readiness cannot be ready with unresolved blockers or open questions");
  }
  if (output.specification.readiness.status === "blocked" && expectedBlockers.length === 0) {
    errors.push("blocked readiness requires at least one blocker");
  }

  if (output.nextPrompt) {
    validatePrompt(output.nextPrompt, output.specification, new Set(outputItems.keys()), errors);
  }

  if (demoMarker.test(JSON.stringify(output))) errors.push("live output contains a Prepared Demo marker");

  return { valid: errors.length === 0, errors };
}
