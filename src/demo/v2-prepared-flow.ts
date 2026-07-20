import {
  activeLookaheadSchema,
  decisionSummarySchema,
  questionRoadmapSchema,
} from "@/domain/schemas";
import type {
  ActiveLookahead,
  ClarificationTurn,
  DecisionSummary,
  ProcessingStage,
  QuestionRoadmap,
  RoadmapItem,
} from "@/domain/types";
import { teamBillingPrompts } from "./team-billing-snapshots";

const decisionDefinitions = teamBillingPrompts.map((prompt, index) => ({
  id: `ROADMAP-${String(index + 1).padStart(3, "0")}`,
  decisionKey: prompt.decisionKey,
  topic: ["Initial request", "Billing permissions", "Billing basis", "Seat changes", "Failed payment", "Provider boundary", "First-release success", "Tax configuration"][index]!,
  priority: index + 1,
}));

function roadmapItemsForRevision(revision: number): RoadmapItem[] {
  return decisionDefinitions.map((definition, index) => ({
    ...definition,
    status: index < revision ? "resolved" : "unresolved",
    dependencyIds: [],
    sourceItemIds: [],
    staleReason: revision >= 2 && index === 2 ? "The billing-basis decision became the authoritative current prompt after the permissions revision, so queued lookahead wording must be reviewed again." : null,
  }));
}

export const preparedLookaheadApproval = {
  roadmapItemId: "ROADMAP-003",
  prompt: teamBillingPrompts[2]!,
  approvedAtRevision: 1,
  dependencyVersion: "DEPENDENCY-PREPARED-1",
  independentOfOperation: "answer" as const,
};

function roadmapAtRevision(revision: number): QuestionRoadmap {
  const items = roadmapItemsForRevision(revision);
  const currentDecisionItemId = revision < teamBillingPrompts.length ? decisionDefinitions[revision]!.id : null;
  return questionRoadmapSchema.parse({
    id: "ROADMAP-STATE",
    baseRevision: revision,
    dependencyVersion: `DEPENDENCY-PREPARED-${revision}`,
    items,
    currentDecisionItemId,
    completedItemIds: items.filter((item) => item.status === "resolved").map((item) => item.id),
    unresolvedDependencyIds: [],
    lookaheadApproval: revision === 1 ? preparedLookaheadApproval : null,
  });
}

export const preparedQuestionRoadmaps: readonly QuestionRoadmap[] = Array.from(
  { length: teamBillingPrompts.length + 1 },
  (_, revision) => revision === 0
    ? questionRoadmapSchema.parse({ id: "ROADMAP-STATE", baseRevision: 0, dependencyVersion: "DEPENDENCY-PREPARED-0", items: [], currentDecisionItemId: null, completedItemIds: [], unresolvedDependencyIds: [], lookaheadApproval: null })
    : roadmapAtRevision(revision),
);

export const preparedClarificationTurns: readonly ClarificationTurn[] = [
  { id: "CLARIFICATION-PM-001", role: "product_manager", text: "Charge monthly per active seat in USD. Owners and Billing Admins should count as seats.", createdAt: "2026-07-20T00:00:01.000Z" },
  { id: "CLARIFICATION-COMMUNICATOR-001", role: "communicator", text: "Should suspended people or invited people who have not accepted count as active seats?", createdAt: "2026-07-20T00:00:02.000Z" },
  { id: "CLARIFICATION-PM-002", role: "product_manager", text: "No. Suspended people and unaccepted invitations should not count.", createdAt: "2026-07-20T00:00:03.000Z" },
];

export const preparedDecisionSummary: DecisionSummary = decisionSummarySchema.parse({
  id: "SUMMARY-PREPARED-BILLING-BASIS",
  roadmapItemId: preparedLookaheadApproval.roadmapItemId,
  text: "Charge monthly in USD per active seat. Workspace Owners and Billing Admins count as seats; suspended people and unaccepted invitations do not count.",
  uncertainties: ["Proration behavior is not part of this summary and remains unresolved."],
  status: "draft",
  approvedAtRevision: preparedLookaheadApproval.approvedAtRevision,
  dependencyVersion: preparedLookaheadApproval.dependencyVersion,
  confirmedAt: null,
  staleReason: null,
});

export const preparedActiveLookahead: ActiveLookahead = activeLookaheadSchema.parse({
  approval: preparedLookaheadApproval,
  status: "summary_draft",
  clarificationTurns: preparedClarificationTurns,
  decisionSummary: preparedDecisionSummary,
});

export const preparedQueuedDecisionSummary: DecisionSummary = decisionSummarySchema.parse({
  ...preparedDecisionSummary,
  status: "confirmed_queued",
  confirmedAt: "2026-07-20T00:00:04.000Z",
});

export const PREPARED_STALE_REASON = "The permissions revision made billing basis the authoritative current decision, so the queued lookahead approval no longer matches the latest dependency state.";

export const preparedStaleDecisionSummary: DecisionSummary = decisionSummarySchema.parse({
  ...preparedQueuedDecisionSummary,
  status: "not_applied",
  staleReason: PREPARED_STALE_REASON,
});

export const preparedProcessingStages: readonly Exclude<ProcessingStage, "idle">[] = [
  "validating_confirmed_input",
  "reviewing_contradictions",
  "reviewing_dependencies",
  "revising_specification",
  "planning_next_question",
];

export async function runPreparedProgress(
  onStage: (stage: Exclude<ProcessingStage, "idle">) => void,
  delayMs = 180,
  wait: (delay: number) => Promise<void> = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
): Promise<void> {
  for (const stage of preparedProcessingStages) {
    onStage(stage);
    await wait(delayMs);
  }
}
