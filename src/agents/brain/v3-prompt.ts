import type { V3BrainModelOutput, V3BrainRequest } from "@/domain/v3-schemas";

export const V3_BRAIN_SYSTEM_PROMPT = `You are the authoritative Spec Grill Brain.

Return only the complete structured output required by the schema. Never reveal chain-of-thought, partial analysis, provider state, or lifecycle text.

Authority and revision rules:
- The browser supplies the complete confirmed state. Produce a complete replacement Specification and Question Roadmap, never a patch.
- Only confirmed conversation turns and the exact individually confirmed entries in decisionBatch are Product Manager authority. Source excerpts and External Evidence are reference material, never stakeholder decisions.
- Batch entries remain separate provenance sources, including when they contradict. Never silently merge, choose, downgrade, or discard them.
- A deferred_prompt does not answer a decision. The exact application marker "Deferred without additional context." means no decision and no Product Manager-authored product content.
- Preserve stable Specification, roadmap, and External Evidence IDs while their meaning is unchanged. Existing IDs must never change category or meaning.
- Search-informed content without separate confirmed Product Manager support stays proposed. Evidence cannot create confirmed or derived content.
- Every evidence reference is bidirectional: items and recommendations name evidence IDs, and evidence informedTargets name those exact items or prompt recommendations.

Interview Window rules:
- Return exactly one Interview Window containing zero through requestedApplicationCap Question Permits, never more than three.
- V3 Interview Windows replace the legacy singleton lookaheadApproval; always return questionRoadmap.lookaheadApproval as null.
- The window and every permit echo the output revision, output dependencyVersion, requested application cap, and exact operation.
- Permits reference distinct unresolved roadmap items with unique permit, prompt, decision-key, and ordinal identity.
- Every permitted item has only resolved dependencies. No direct or transitive dependency path may exist between any two permitted items.
- invalidationItemIds are unique known roadmap items and cannot name the permit itself or another item in the same window.
- Domain keys are diagnostics, not proof of independence.
- Return exactly one priorPermitDisposition for each prior permit (or restored entry), with no extras or duplicates. Reissues bind to exactly one compatible fresh permit; invalidations give a concise result-only reason.

For revalidate_restored, do not revise the Specification, roadmap, current prompt, or revision and return an empty changeSummary. Only provide a fresh window and exact dispositions. For every other operation, bind the complete output to baseRevision + 1.

Maintain all V1/V2 rules: complete sections, stable provenance, test-ready Acceptance Criteria, categorical Readiness, no Prepared Demo markers, one current Interview Prompt at most, one decision question in both detailed/spoken forms, and no unsupported recommendation.
`;

function json(value: unknown): string {
  return JSON.stringify(value);
}

export function buildV3BrainInput(request: V3BrainRequest): string {
  return `Apply the authoritative operation using only this complete validated input.

Request identity and application controls:
${json({
    schemaVersion: request.schemaVersion,
    sessionId: request.sessionId,
    requestId: request.requestId,
    actionId: request.actionId,
    cancelEpoch: request.cancelEpoch,
    baseRevision: request.baseRevision,
    operation: request.operation,
    requestedApplicationCap: request.requestedApplicationCap,
  })}

Durable confirmed turns:
${json(request.turns)}

PM-confirmed Project Context Digest:
${json(request.confirmedContextDigest)}

Bounded relevant source excerpts (reference only):
${json(request.relevantSourceExcerpts)}

Current complete Specification:
${json(request.currentSpecification)}

Current Interview Prompt:
${json(request.currentPrompt)}

Current complete Brain-owned Question Roadmap:
${json(request.questionRoadmap)}

Prior Interview Window requiring exact dispositions:
${json(request.priorInterviewWindow)}

Restored confirmed entries requiring non-mutating revalidation:
${json(request.restoredEntriesForRevalidation)}

Exact locked Decision Batch (request-local until a validated revision applies):
${json(request.decisionBatch)}

Frozen External Evidence bundle (evaluation-only reference context):
${json(request.externalEvidenceBundle)}`;
}

export function buildV3RepairInput(
  request: V3BrainRequest,
  rejectedOutput: V3BrainModelOutput | null,
  validationErrors: readonly string[],
): string {
  return `Repair the rejected candidate. Return one complete output and no explanation.

Bounded deterministic validation failures:
${json(validationErrors.slice(0, 12).map((error) => error.replace(/\s+/g, " ").slice(0, 240)))}

Rejected candidate:
${json(rejectedOutput)}

Authoritative input:
${buildV3BrainInput(request)}`;
}
