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
import {
  validateConfirmedProjectContextDigest,
  validateQuestionRoadmap,
} from "@/domain/v2-invariants";

export interface SemanticValidationResult {
  valid: boolean;
  errors: string[];
}

export const MAX_RELEVANT_SOURCE_EXCERPTS = 6;
export const MAX_RELEVANT_SOURCE_EXCERPT_CHARACTERS = 24_000;

type ItemSection = Exclude<
  keyof Specification,
  "title" | "acceptanceCriteria" | "nextActions" | "readiness" | "externalEvidence"
>;

const itemSections: Array<{
  key: ItemSection;
  kind: SpecificationItem["kind"];
  idPattern: RegExp;
  idPrefix: string;
}> = [
  { key: "problemStatement", kind: "problem", idPattern: /^PROB-[0-9]{3,}$/, idPrefix: "PROB-" },
  { key: "users", kind: "user", idPattern: /^USER-[0-9]{3,}$/, idPrefix: "USER-" },
  { key: "jobsToBeDone", kind: "job", idPattern: /^JOB-[0-9]{3,}$/, idPrefix: "JOB-" },
  { key: "functionalRequirements", kind: "functional_requirement", idPattern: /^FR-[0-9]{3,}$/, idPrefix: "FR-" },
  { key: "nonFunctionalRequirements", kind: "non_functional_requirement", idPattern: /^NFR-[0-9]{3,}$/, idPrefix: "NFR-" },
  { key: "assumptions", kind: "assumption", idPattern: /^ASM-[0-9]{3,}$/, idPrefix: "ASM-" },
  { key: "risks", kind: "risk", idPattern: /^RISK-[0-9]{3,}$/, idPrefix: "RISK-" },
  { key: "edgeCases", kind: "edge_case", idPattern: /^EDGE-[0-9]{3,}$/, idPrefix: "EDGE-" },
  { key: "openQuestions", kind: "open_question", idPattern: /^OQ-[0-9]{3,}$/, idPrefix: "OQ-" },
  { key: "blockers", kind: "blocker", idPattern: /^BLK-[0-9]{3,}$/, idPrefix: "BLK-" },
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

const authoritativeTurnTypes = new Set<ConversationTurn["type"]>([
  "confirmed_answer",
  "confirmed_decision_summary",
  "correction",
]);

interface ProvenanceSource {
  text: string;
  authoritative: boolean;
}

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

function textIsGrounded(candidate: string, sources: readonly string[]): boolean {
  const candidateWords = normalizedMeaningWords(candidate);
  if (candidateWords.size === 0) return false;

  return sources.some((source) => {
    const sourceWords = normalizedMeaningWords(source);
    if (sourceWords.size === 0) return false;
    let overlap = 0;
    for (const word of candidateWords) if (sourceWords.has(word)) overlap += 1;
    return overlap / Math.min(candidateWords.size, sourceWords.size) >= 0.35;
  });
}

function exactlyOneQuestion(text: string): boolean {
  return (text.match(/\?/g) ?? []).length === 1;
}

function questionsShareDecision(detailed: string, spoken: string): boolean {
  const detailedWords = normalizedMeaningWords(detailed);
  const spokenWords = normalizedMeaningWords(spoken);
  return [...spokenWords].some((word) => detailedWords.has(word));
}

const answerAspectScopeStopWords = new Set([
  ...insignificantWords,
  "answer",
  "aspect",
  "current",
  "decision",
  "detail",
  "details",
  "information",
  "manager",
  "optional",
  "product",
  "provide",
  "required",
  "specific",
]);

function answerAspectWords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !answerAspectScopeStopWords.has(word)),
  );
}

/** Enforces the Brain-owned aspect boundary even when a caller bypasses Zod.
 * Decision scope is intentionally limited to the prompt itself plus an optional
 * matching roadmap topic; confirmed context cannot silently broaden it. */
