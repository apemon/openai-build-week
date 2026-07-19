import { expect, test } from "@playwright/test";
import { downloadText, expectNoSeriousAxeViolations } from "./helpers";

test("completes the keyboard-driven Prepared Demo and exports labeled Markdown", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectNoSeriousAxeViolations(page);

  const start = page.getByRole("button", { name: "Run prepared demo" });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Prepared demo • no AI call", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /What do you want to build/ })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (let turn = 0; turn < 8; turn += 1) {
    const next = page.getByRole("button", { name: "Use prepared answer" });
    await next.focus();
    await page.keyboard.press("Enter");
  }

  await expect(page.getByText("Final Review", { exact: true })).toBeVisible();
  await expect(page.getByText(/ready with follow ups/i).first()).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const exported = await downloadText(page);
  expect(exported.filename).toMatch(/^spec-grill-team-billing-for-a-saas-workspace-\d{4}-\d{2}-\d{2}\.md$/);
  expect(exported.text).toContain("Prepared demo data — not live AI output");
  expect(exported.text).toContain("> **DRAFT — this Specification has not been finalized.**");
  expect(exported.text).toContain("## Acceptance Criteria");
  expect(exported.text).not.toContain("We need team billing for our SaaS.");
});
