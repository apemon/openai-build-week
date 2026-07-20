import { expect, test } from "@playwright/test";
import { createTypedDraft, fulfillBrain, startLiveText } from "./helpers";

test("keeps the last valid Specification after an invalid Brain response", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/brain", async (route) => {
    calls += 1;
    if (calls <= 2) {
      await fulfillBrain(route);
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INVALID_MODEL_OUTPUT",
          message: "The Brain returned an invalid revision. Retry the confirmed answer.",
          retryable: true,
          requestId: "REQ-E2E",
        },
      }),
    });
  });

  await startLiveText(page);
  await createTypedDraft(page, "We need team billing.");
  await page.getByRole("button", { name: "Send to Brain" }).click();
  await expect(page.getByRole("heading", { name: "Team billing for a SaaS workspace" })).toBeVisible();

  await createTypedDraft(page, "Owners should manage billing.");
  await page.getByRole("button", { name: "Send to Brain" }).click();
  await expect(page.getByRole("alert", { name: "Live interview needs attention" })).toContainText("invalid revision");
  await expect(page.getByRole("heading", { name: "Team billing for a SaaS workspace" })).toBeVisible();
  await expect(page.getByText("Revision 2")).toBeVisible();
});
