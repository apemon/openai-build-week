import { interviewPromptSchema, specificationSchema } from "@/domain/schemas";
import type { InterviewPrompt, Specification, SpecificationItem } from "@/domain/types";

type SectionKey = Exclude<keyof Specification, "title" | "readiness" | "externalEvidence">;

function item(id: string, kind: SpecificationItem["kind"], statement: string, sourceTurnIds: string[], status: SpecificationItem["status"] = "confirmed"): SpecificationItem {
  return { id, kind, statement, status, sourceTurnIds, rationale: status === "confirmed" ? "Directly confirmed in the prepared walkthrough." : "Derived from confirmed prepared decisions.", externalEvidenceIds: [] };
}

const empty: Specification = {
  title: "Team billing for a SaaS workspace",
  problemStatement: [], users: [], jobsToBeDone: [], functionalRequirements: [], nonFunctionalRequirements: [], assumptions: [], risks: [], edgeCases: [], openQuestions: [], blockers: [], acceptanceCriteria: [], nextActions: [],
  readiness: { status: "draft", evidence: ["The product request has not yet covered the core billing decisions."], blockerIds: [], openQuestionIds: [] },
  externalEvidence: [],
};

function withItems(base: Specification, entries: Partial<Pick<Specification, SectionKey>>): Specification {
  const next = structuredClone(base);
  for (const [key, values] of Object.entries(entries) as [SectionKey, unknown[]][]) {
    (next[key] as unknown[]).push(...values);
  }
  return next;
}

const s1 = withItems(empty, {
  problemStatement: [item("PROB-001", "problem", "The SaaS needs team billing so a workspace can centrally pay for active members.", ["TURN-INITIAL"])],
  users: [item("USER-001", "user", "Workspace billing decision-makers and administrators.", ["TURN-INITIAL"], "proposed")],
});

const s2 = withItems(s1, {
  users: [
    item("USER-002", "user", "Workspace Owner with full billing authority.", ["TURN-PERMISSIONS"]),
    item("USER-003", "user", "Billing Admin with delegated billing maintenance access.", ["TURN-PERMISSIONS"]),
    item("USER-004", "user", "Member without billing access.", ["TURN-PERMISSIONS"]),
  ],
  jobsToBeDone: [item("JOB-001", "job", "Manage a workspace subscription without exposing billing controls to Members.", ["TURN-PERMISSIONS"], "derived")],
  functionalRequirements: [
    item("FR-001", "functional_requirement", "Owners can create billing, change the plan, assign Billing Admins, and cancel.", ["TURN-PERMISSIONS"]),
    item("FR-002", "functional_requirement", "Billing Admins can update payment and billing details and view or download invoices.", ["TURN-PERMISSIONS"]),
    item("FR-003", "functional_requirement", "Members cannot access billing controls.", ["TURN-PERMISSIONS"]),
    item("FR-004", "functional_requirement", "An Owner must transfer ownership before removal while billing is active.", ["TURN-PERMISSIONS"]),
  ],
});

const s3 = withItems(s2, { functionalRequirements: [
  item("FR-005", "functional_requirement", "Bill monthly in USD per active seat on one team plan; Owners and Billing Admins count as seats.", ["TURN-BILLING-BASIS"]),
  item("FR-006", "functional_requirement", "Do not count suspended users or unaccepted invited users as seats.", ["TURN-BILLING-BASIS"]),
], assumptions: [item("ASM-001", "assumption", "Usage, annual, volume-discount, and fixed-plan variants are outside the first release.", ["TURN-BILLING-BASIS"])], });

const s4 = withItems(s3, { functionalRequirements: [
  item("FR-007", "functional_requirement", "An accepted invite adds a prorated seat immediately; an unaccepted invite is free.", ["TURN-SEAT-CHANGES"]),
  item("FR-008", "functional_requirement", "Removal or suspension revokes access immediately and schedules the billing reduction for renewal without a mid-cycle refund.", ["TURN-SEAT-CHANGES"]),
  item("FR-009", "functional_requirement", "Show current active and scheduled renewal seat counts.", ["TURN-SEAT-CHANGES"]),
], edgeCases: [item("EDGE-001", "edge_case", "Seat access and the billed seat count can intentionally differ until renewal after a removal or suspension.", ["TURN-SEAT-CHANGES"], "derived")], });

