import { expect, test } from "@playwright/test";
import { createTypedDraft, expectNoSeriousAxeViolations, fulfillBrain, startLiveText } from "./helpers";

test("submits one mocked typed Live turn only after explicit confirmation", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/brain", async (route) => {
    calls += 1;
    await fulfillBrain(route);
  });

  await startLiveText(page);
  await createTypedDraft(page, "We need team billing for our SaaS.");
  expect(calls).toBe(0);
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Send to Brain" }).click();
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByRole("heading", { name: "Team billing for a SaaS workspace" })).toBeVisible();
  await expect(page.getByText("Revision 1")).toBeVisible();
});
