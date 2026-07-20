import { expect, test } from "@playwright/test";

import { teamBillingPrompts } from "@/demo/team-billing-snapshots";
import type { V3BrainRequest } from "@/domain/v3-schemas";
import { brainResponse, brainStreamBody, expectNoSeriousAxeViolations, startLiveText } from "./helpers";

test("reload requires explicit revalidation and a separate explicit restored-batch submission", async ({ page }) => {
  const operations: string[] = [];
  await page.route("**/api/brain", async (route) => {
    const request = route.request().postDataJSON() as V3BrainRequest;
    operations.push(request.operation);
    const response = brainResponse(request);
    if (request.operation === "revalidate_restored") {
      const restored = request.restoredEntriesForRevalidation[0];
      const dependencyVersion = response.output.questionRoadmap.dependencyVersion;
      const freshPermit = {
        id: "PERMIT-902",
        windowId: `WINDOW-RESTORED-${request.baseRevision}`,
        roadmapItemId: restored.roadmapItemId,
        prompt: {
          ...teamBillingPrompts[1],
          recommendation: teamBillingPrompts[1].recommendation
            ? { ...teamBillingPrompts[1].recommendation, externalEvidenceIds: [] }
            : null,
        },
        ordinal: restored.permitOrdinal,
        approvedAtRevision: request.baseRevision,
        dependencyVersion,
        independentOfOperation: "revalidate_restored" as const,
        invalidationItemIds: [],
        domainKeys: ["restored-decision"],
      };
      response.output.interviewWindow = {
        id: freshPermit.windowId,
        approvedAtRevision: request.baseRevision,
        dependencyVersion,
        independentOfOperation: "revalidate_restored",
        applicationCap: request.requestedApplicationCap,
        permits: [freshPermit],
      };
      response.output.priorPermitDispositions = [{
        priorWindowId: restored.windowId,
        priorPermitId: restored.permitId,
        roadmapItemId: restored.roadmapItemId,
        status: "reissued",
        freshPermitId: freshPermit.id,
        revalidatedAtRevision: request.baseRevision,
        dependencyVersion,
      }];
    }
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: brainStreamBody(response, request) });
  });

  await startLiveText(page);
  expect(operations).toEqual(["initialize"]);
  const confirmedAt = new Date().toISOString();
  await page.evaluate(({ confirmedAt }) => {
    const key = "spec-grill:checkpoint:v1";
    const checkpoint = JSON.parse(sessionStorage.getItem(key)!);
    checkpoint.confirmedQueuedEntries = [{
      kind: "decision_summary",
      jobId: "JOB-RESTORED-001",
      exchangeId: "EXCHANGE-RESTORED-001",
      permitId: "PERMIT-901",
      roadmapItemId: "ROADMAP-001",
      permitOrdinal: 1,
      confirmedTurnId: "TURN-RESTORED-001",
      text: "Workspace Owners manage billing changes.",
      uncertainties: [],
      confirmedAt,
      revalidatedAtRevision: checkpoint.state.revision,
      revalidatedDependencyVersion: checkpoint.state.questionRoadmap.dependencyVersion,
      windowId: "WINDOW-RESTORED-PRIOR",
      approvalRevision: checkpoint.state.revision,
      approvalDependencyVersion: checkpoint.state.questionRoadmap.dependencyVersion,
    }];
    checkpoint.adaptiveWindow = { eligibleOutcomes: [], applicationCap: 1, singletonRecoveryStreak: 0 };
    sessionStorage.setItem(key, JSON.stringify(checkpoint));
  }, { confirmedAt });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Restored decisions require fresh authorization" })).toBeVisible();
  await expect(page.getByText("Nothing restored from this browser session will be sent automatically.")).toBeVisible();
  await page.waitForTimeout(100);
  expect(operations).toEqual(["initialize"]);
  await expect(page.getByRole("button", { name: "Submit restored decisions" })).toHaveCount(0);

  await page.getByRole("button", { name: "Revalidate restored decisions" }).click();
  await expect.poll(() => operations).toEqual(["initialize", "revalidate_restored"]);
  await expect(page.getByRole("button", { name: "Submit restored decisions" })).toBeVisible();
  expect(operations).toHaveLength(2);
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Submit restored decisions" }).click();
  await expect.poll(() => operations).toEqual(["initialize", "revalidate_restored", "decision_batch"]);
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
});
