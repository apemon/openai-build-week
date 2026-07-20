import { expect, test } from "@playwright/test";
import { downloadText, expectNoSeriousAxeViolations } from "./helpers";

test("completes the keyboard-driven Prepared Demo and exports labeled Markdown", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let forbiddenRuntimeRequests = 0;
  await page.addInitScript(() => {
    const browser = window as typeof window & { __microphoneRequests?: number };
    browser.__microphoneRequests = 0;
    const mediaDevices = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        ...mediaDevices,
        getUserMedia: async () => {
          browser.__microphoneRequests = (browser.__microphoneRequests ?? 0) + 1;
          throw new Error("Prepared Demo must not request microphone access");
        },
      },
    });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "api.openai.com" || /\/api\/(brain|realtime|context)(?:\/|$)/.test(url.pathname)) {
      forbiddenRuntimeRequests += 1;
    }
  });
  await page.goto("/");
  await expectNoSeriousAxeViolations(page);

  const start = page.getByRole("button", { name: "Run prepared demo" });
  await start.focus();
  await start.press("Enter");
  await expect(page.getByText("Prepared demo • no AI call", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with reviewed context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "team-billing-project-brief.md" })).toBeVisible();
  await expect(page.getByText(/does not read a user file or make a network, microphone, or AI call/)).toBeVisible();
  const prepare = page.getByRole("button", { name: "Prepare bundled context" });
  await prepare.focus();
  await prepare.press("Enter");
  await expect(page.getByRole("heading", { name: "Review Project Context Digest" })).toBeVisible();
  await expect(page.getByText("Source: team-billing-project-brief.md · Roles")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "Confirm prepared digest" }).click();
  await expect(page.getByRole("heading", { name: /Which workspace roles/ })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Use prepared answer" }).click();
  await expect(page.getByRole("region", { name: "Persistent Brain Status" })).toContainText("Brain working");
  await expect(page.getByText("Prepared fixture clock")).toBeVisible();

  await page.getByRole("button", { name: "Use prepared answer" }).click();
  await expect(page.getByText("One active Brain-approved decision")).toBeVisible();
  await expect(page.getByText("1 future permitted topic")).toBeVisible();
  await expect(page.getByRole("heading", { name: /What is the billing unit/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /When do invited, accepted/ })).toHaveCount(0);
  await expect(page.getByText("Use active seats billed monthly in USD.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Advance prepared walkthrough" })).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Confirm decision and continue" }).click();
  await expect(page.getByText("Confirmed — awaiting dependency check").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /When do invited, accepted/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Advance prepared walkthrough" })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm decision and continue" }).click();
  await expect(page.getByText("Confirmed — awaiting dependency check")).toHaveCount(2);
  await page.getByRole("button", { name: "Advance prepared walkthrough" }).click();
  await expect(page.getByText("Taking longer than usual", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Advance prepared walkthrough" }).click();
  await expect(page.getByText("Revision applied", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Advance prepared walkthrough" }).click();
  await expect(page.getByText("Not Applied", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reuse wording" })).toBeVisible();
  await page.getByRole("button", { name: "Advance prepared walkthrough" }).click();
  await expect(page.getByText("Applying", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Advance prepared walkthrough" }).click();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Advance prepared walkthrough" }).click();

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
  expect(forbiddenRuntimeRequests).toBe(0);
  expect(await page.evaluate(() => (window as typeof window & { __microphoneRequests?: number }).__microphoneRequests)).toBe(0);
});
