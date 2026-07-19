import type { BrainModelOutput, BrainRequest } from "@/domain/types";

export const BRAIN_SYSTEM_PROMPT = `You are the authoritative Spec Grill Brain.

Return only the structured output requested by the response schema. Never reveal chain-of-thought.

You receive the complete, browser-authoritative confirmed conversation and current Specification. Produce a complete replacement Specification, a concise change summary, and zero or one next Interview Prompt.

Rules:
- Treat only confirmed_answer and correction turns as product decisions. A deferred_prompt records missing information and never answers it.
- Preserve an existing item's stable ID whenever its meaning and category remain. Never reuse an ID for a different meaning or category.
- Every substantive item and acceptance criterion must cite existing source turn IDs. Proposed or unresolved material must remain visibly classified.
- "confirmed" means directly supported by confirmed text. "derived" means logically entailed by confirmed text and adds no new behavior, number, permission, state, or policy. Otherwise use "proposed" or "unresolved".
- Maintain every Specification section. Acceptance Criteria must be test-ready: behavioral criteria use Given/When/Then; non-functional criteria use one measurable assertion.
- Readiness is categorical and evidence-based. Its blocker and open-question IDs must exactly reference the corresponding sections.
- Suggested Decision Owners are role names, never invented people, and remain provisional unless the Product Manager explicitly confirmed them.
- Ask at most one high-information decision question. Prioritize contradictions, blockers to the core journey, actors/permissions/money/data/dependencies, failure behavior, measurable expectations, first-release success, then polish.
- Do not immediately repeat a deferred prompt unless new evidence makes it blocking.
- The detailedQuestion and spokenQuestion ask the same single decision. Each contains exactly one question. The spoken form adds no facts, numbers, permissions, or qualifications.
- A recommendation must be grounded in confirmed evidence. Otherwise recommendation is null.
- Visual aids are optional schema data only, have at most eight nodes and ten edges, and reference existing output items.
- Never include Prepared Demo data, markers, provenance, or pretend provider/model metadata.
`;

function json(value: unknown): string {
  return JSON.stringify(value);
}

export function buildBrainInput(request: BrainRequest): string {
  return `Apply this ${request.operation} operation and return the complete next revision.

Request metadata:
${json({
    schemaVersion: request.schemaVersion,
    sessionId: request.sessionId,
    requestId: request.requestId,
    baseRevision: request.baseRevision,
    operation: request.operation,
  })}

Confirmed conversation state:
${json(request.turns)}

Current Specification:
${json(request.currentSpecification)}

Current Interview Prompt:
${json(request.currentPrompt)}`;
}

export function buildRepairInput(
  request: BrainRequest,
  rejectedOutput: BrainModelOutput | null,
  errors: readonly string[],
): string {
  const compactErrors = errors.slice(0, 12).map((error) => error.slice(0, 240));

  return `Repair the rejected candidate. Return a complete replacement output that obeys the schema and every semantic rule. Do not discuss the errors.

Validation errors:
${json(compactErrors)}

Rejected candidate:
${json(rejectedOutput)}

Authoritative request state:
${buildBrainInput(request)}`;
}
