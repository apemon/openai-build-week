import { expect, test } from "@playwright/test";
import { teamBillingPrompts, teamBillingSnapshots } from "@/demo/team-billing-snapshots";
import { brainResponse, brainStreamBody, downloadText, expectNoSeriousAxeViolations, startLiveText } from "./helpers";

test("defers, finalizes with follow-ups, resumes, and exports", async ({ page }) => {
  let confirmedTurnCount = -1;
  await page.route("**/api/brain", async (route) => {
    const request = route.request().postDataJSON();
    if (request.operation === "initialize") {
      expect(request.turns).toHaveLength(0);
    } else if (request.operation === "defer") {
      expect(request.turns.at(-1)?.type).toBe("deferred_prompt");
      expect(request.turns.at(-1)?.text).toContain("Pricing committee meets Friday");
      confirmedTurnCount = request.turns.length;
    } else {
      expect(request.operation).toBe("resume");
      expect(request.turns).toHaveLength(confirmedTurnCount);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: brainStreamBody(brainResponse(
        request,
        request.operation === "initialize" ? teamBillingSnapshots[0] : teamBillingSnapshots.at(-1)!,
        request.operation === "initialize" || request.operation === "resume" ? teamBillingPrompts[1] : null,
      ), request),
    });
  });

  await startLiveText(page);
  await page.getByRole("button", { name: "Defer" }).click();
  await page.getByLabel("Optional deferral note").fill("Pricing committee meets Friday");
  await page.getByRole("button", { name: "Confirm deferral" }).click();
  await expect(page.getByText("Final Review", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next Actions" })).toBeVisible();

  await page.getByRole("button", { name: "Finalize specification" }).click();
  await expect(page.getByRole("button", { name: "Finalize specification" })).toHaveCount(0);
  await page.getByRole("button", { name: "Resume grilling" }).click();
  await expect(page.getByRole("heading", { name: /Which workspace roles/ })).toBeVisible();
  await page.getByRole("button", { name: "Review specification" }).click();
  await page.getByRole("button", { name: "Finalize specification" }).click();
  await expectNoSeriousAxeViolations(page);

  const exported = await downloadText(page);
  expect(exported.text).toContain("Provenance: Live AI");
  expect(exported.text).toContain("Brain model: gpt-5.6");
  expect(exported.text).toContain("## Open Questions");
  expect(exported.text).toContain("## Next Actions");
  expect(exported.text).not.toContain("DRAFT —");
});
