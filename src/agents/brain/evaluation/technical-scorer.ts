import { v3BrainResponseSchema } from "@/domain/v3-schemas";

import { validateV3BrainOutput } from "../v3-semantic-validator";
import type { SyntheticEvaluationSession } from "./dataset";
import { buildEvaluationRequest } from "./dataset";

export interface TechnicalScore {
  schemaValid: boolean;
  semanticValid: boolean;
  firstPassValid: boolean;
  repairUsed: boolean;
  readinessCorrect: boolean;
  contradictionClassificationCorrect: boolean;
  acceptanceCriterionTestability: number;
  evidenceAuthoritySafe: boolean;
}

export function scoreTechnicalOutput(session: SyntheticEvaluationSession, response: unknown): TechnicalScore {
  const parsed = v3BrainResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      schemaValid: false,
      semanticValid: false,
      firstPassValid: false,
      repairUsed: false,
      readinessCorrect: false,
      contradictionClassificationCorrect: false,
      acceptanceCriterionTestability: 1,
      evidenceAuthoritySafe: false,
    };
  }
  const request = buildEvaluationRequest(session);
  const semantic = validateV3BrainOutput(request, parsed.data.output);
  const specification = parsed.data.output.specification;
  const unresolvedText = [...specification.blockers, ...specification.openQuestions]
    .map((item) => `${item.statement} ${item.rationale}`)
    .join(" ");
  const exposesContradiction = /contradic|conflict|incompatib/i.test(unresolvedText);
  const criteria = specification.acceptanceCriteria;
  const testableCount = criteria.filter((criterion) =>
    criterion.requirementIds.length > 0
    && criterion.sourceTurnIds.length > 0
    && (criterion.format === "given_when_then"
      ? Boolean(criterion.given && criterion.when && criterion.then && criterion.assertion === null)
      : Boolean(criterion.assertion && criterion.given === null && criterion.when === null && criterion.then === null)),
  ).length;
  const enoughCriteria = criteria.length >= session.expected.minimumAcceptanceCriteria;
  const acceptanceCriterionTestability = criteria.length === 0 ? 1
    : enoughCriteria && testableCount === criteria.length ? 5
      : testableCount === criteria.length ? 4
        : testableCount / criteria.length >= 0.75 ? 3
          : 2;
  const items = [
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
  const evidenceAuthoritySafe = items.every((item) =>
    item.externalEvidenceIds.length === 0
    || item.status === "proposed"
    || item.sourceTurnIds.some((sourceId) => request.turns.some((turn) => turn.id === sourceId && turn.type !== "deferred_prompt")),
  );
  return {
    schemaValid: true,
    semanticValid: semantic.valid,
    firstPassValid: semantic.valid && !parsed.data.provenance.repairAttempted,
    repairUsed: parsed.data.provenance.repairAttempted,
    readinessCorrect: specification.readiness.status === session.expected.readiness,
    contradictionClassificationCorrect: exposesContradiction === session.expected.contradiction,
    acceptanceCriterionTestability,
    evidenceAuthoritySafe,
  };
}

