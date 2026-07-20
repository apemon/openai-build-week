import { createHash } from "node:crypto";

import { z } from "zod";

import { createEmptyQuestionRoadmap, createInitialContextDigest, emptySpecification } from "@/domain/initial-state";
import { frozenExternalEvidenceSchema, v3BrainRequestSchema } from "@/domain/v3-schemas";
import type { V3BrainRequest } from "@/domain/v3-schemas";

import rawSessions from "./fixtures/synthetic-sessions.json";

const categorySchema = z.enum([
  "contradiction",
  "correction",
  "deferral",
  "provenance",
  "stable_ids",
  "roadmap_dag",
  "permit_revalidation",
  "readiness",
  "risk_edge_case",
  "acceptance_criteria",
  "external_evidence",
  "failure_race",
  "permit_quality",
]);

export const syntheticEvaluationSessionSchema = z.object({
  id: z.string().regex(/^EVAL-[0-9]{3}$/),
  title: z.string().min(1).max(200),
  category: categorySchema,
  initialPrompt: z.string().min(1).max(4_000),
  confirmedDecisions: z.array(z.string().min(1).max(4_000)).min(1).max(6),
  expected: z.object({
    contradiction: z.boolean(),
    readiness: z.enum(["draft", "blocked", "ready_with_follow_ups", "ready"]),
    minimumAcceptanceCriteria: z.number().int().min(1).max(20),
  }).strict(),
  evidence: frozenExternalEvidenceSchema.optional(),
}).strict();

export type SyntheticEvaluationSession = z.infer<typeof syntheticEvaluationSessionSchema>;

export const syntheticEvaluationSessions = z.array(syntheticEvaluationSessionSchema).min(24).parse(rawSessions);

export function buildEvaluationRequest(session: SyntheticEvaluationSession): V3BrainRequest {
  const now = "2026-07-21T00:00:00.000Z";
  return v3BrainRequestSchema.parse({
    schemaVersion: 1,
    sessionId: `SESSION-${session.id.replace("EVAL-", "")}`,
    mode: "live",
    requestId: `REQUEST-${session.id.replace("EVAL-", "")}`,
    baseRevision: 0,
    operation: session.category === "correction" ? "correct" : session.category === "deferral" ? "defer" : "answer",
    turns: session.confirmedDecisions.map((text, index) => ({
      id: `TURN-${session.id.replace("EVAL-", "")}-${String(index + 1).padStart(3, "0")}`,
      promptId: "PROMPT-INITIAL",
      type: index === session.confirmedDecisions.length - 1 && session.category === "correction"
        ? "correction"
        : index === session.confirmedDecisions.length - 1 && session.category === "deferral"
          ? "deferred_prompt"
          : "confirmed_answer",
      text,
      createdAt: now,
    })),
    confirmedContextDigest: {
      ...createInitialContextDigest(new Date(now)),
      initialPrompt: session.initialPrompt,
    },
    questionRoadmap: createEmptyQuestionRoadmap(0),
    relevantSourceExcerpts: [],
    currentSpecification: { ...emptySpecification, externalEvidence: [] },
    currentPrompt: null,
    actionId: `ACTION-${session.id.replace("EVAL-", "")}`,
    cancelEpoch: 0,
    requestedApplicationCap: 3,
    priorInterviewWindow: null,
    restoredEntriesForRevalidation: [],
    decisionBatch: null,
    externalEvidenceBundle: session.evidence ? [session.evidence] : [],
  });
}

export function evaluationDatasetHash(): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(syntheticEvaluationSessions)).digest("hex")}`;
}