export function validatePromptAnswerAspects(
  prompt: InterviewPrompt,
  path: string,
  additionalDecisionScope: readonly string[] = [],
): string[] {
  const errors: string[] = [];
  const candidate = (prompt as unknown as { answerAspects?: unknown }).answerAspects;
  if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > 5) {
    errors.push(`${path}.answerAspects must contain one to five Answer Aspects`);
    if (!Array.isArray(candidate)) return errors;
  }

  const ids = new Set<string>();
  const labels = new Set<string>();
  const meanings = new Set<string>();
  let hasRequired = false;
  const decisionWords = answerAspectWords([
    prompt.decisionKey,
    prompt.detailedQuestion,
    prompt.spokenQuestion,
    prompt.whyItMatters,
    ...prompt.decisionImpact,
    ...additionalDecisionScope,
  ].join(" "));

  for (const [index, rawAspect] of candidate.entries()) {
    if (!rawAspect || typeof rawAspect !== "object") {
      errors.push(`${path}.answerAspects[${index}] is invalid`);
      continue;
    }
    const aspect = rawAspect as { id?: unknown; label?: unknown; description?: unknown; required?: unknown };
    const id = typeof aspect.id === "string" ? aspect.id : "";
    const label = typeof aspect.label === "string" ? aspect.label : "";
    const description = typeof aspect.description === "string" ? aspect.description : "";
    if (!/^ASPECT-[0-9]{3,}$/.test(id)) {
      errors.push(`${path}.answerAspects[${index}].id must match /^ASPECT-[0-9]{3,}$/`);
    } else if (ids.has(id)) {
      errors.push(`${path}.answerAspects contains duplicate Answer Aspect ID ${id}`);
    }
    ids.add(id);
    const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const meaning = `${label} ${description}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if ((normalizedLabel && labels.has(normalizedLabel)) || (meaning && meanings.has(meaning))) {
      errors.push(`${path}.answerAspects must have unique, non-overlapping meanings`);
    }
    if (normalizedLabel) labels.add(normalizedLabel);
    if (meaning) meanings.add(meaning);
    if (aspect.required === true) hasRequired = true;

    const scopedWords = answerAspectWords(`${label} ${description}`);
    if (scopedWords.size === 0 || ![...scopedWords].some((word) => decisionWords.has(word))) {
      errors.push(`${path}.answerAspects[${index}] is outside the current decision scope`);
    }
  }
  if (!hasRequired) errors.push(`${path}.answerAspects requires at least one required aspect`);
  return errors;
}

export function validateAnswerAspectIdOwnership(prompts: readonly InterviewPrompt[]): string[] {
  const errors: string[] = [];
  const owners = new Map<string, string>();
  for (const prompt of prompts) {
    const aspects = (prompt as unknown as { answerAspects?: unknown }).answerAspects;
    if (!Array.isArray(aspects)) continue;
    for (const aspect of aspects) {
      if (!aspect || typeof aspect !== "object") continue;
      const id = (aspect as { id?: unknown }).id;
      if (typeof id !== "string") continue;
      const owner = owners.get(id);
      if (owner && owner !== prompt.id) {
        errors.push(`${id}: Answer Aspect ID cannot be reused across prompt decisions`);
      } else {
        owners.set(id, prompt.id);
      }
    }
  }
  return errors;
}

function setEquals(actual: readonly string[], expected: readonly string[]): boolean {
  const left = new Set(actual);
  const right = new Set(expected);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateDerivedItem(
  item: SpecificationItem,
  sourcesById: ReadonlyMap<string, ProvenanceSource>,
  errors: string[],
): void {
  if (item.status !== "derived") return;
  if (item.sourceTurnIds.length === 0) {
    errors.push(`${item.id}: derived items require confirmed source turns`);
    return;
  }

  const sourceText = item.sourceTurnIds
    .map((id) => sourcesById.get(id))
    .filter((source): source is ProvenanceSource => source?.authoritative === true)
    .map((source) => source.text)
    .join(" ")
    .toLowerCase();

  const hasOnlyConfirmedSources = item.sourceTurnIds.every((id) => {
    return sourcesById.get(id)?.authoritative === true;
  });
  if (!hasOnlyConfirmedSources) {
    errors.push(`${item.id}: derived items may cite only confirmed digest statements or confirmed turns`);
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
  sourcesById: ReadonlyMap<string, ProvenanceSource>,
  errors: string[],
): void {
  for (const requirementId of criterion.requirementIds) {
    if (!validRequirementIds.has(requirementId)) {
      errors.push(`${criterion.id}: unknown requirement reference ${requirementId}`);
    }
  }
  for (const sourceTurnId of criterion.sourceTurnIds) {
    if (!sourcesById.has(sourceTurnId)) errors.push(`${criterion.id}: unknown source turn ${sourceTurnId}`);
  }
  if (criterion.sourceTurnIds.length === 0) errors.push(`${criterion.id}: sourceTurnIds must not be empty`);
  if (criterion.status === "confirmed" || criterion.status === "derived") {
    const hasOnlyConfirmedSources = criterion.sourceTurnIds.every((id) => {
      return sourcesById.get(id)?.authoritative === true;
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
  confirmedEvidence: readonly string[],
  path: "nextPrompt" | "questionRoadmap.lookaheadApproval.prompt",
  errors: string[],
): void {
  errors.push(...validatePromptAnswerAspects(prompt, path));
  if (!exactlyOneQuestion(prompt.detailedQuestion)) {
    errors.push(`${path}.detailedQuestion must contain exactly one question`);
  }
  if (!exactlyOneQuestion(prompt.spokenQuestion)) {
    errors.push(`${path}.spokenQuestion must contain exactly one question`);
  }
  if (!questionsShareDecision(prompt.detailedQuestion, prompt.spokenQuestion)) {
    errors.push(`${path} detailed and spoken forms must ask the same decision`);
  }
  const detailedConstraints = new Set(
    [...prompt.detailedQuestion.matchAll(consequentialToken)].map((match) => match[0].toLowerCase()),
  );
  const spokenAddsConstraint = [...prompt.spokenQuestion.matchAll(consequentialToken)]
    .map((match) => match[0].toLowerCase())
    .some((token) => !detailedConstraints.has(token));
  if (spokenAddsConstraint) errors.push(`${path}.spokenQuestion adds a constraint absent from detailedQuestion`);

  for (const context of prompt.confirmedContext) {
    if (!textIsGrounded(context, confirmedEvidence)) {
      errors.push(`${path}.confirmedContext is not grounded in confirmed input`);
    }
  }

  if (prompt.recommendation) {
    const hasConfirmedEvidence = itemSections.some(({ key }) =>
      specification[key].some((item) => item.status === "confirmed" && item.sourceTurnIds.length > 0),
    );
    if (!hasConfirmedEvidence || prompt.confirmedContext.length === 0) {
      errors.push(`${path}.recommendation lacks confirmed evidence`);
    }
  }
  if (prompt.visualAid) validateVisualAid(prompt.visualAid, validItemIds, errors);
}

function specificationIsEmpty(specification: Specification): boolean {
  return (
    itemSections.every(({ key }) => specification[key].length === 0) &&
    specification.acceptanceCriteria.length === 0 &&
    specification.nextActions.length === 0
  );
}

function expectedLatestTurnType(operation: BrainRequest["operation"]): ConversationTurn["type"] | null {
  switch (operation) {
    case "answer":
      return "confirmed_answer";
    case "correct":
      return "correction";
    case "defer":
      return "deferred_prompt";
    case "decision_summary":
      return "confirmed_decision_summary";
    case "initialize":
    case "resume":
    case "decision_batch":
    case "revalidate_restored":
      return null;
  }
}

/** Validates approval, provenance, and context-budget rules before any provider call. */
export function validateBrainRequest(request: BrainRequest): SemanticValidationResult {
  const errors: string[] = [];
  const digest = validateConfirmedProjectContextDigest(request.confirmedContextDigest);
  errors.push(...digest.errors.map((error) => `confirmedContextDigest: ${error}`));

  const preparedSources = request.confirmedContextDigest.sources.filter((source) => source.kind === "prepared_sample");
  if (preparedSources.length > 0) errors.push("confirmedContextDigest: Prepared Demo sources are forbidden in Live Mode");

  const requestRoadmap = validateQuestionRoadmap(request.questionRoadmap);
  errors.push(...requestRoadmap.errors.map((error) => `questionRoadmap: ${error}`));
  if (request.questionRoadmap.baseRevision !== request.baseRevision) {
    errors.push("questionRoadmap.baseRevision must match the request baseRevision");
  }

  if (request.relevantSourceExcerpts.length > MAX_RELEVANT_SOURCE_EXCERPTS) {
    errors.push(`relevantSourceExcerpts must contain at most ${MAX_RELEVANT_SOURCE_EXCERPTS} excerpts`);
  }
  const excerptCharacters = request.relevantSourceExcerpts.reduce((total, excerpt) => total + excerpt.text.length, 0);
  if (excerptCharacters > MAX_RELEVANT_SOURCE_EXCERPT_CHARACTERS) {
    errors.push(`relevantSourceExcerpts exceed the ${MAX_RELEVANT_SOURCE_EXCERPT_CHARACTERS} character budget`);
  }
  const sourceIds = new Set(request.confirmedContextDigest.sources.map((source) => source.id));
  const excerptIds = new Set<string>();
  for (const excerpt of request.relevantSourceExcerpts) {
    if (excerptIds.has(excerpt.id)) errors.push(`${excerpt.id}: duplicate relevant source excerpt ID`);
    excerptIds.add(excerpt.id);
    if (!sourceIds.has(excerpt.sourceId)) errors.push(`${excerpt.id}: excerpt references an unknown digest source`);
    if (excerpt.reference.sourceId !== excerpt.sourceId) {
      errors.push(`${excerpt.id}: excerpt source and source reference do not match`);
    }
  }

  const turnIds = new Set<string>();
  const digestStatementIds = new Set(request.confirmedContextDigest.statements.map((statement) => statement.id));
  for (const turn of request.turns) {
    if (turnIds.has(turn.id)) errors.push(`${turn.id}: duplicate conversation turn ID`);
    if (digestStatementIds.has(turn.id)) errors.push(`${turn.id}: turn ID collides with digest provenance`);
    turnIds.add(turn.id);
  }

  const requestSources = new Map<string, ProvenanceSource>([
    ...request.turns.map((turn) => [
      turn.id,
      { text: turn.text, authoritative: authoritativeTurnTypes.has(turn.type) },
    ] as const),
    ...request.confirmedContextDigest.statements.map((statement) => [
      statement.id,
      { text: statement.statement, authoritative: true },
    ] as const),
  ]);
  const currentItems = itemMap(request.currentSpecification);
  for (const { key } of itemSections) {
    for (const item of request.currentSpecification[key]) {
      for (const sourceId of item.sourceTurnIds) {
        if (!requestSources.has(sourceId)) errors.push(`${item.id}: current Specification has unknown provenance ${sourceId}`);
      }
      if ((item.status === "confirmed" || item.status === "derived") &&
        !item.sourceTurnIds.every((sourceId) => requestSources.get(sourceId)?.authoritative === true)) {
        errors.push(`${item.id}: current ${item.status} item cites non-authoritative input`);
      }
    }
  }
  for (const criterion of request.currentSpecification.acceptanceCriteria) {
    for (const sourceId of criterion.sourceTurnIds) {
      if (!requestSources.has(sourceId)) errors.push(`${criterion.id}: current criterion has unknown provenance ${sourceId}`);
    }
    if ((criterion.status === "confirmed" || criterion.status === "derived") &&
      !criterion.sourceTurnIds.every((sourceId) => requestSources.get(sourceId)?.authoritative === true)) {
      errors.push(`${criterion.id}: current ${criterion.status} criterion cites non-authoritative input`);
    }
  }
  for (const item of request.questionRoadmap.items) {
    for (const sourceItemId of item.sourceItemIds) {
      if (!currentItems.has(sourceItemId)) errors.push(`${item.id}: current roadmap has unknown Specification source ${sourceItemId}`);
    }
  }
  const currentRoadmapItem = request.questionRoadmap.currentDecisionItemId
    ? request.questionRoadmap.items.find((item) => item.id === request.questionRoadmap.currentDecisionItemId)
    : null;
  if (currentRoadmapItem && request.currentPrompt?.decisionKey !== currentRoadmapItem.decisionKey) {
    errors.push("currentPrompt decisionKey must match the current Question Roadmap item");
  }
  if (demoMarker.test(JSON.stringify({
    specification: request.currentSpecification,
    roadmap: request.questionRoadmap,
  }))) {
    errors.push("Live request contains a Prepared Demo marker");
  }

  const expectedType = expectedLatestTurnType(request.operation);
  const latestTurn = request.turns.at(-1);
  if (expectedType && latestTurn?.type !== expectedType) {
    errors.push(`${request.operation} requires the latest turn to be ${expectedType}`);
  }
  if (request.operation === "initialize") {
    if (request.baseRevision !== 0) errors.push("initialize requires baseRevision 0");
    if (!specificationIsEmpty(request.currentSpecification)) {
      errors.push("initialize requires an empty current Specification");
    }
    if (request.questionRoadmap.items.length > 0) errors.push("initialize requires an empty Question Roadmap");
    if (request.turns.some((turn) => !authoritativeTurnTypes.has(turn.type))) {
      errors.push("initialize may contain only PM-confirmed input");
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateRoadmapOutput(
  request: BrainRequest,
  output: BrainModelOutput,
  validItemIds: ReadonlySet<string>,
  confirmedEvidence: readonly string[],
  errors: string[],
): void {
  const roadmap = output.questionRoadmap;
  const validation = validateQuestionRoadmap(roadmap);
  errors.push(...validation.errors.map((error) => `questionRoadmap: ${error}`));

  const nextRevision = request.baseRevision + 1;
  if (roadmap.baseRevision !== nextRevision) {
    errors.push("questionRoadmap.baseRevision must match the complete output revision");
  }
  if (roadmap.id !== request.questionRoadmap.id) errors.push("questionRoadmap must preserve its stable ID");

  const outputById = new Map(roadmap.items.map((item) => [item.id, item] as const));
  const outputByDecisionKey = new Map(roadmap.items.map((item) => [item.decisionKey, item] as const));
  for (const oldItem of request.questionRoadmap.items) {
    const retained = outputById.get(oldItem.id);
    if (!retained) {
      errors.push(`${oldItem.id}: roadmap items must be retained across revisions`);
      if (outputByDecisionKey.has(oldItem.decisionKey)) {
        errors.push(`${oldItem.decisionKey}: unchanged roadmap meaning received a new stable ID`);
      }
      continue;
    }
    if (
      retained.decisionKey !== oldItem.decisionKey ||
      !retainedMeaningIsCompatible(oldItem.topic, retained.topic)
    ) {
      errors.push(`${oldItem.id}: existing roadmap ID changed meaning`);
    }
  }

  const decisionKeys = new Set<string>();
  const priorities = new Set<number>();
  for (const item of roadmap.items) {
    if (decisionKeys.has(item.decisionKey)) errors.push(`${item.decisionKey}: duplicate roadmap decision key`);
    decisionKeys.add(item.decisionKey);
    if (item.status !== "resolved") {
      if (priorities.has(item.priority)) errors.push(`${item.priority}: duplicate unresolved roadmap priority`);
      priorities.add(item.priority);
    }
    for (const sourceItemId of item.sourceItemIds) {
      if (!validItemIds.has(sourceItemId)) errors.push(`${item.id}: unknown Specification source item ${sourceItemId}`);
    }
  }

  const resolvedIds = roadmap.items.filter((item) => item.status === "resolved").map((item) => item.id);
  if (!setEquals(roadmap.completedItemIds, resolvedIds)) {
    errors.push("questionRoadmap.completedItemIds must exactly match resolved roadmap items");
  }
  const unresolvedDependencyIds = new Set(
    roadmap.items.flatMap((item) =>
      item.dependencyIds.filter((dependencyId) => outputById.get(dependencyId)?.status !== "resolved"),
    ),
  );
  if (!setEquals(roadmap.unresolvedDependencyIds, [...unresolvedDependencyIds])) {
    errors.push("questionRoadmap.unresolvedDependencyIds must exactly match unresolved dependencies");
  }

  if (output.nextPrompt) {
    const currentItem = roadmap.currentDecisionItemId
      ? outputById.get(roadmap.currentDecisionItemId)
      : undefined;
    if (!currentItem) errors.push("nextPrompt requires a current Question Roadmap item");
    else {
      if (currentItem.status === "resolved") errors.push("nextPrompt cannot reference resolved roadmap work");
      if (currentItem.decisionKey !== output.nextPrompt.decisionKey) {
        errors.push("nextPrompt decisionKey must match the current Question Roadmap item");
      }
    }
  } else if (roadmap.currentDecisionItemId !== null) {
    errors.push("questionRoadmap.currentDecisionItemId must be null when there is no nextPrompt");
  }

  const approval = roadmap.lookaheadApproval;
  if (approval) {
    const approvedItem = outputById.get(approval.roadmapItemId);
    if (approvedItem?.decisionKey !== approval.prompt.decisionKey) {
      errors.push("Lookahead prompt decisionKey must match its Question Roadmap item");
    }
    if (approval.roadmapItemId === roadmap.currentDecisionItemId) {
      errors.push("Lookahead approval must be independent of the current decision");
    }
    if (output.nextPrompt?.id === approval.prompt.id) {
      errors.push("Lookahead and current prompts must have distinct stable IDs");
    }
    validatePrompt(
      approval.prompt,
      output.specification,
      validItemIds,
      confirmedEvidence,
      "questionRoadmap.lookaheadApproval.prompt",
      errors,
    );
  }

  const previousApproval = request.questionRoadmap.lookaheadApproval;
  if (previousApproval && approval?.roadmapItemId !== previousApproval.roadmapItemId) {
    const staleItem = outputById.get(previousApproval.roadmapItemId);
    if (!staleItem?.staleReason) {
      errors.push(`${previousApproval.roadmapItemId}: invalidated Lookahead work requires a stale reason`);
    }
  }
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
  const sourcesById = new Map<string, ProvenanceSource>([
    ...request.turns.map((turn) => [
      turn.id,
      { text: turn.text, authoritative: authoritativeTurnTypes.has(turn.type) },
    ] as const),
    ...request.confirmedContextDigest.statements.map((statement) => [
      statement.id,
      { text: statement.statement, authoritative: true },
    ] as const),
  ]);
  const validSourceIds = new Set(sourcesById.keys());
  const oldItems = itemMap(request.currentSpecification);
  const outputItems = itemMap(output.specification);
  const allIds = new Set<string>();
  const confirmedEvidence = [
    request.confirmedContextDigest.initialPrompt,
    ...request.confirmedContextDigest.statements.map((statement) => statement.statement),
    ...request.turns.filter((turn) => authoritativeTurnTypes.has(turn.type)).map((turn) => turn.text),
    ...[...outputItems.values()].filter((item) => item.status === "confirmed").map((item) => item.statement),
  ];

  for (const { key, kind, idPattern, idPrefix } of itemSections) {
    for (const item of output.specification[key]) {
      if (item.kind !== kind) errors.push(`${item.id}: kind does not match ${key}`);
      if (!idPattern.test(item.id)) {
        errors.push(`${key} item ID must match ${idPattern} (required prefix ${idPrefix}) for category ${kind}`);
      }
      if (allIds.has(item.id)) errors.push(`${item.id}: duplicate ID`);
      allIds.add(item.id);
      if (item.sourceTurnIds.length === 0) errors.push(`${item.id}: sourceTurnIds must not be empty`);
      for (const sourceTurnId of item.sourceTurnIds) {
        if (!validSourceIds.has(sourceTurnId)) errors.push(`${item.id}: unknown source turn ${sourceTurnId}`);
      }
      if (item.status === "confirmed") {
        const hasOnlyConfirmedSources = item.sourceTurnIds.every(
          (id) => sourcesById.get(id)?.authoritative === true,
        );
        if (!hasOnlyConfirmedSources) {
          errors.push(`${item.id}: confirmed items require confirmed digest statements or confirmed turns`);
        }
      }
      const oldItem = oldItems.get(item.id);
      if (oldItem && (oldItem.kind !== item.kind || !retainedMeaningIsCompatible(oldItem.statement, item.statement))) {
        errors.push(`${item.id}: existing ID changed meaning or category`);
      }
      validateDerivedItem(item, sourcesById, errors);
    }
  }

  const validRequirementIds = new Set([
    ...output.specification.functionalRequirements.map((item) => item.id),
    ...output.specification.nonFunctionalRequirements.map((item) => item.id),
  ]);
  for (const criterion of output.specification.acceptanceCriteria) {
    if (allIds.has(criterion.id)) errors.push(`${criterion.id}: duplicate ID`);
    allIds.add(criterion.id);
    validateAcceptanceCriterion(criterion, validRequirementIds, sourcesById, errors);
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
    validatePrompt(
      output.nextPrompt,
      output.specification,
      new Set(outputItems.keys()),
      confirmedEvidence,
      "nextPrompt",
      errors,
    );
  }

  validateRoadmapOutput(request, output, new Set(outputItems.keys()), confirmedEvidence, errors);
  errors.push(...validateAnswerAspectIdOwnership([
    ...(output.nextPrompt ? [output.nextPrompt] : []),
    ...(output.questionRoadmap.lookaheadApproval ? [output.questionRoadmap.lookaheadApproval.prompt] : []),
  ]));

  if (demoMarker.test(JSON.stringify(output))) errors.push("live output contains a Prepared Demo marker");

  return { valid: errors.length === 0, errors };
}
