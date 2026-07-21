import { expect, test } from "@playwright/test";
import type { V3BrainRequest } from "@/domain/v3-schemas";
import { brainResponse, createTypedDraft, expectNoSeriousAxeViolations, fulfillBrain, startLiveText } from "./helpers";

test("submits one mocked typed Live turn only after explicit confirmation", async ({ page }) => {
  const threadId = "0199a213-81c0-7800-8aa1-bbab2a035a53";
  let calls = 0;
  const requests: V3BrainRequest[] = [];
  await page.route("**/api/brain", async (route) => {
    calls += 1;
    requests.push(await fulfillBrain(route, (request) => ({ ...brainResponse(request), codexThreadId: threadId })));
  });

  await startLiveText(page);
  await expect(page.getByRole("heading", { name: "Hackathon Codex session" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("thread")).toBe(threadId);
  expect(requests[0].codexThreadId ?? null).toBeNull();
  await createTypedDraft(page, "We need team billing for our SaaS.");
  expect(calls).toBe(1);
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Send confirmed summary to Brain" }).click();
  await expect.poll(() => calls).toBe(2);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].codexThreadId).toBe(threadId);
  await expect(page.getByRole("heading", { name: "Team billing for a SaaS workspace" })).toBeVisible();
  await expect(page.getByText("Revision 2")).toBeVisible();
});
