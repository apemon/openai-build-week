import { expect, test, type Route } from "@playwright/test";

import { teamBillingPrompts, teamBillingSnapshots } from "@/demo/team-billing-snapshots";
import type { QuestionRoadmap } from "@/domain/types";
import type { V3BrainRequest } from "@/domain/v3-schemas";
import { brainResponse, brainStreamBody, createTypedDraft, expectNoSeriousAxeViolations, startLiveText } from "./helpers";

function roadmapWithLookahead(revision: number): QuestionRoadmap {
  return {
    id: "ROADMAP-STATE",
    baseRevision: revision,
    dependencyVersion: `DEPENDENCY-${revision}`,
    items: [
      { id: "ROADMAP-002", decisionKey: "permissions", topic: "Billing permissions", status: "unresolved", priority: 1, dependencyIds: [], sourceItemIds: [], staleReason: null },
      { id: "ROADMAP-003", decisionKey: "billing_basis", topic: "Billing basis", status: "unresolved", priority: 2, dependencyIds: [], sourceItemIds: [], staleReason: null },
    ],
    currentDecisionItemId: "ROADMAP-002",
    completedItemIds: [],
    unresolvedDependencyIds: [],
    lookaheadApproval: {
      roadmapItemId: "ROADMAP-003",
      prompt: teamBillingPrompts[2]!,
      approvedAtRevision: revision,
      dependencyVersion: `DEPENDENCY-${revision}`,
      independentOfOperation: "answer",
    },
  };
}

function staleRoadmap(revision: number): QuestionRoadmap {
  return {
    ...roadmapWithLookahead(revision),
    dependencyVersion: `DEPENDENCY-${revision}`,
    currentDecisionItemId: "ROADMAP-003",
    items: roadmapWithLookahead(revision).items.map((item) => item.id === "ROADMAP-003"
      ? { ...item, staleReason: "Billing basis now depends on the authoritative permissions revision." }
      : item),
    lookaheadApproval: null,
  };
}

test("deduplicates confirmation and quarantines a clarified summary after dependency revalidation", async ({ page }) => {
  let initializeCalls = 0;
  let answerCalls = 0;
  let summaryCalls = 0;
  let heldAnswerRoute: Route | null = null;
  let heldAnswerRequest: V3BrainRequest | null = null;

  await page.route("**/api/brain", async (route) => {
    const request = route.request().postDataJSON() as V3BrainRequest;
    if (request.operation === "initialize") {
      initializeCalls += 1;
      const response = brainResponse(request);
      response.output.questionRoadmap = roadmapWithLookahead(1);
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: brainStreamBody(response, request) });
      return;
    }
    if (request.operation === "decision_summary") {
      summaryCalls += 1;
      await route.abort();
      return;
    }
    answerCalls += 1;
    heldAnswerRoute = route;
    heldAnswerRequest = request;
  });

  await startLiveText(page);
  expect(initializeCalls).toBe(1);
  await createTypedDraft(page, "Workspace Owners approve billing changes.");
  await page.getByRole("button", { name: "Send confirmed summary to Brain" }).dblclick();
  await expect.poll(() => answerCalls).toBe(1);
  await expect(page.getByText("One safe lookahead", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: teamBillingPrompts[2]!.detailedQuestion })).toBeVisible();

  await page.getByLabel("Clarify this decision").fill("Charge monthly per active seat in USD.");
  await page.getByRole("button", { name: "Send clarification" }).click();
  await page.getByRole("button", { name: "Create Decision Summary" }).click();
  await expect(page.getByText("Non-authoritative")).toBeVisible();
  await page.getByRole("button", { name: "Confirm and queue pending revalidation" }).dblclick();
  await expect(page.getByRole("button", { name: "Queued pending revalidation" })).toBeDisabled();
  expect(summaryCalls).toBe(0);

  expect(heldAnswerRoute).not.toBeNull();
  expect(heldAnswerRequest).not.toBeNull();
  const response = brainResponse(heldAnswerRequest!, teamBillingSnapshots[1], teamBillingPrompts[2]);
  response.output.questionRoadmap = staleRoadmap(2);
  await heldAnswerRoute!.fulfill({ status: 200, contentType: "application/x-ndjson", body: brainStreamBody(response, heldAnswerRequest!) });

  await expect(page.getByText("Not applied").first()).toBeVisible();
  await expect(page.getByText("Billing basis now depends on the authoritative permissions revision.", { exact: true })).toBeVisible();
  await expect(page.getByText("Revision 2")).toBeVisible();
  expect(answerCalls).toBe(1);
  expect(summaryCalls).toBe(0);
  await expectNoSeriousAxeViolations(page);
});