const s5 = withItems(s4, { functionalRequirements: [
  item("FR-010", "functional_requirement", "Keep a workspace fully usable for a seven-day payment grace period while retries run and notify Owners and Billing Admins in app and by email.", ["TURN-FAILED-PAYMENT"]),
  item("FR-011", "functional_requirement", "After seven unpaid days, make the workspace read-only while keeping billing controls usable; after 30 unpaid days, cancel the subscription without automatically deleting data.", ["TURN-FAILED-PAYMENT"]),
  item("FR-012", "functional_requirement", "A successful retry clears payment-failure status and restores access automatically.", ["TURN-FAILED-PAYMENT"]),
], risks: [item("RISK-001", "risk", "An inconsistent payment state could grant access incorrectly or lock out a recovered workspace.", ["TURN-FAILED-PAYMENT"], "derived")], openQuestions: [item("OQ-001", "open_question", "The retention policy after subscription cancellation is handled separately.", ["TURN-FAILED-PAYMENT"], "unresolved")], });
s5.readiness = { status: "draft", evidence: ["Core billing decisions are still being gathered."], blockerIds: [], openQuestionIds: ["OQ-001"] };

const s6 = withItems(s5, { functionalRequirements: [
  item("FR-013", "functional_requirement", "Use Stripe Billing, Checkout, Customer Portal, and server-verified webhooks.", ["TURN-PROVIDER"]),
  item("FR-014", "functional_requirement", "Authorize in the app before creating a hosted Stripe session and keep Price IDs and webhook secrets server-only.", ["TURN-PROVIDER"]),
], assumptions: [item("ASM-002", "assumption", "Coupons, credits, multiple currencies, manual invoices, and alternative providers are excluded.", ["TURN-PROVIDER"])], });

const s7 = withItems(s6, { nonFunctionalRequirements: [
  item("NFR-001", "non_functional_requirement", "At least 90% of pilot Owners complete billing self-service without support.", ["TURN-SUCCESS"]),
  item("NFR-002", "non_functional_requirement", "No seat or subscription mismatch remains unresolved beyond 15 minutes, and 99% of Stripe-confirmed changes appear within 60 seconds.", ["TURN-SUCCESS"]),
  item("NFR-003", "non_functional_requirement", "Payment repair restores access within 60 seconds; all Member authorization tests pass; no critical billing or authorization defect remains at pilot completion.", ["TURN-SUCCESS"]),
], acceptanceCriteria: [
  { id: "AC-001", requirementIds: ["FR-003"], status: "confirmed", sourceTurnIds: ["TURN-PERMISSIONS", "TURN-SUCCESS"], format: "given_when_then", given: "a signed-in Member", when: "the Member requests any billing page or billing mutation", then: "access is denied", assertion: null },
  { id: "AC-002", requirementIds: ["FR-013"], status: "confirmed", sourceTurnIds: ["TURN-PROVIDER", "TURN-SUCCESS"], format: "measurable_assertion", given: null, when: null, then: null, assertion: "99% of Stripe-confirmed subscription changes appear in the workspace within 60 seconds." },
  { id: "AC-003", requirementIds: ["FR-012"], status: "confirmed", sourceTurnIds: ["TURN-FAILED-PAYMENT", "TURN-SUCCESS"], format: "measurable_assertion", given: null, when: null, then: null, assertion: "A repaired payment restores workspace access within 60 seconds." },
], });

const s8 = withItems(s7, { functionalRequirements: [item("FR-015", "functional_requirement", "Calculate tax automatically with Stripe Tax based on billing location.", ["TURN-TAX"])], nextActions: [
  { id: "NA-001", sourceItemIds: ["FR-015"], action: "Configure required tax registrations in Stripe Tax before launch.", intendedOutcome: "Automatic tax calculation is legally configured for every launch jurisdiction.", decisionOwnerRole: "Finance", ownership: "confirmed", status: "open" },
  { id: "NA-002", sourceItemIds: ["OQ-001"], action: "Confirm the post-cancellation data retention policy.", intendedOutcome: "The product can communicate and enforce a reviewed retention period.", decisionOwnerRole: "Security and Legal", ownership: "provisional", status: "open" },
], });
s8.readiness = { status: "ready_with_follow_ups", evidence: ["Core roles, pricing, lifecycle, provider, tax, and measurable launch behavior are confirmed.", "Finance registration and the separate retention decision remain visible follow-up work."], blockerIds: [], openQuestionIds: ["OQ-001"] };

