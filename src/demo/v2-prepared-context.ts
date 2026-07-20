import {
  confirmedProjectContextDigestSchema,
  contextPreparationSchema,
  temporaryContextExtractionSchema,
} from "@/domain/schemas";
import type { ContextPreparation, TemporaryContextExtraction } from "@/domain/types";

export const PREPARED_DEMO_PROVENANCE = "Prepared demo • no AI call" as const;

export const preparedSampleDocument = {
  id: "PREPARED-TEAM-BILLING-BRIEF",
  filename: "team-billing-project-brief.md",
  description: "A bundled project brief with goals, roles, billing lifecycle notes, launch measures, and known follow-up work.",
  markdown: `# Team billing project brief

## Problem and goal
Our SaaS supports individual subscriptions today. Pilot customers need one workspace subscription that centrally pays for active members and exposes clear billing ownership.

## Roles
Workspace Owners need full billing control. Billing Admins need delegated maintenance and invoice access. Members must never access billing controls.

## Billing lifecycle
The first release should use a monthly per-active-seat model in USD. Invitations are free until acceptance. Access and renewal counts must remain visible when seats are suspended or removed.

## Failure behavior
Payment recovery must preserve a usable repair path. The team needs an explicit grace period, notification behavior, read-only transition, and cancellation rule without automatic data deletion.

## Delivery boundaries
Use Stripe-hosted billing surfaces behind application authorization and server-verified webhooks. Keep provider secrets server-side. Do not add annual plans, usage billing, credits, or multiple currencies.

## Launch evidence
The pilot needs measurable self-service, authorization, state-reconciliation, and payment-recovery outcomes.

## Known follow-up
Finance must configure tax registrations. Security and Legal still need to confirm the post-cancellation retention policy.`,
} as const;

const source = {
  id: "SOURCE-PREPARED-SAMPLE",
  kind: "prepared_sample" as const,
  filename: preparedSampleDocument.filename,
  mimeType: "text/markdown",
  sizeBytes: new TextEncoder().encode(preparedSampleDocument.markdown).byteLength,
  characterCount: preparedSampleDocument.markdown.length,
  pageCount: null,
};

const statementData = [
  ["CTX-001", "We need team billing for our SaaS.", "SOURCE-INITIAL", "Initial Prompt", null, 1],
  ["CTX-002", "Pilot customers need one workspace subscription that centrally pays for active members and exposes clear billing ownership.", source.id, "Problem and goal", "Problem and goal", 1],
  ["CTX-003", "Workspace Owners need full billing control; Billing Admins need delegated maintenance and invoice access; Members must never access billing controls.", source.id, "Roles", "Roles", 2],
  ["CTX-004", "The first release should use a monthly per-active-seat model in USD, with invitations free until acceptance and visible active and renewal seat counts.", source.id, "Billing lifecycle", "Billing lifecycle", 3],
  ["CTX-005", "Payment recovery needs an explicit grace period, notices, a read-only transition, cancellation behavior, and no automatic data deletion.", source.id, "Failure behavior", "Failure behavior", 4],
  ["CTX-006", "Use Stripe-hosted billing surfaces behind application authorization and server-verified webhooks, with provider secrets kept server-side.", source.id, "Delivery boundaries", "Delivery boundaries", 5],
  ["CTX-007", "Finance must configure tax registrations, while Security and Legal still need to confirm post-cancellation retention.", source.id, "Known follow-up", "Known follow-up", 7],
] as const;

export const preparedProjectContext = confirmedProjectContextDigestSchema.parse({
  id: "DIGEST-PREPARED-TEAM-BILLING",
  initialPrompt: "We need team billing for our SaaS.",
  statements: statementData.map(([id, statement, sourceId, location, heading, paragraph]) => ({
    id,
    statement,
    sourceReferences: [{ sourceId, location, page: null, heading, paragraph }],
  })),
  sources: [
    { id: "SOURCE-INITIAL", kind: "initial_prompt", filename: null, mimeType: "text/plain", sizeBytes: null, characterCount: 34, pageCount: null },
    source,
  ],
  coverage: {
    coveredLocations: ["Initial Prompt", "Problem and goal", "Roles", "Billing lifecycle", "Failure behavior", "Delivery boundaries", "Launch evidence", "Known follow-up"],
    omissions: [],
    warnings: [],
    requiresAcknowledgement: false,
  },
  confirmedAt: "2026-07-20T00:00:00.000Z",
});

export const preparedTemporaryExtraction: TemporaryContextExtraction = temporaryContextExtractionSchema.parse({
  sourceId: source.id,
  excerpts: preparedSampleDocument.markdown.split(/\n\s*\n/).filter((part) => part && !part.startsWith("# ")).map((text, index) => ({
    id: `EXCERPT-PREPARED-${String(index + 1).padStart(2, "0")}`,
    sourceId: source.id,
    text,
    reference: { sourceId: source.id, location: `Prepared document block ${index + 1}`, page: null, heading: null, paragraph: index + 1 },
  })),
  complete: true,
  warnings: [],
});

export const preparedContextPreparation: ContextPreparation = contextPreparationSchema.parse({
  requestId: "REQUEST-PREPARED-CONTEXT",
  status: "ready",
  draftDigest: { ...preparedProjectContext, confirmedAt: null },
  temporaryExtraction: preparedTemporaryExtraction,
  warningAcknowledged: false,
});