function prompt(id: string, decisionKey: string, detailedQuestion: string, spokenQuestion: string, whyItMatters: string, answerAspects: InterviewPrompt["answerAspects"], visualAid: InterviewPrompt["visualAid"] = null): InterviewPrompt {
  return { id, decisionKey, detailedQuestion, spokenQuestion, whyItMatters, confirmedContext: [], decisionImpact: ["The answer updates the prepared Specification snapshot."], answerAspects, recommendation: null, visualAid };
}

export const teamBillingPrompts: readonly InterviewPrompt[] = [
  prompt("PROMPT-INITIAL", "initial_request", "What do you want to build, and what current pain should it solve?", "What do you want to build?", "This grounds the walkthrough in a concrete product need.", [
    { id: "ASPECT-001", label: "Product", description: "What the Product Manager wants to build.", required: true },
    { id: "ASPECT-002", label: "Current pain", description: "The current problem that team billing should solve.", required: true },
  ]),
  prompt("PROMPT-PERMISSIONS", "permissions", "Which workspace roles can view or change billing, and what must each role be allowed to do?", "Which roles can view or change billing?", "Billing permissions define the authorization boundary.", [
    { id: "ASPECT-101", label: "Roles", description: "Every workspace role that needs a billing access rule.", required: true },
    { id: "ASPECT-102", label: "Allowed actions", description: "The billing actions each authorized role may perform.", required: true },
    { id: "ASPECT-103", label: "Ownership safety", description: "The rule for removing an Owner while billing is active.", required: true },
  ], { kind: "role_map", title: "Billing roles to clarify", nodes: [{ id: "NODE-OWNER", label: "Owner", description: "Full billing authority" }, { id: "NODE-ADMIN", label: "Billing Admin", description: "Delegated billing maintenance" }, { id: "NODE-MEMBER", label: "Member", description: "No billing access" }], edges: [{ id: "EDGE-DELEGATES", from: "NODE-OWNER", to: "NODE-ADMIN", label: "assigns" }], sourceItemIds: ["PROB-001"] }),
  prompt("PROMPT-BILLING-BASIS", "billing_basis", "What is the billing unit, cadence, currency, and definition of a billable seat?", "How should a billable seat work?", "The billing basis controls pricing and counting behavior.", [
    { id: "ASPECT-201", label: "Billing unit", description: "The unit used to calculate the subscription charge.", required: true },
    { id: "ASPECT-202", label: "Cadence and currency", description: "The billing interval and supported currency.", required: true },
    { id: "ASPECT-203", label: "Billable seats", description: "Which workspace people count as paid seats.", required: true },
  ]),
  prompt("PROMPT-SEAT-CHANGES", "seat_changes", "When do invited, accepted, suspended, or removed people affect access and the invoice?", "When should seat changes affect billing?", "Seat lifecycle rules prevent invoice and access mismatches.", [
    { id: "ASPECT-301", label: "Invitation and acceptance", description: "When invited and accepted people become billable.", required: true },
    { id: "ASPECT-302", label: "Removal and suspension", description: "When access and billing change for removed or suspended people.", required: true },
    { id: "ASPECT-303", label: "Seat-count visibility", description: "Which current and scheduled counts the product should display.", required: false },
  ], { kind: "process_flow", title: "Seat lifecycle", nodes: [{ id: "NODE-INVITED", label: "Invited", description: "Not yet billable" }, { id: "NODE-ACTIVE", label: "Active", description: "Billable immediately" }, { id: "NODE-REMOVED", label: "Removed", description: "Access revoked" }], edges: [{ id: "EDGE-ACCEPT", from: "NODE-INVITED", to: "NODE-ACTIVE", label: "accept invite" }, { id: "EDGE-REMOVE", from: "NODE-ACTIVE", to: "NODE-REMOVED", label: "remove or suspend" }], sourceItemIds: ["FR-005", "FR-006"] }),
  prompt("PROMPT-FAILED-PAYMENT", "failed_payment", "What access, notice, retry, recovery, and cancellation behavior applies after payment fails?", "What happens after a payment fails?", "Payment failure behavior affects customer access and recovery.", [
    { id: "ASPECT-401", label: "Grace access", description: "Workspace access while payment retries are in progress.", required: true },
    { id: "ASPECT-402", label: "Payment notice", description: "Who receives a payment-failure notice and through which channels.", required: true },
    { id: "ASPECT-403", label: "Recovery", description: "What happens when a retry succeeds.", required: true },
    { id: "ASPECT-404", label: "Restriction and cancellation", description: "The timing and behavior of read-only access and cancellation.", required: true },
    { id: "ASPECT-405", label: "Data retention", description: "Whether failed payment may automatically delete workspace data.", required: false },
  ], { kind: "state_flow", title: "Payment states", nodes: [{ id: "NODE-PAID", label: "Paid", description: "Normal access" }, { id: "NODE-GRACE", label: "Grace", description: "Retries in progress" }, { id: "NODE-READONLY", label: "Read-only", description: "Billing remains usable" }], edges: [{ id: "EDGE-FAIL", from: "NODE-PAID", to: "NODE-GRACE", label: "payment fails" }, { id: "EDGE-LAPSE", from: "NODE-GRACE", to: "NODE-READONLY", label: "grace ends" }, { id: "EDGE-REPAIR", from: "NODE-GRACE", to: "NODE-PAID", label: "payment succeeds" }], sourceItemIds: ["FR-007", "FR-008"] }),
  prompt("PROMPT-PROVIDER", "provider", "Which billing provider surfaces should the first release use, and which integration boundaries are required?", "Which billing provider should we use?", "The provider decision shapes security and integration work.", [
    { id: "ASPECT-501", label: "Provider surfaces", description: "The billing provider products used in the first release.", required: true },
    { id: "ASPECT-502", label: "Security boundaries", description: "Authorization, webhook verification, and server-only secret rules.", required: true },
    { id: "ASPECT-503", label: "Excluded integrations", description: "Provider or billing capabilities left out of the first release.", required: false },
  ]),
  prompt("PROMPT-FIRST-RELEASE-SUCCESS", "first_release_success", "Which measurable outcomes and safeguards will prove the first release is successful?", "How will we measure first-release success?", "Measurable targets make the handoff test-ready.", [
    { id: "ASPECT-601", label: "Customer outcome", description: "A measurable self-service outcome for pilot workspace Owners.", required: true },
    { id: "ASPECT-602", label: "Billing reliability", description: "Measurable seat, subscription, and recovery timing targets.", required: true },
    { id: "ASPECT-603", label: "Launch safeguards", description: "Authorization and critical-defect release conditions.", required: true },
  ]),
  prompt("PROMPT-TAX", "tax", "How should tax be calculated, and who owns any launch configuration still required?", "How should tax work?", "Tax configuration is a launch dependency.", [
    { id: "ASPECT-701", label: "Tax calculation", description: "How the product determines and applies tax.", required: true },
    { id: "ASPECT-702", label: "Launch owner", description: "Who owns tax configuration required before launch.", required: true },
  ]),
] as const;

export const teamBillingSnapshots: readonly Specification[] = [s1, s2, s3, s4, s5, s6, s7, s8].map((snapshot) => specificationSchema.parse(snapshot));
teamBillingPrompts.forEach((value) => interviewPromptSchema.parse(value));

export function validatePreparedSnapshots(): { success: true; snapshotCount: number } {
  teamBillingSnapshots.forEach((snapshot) => specificationSchema.parse(snapshot));
  teamBillingPrompts.forEach((value) => interviewPromptSchema.parse(value));
  return { success: true, snapshotCount: teamBillingSnapshots.length };
}
