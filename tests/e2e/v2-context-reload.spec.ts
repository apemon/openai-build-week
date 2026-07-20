import { expect, test } from "@playwright/test";

import { teamBillingPrompts, teamBillingSnapshots } from "@/demo/team-billing-snapshots";
import type { V3BrainRequest } from "@/domain/v3-schemas";
import { brainResponse, brainStreamBody, expectNoSeriousAxeViolations } from "./helpers";

const fullExtractionMarker = "FULL-SOURCE-EXTRACTION-MUST-STAY-TEMPORARY";

test("requires partial-extraction acknowledgement and reloads only the confirmed digest", async ({ page }) => {
  let brainRequest: V3BrainRequest | null = null;
  let contextCalls = 0;
  await page.route("**/api/context", async (route) => {
    contextCalls += 1;
    const requestId = route.request().headers()["x-request-id"]!;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        requestId,
        digest: {
          id: "DIGEST-PARTIAL",
          initialPrompt: "Build a reviewed billing flow.",
          statements: [
            { id: "CTX-001", statement: "Build a reviewed billing flow.", sourceReferences: [{ sourceId: "SOURCE-INITIAL", location: "Initial Prompt", page: null, heading: null, paragraph: 1 }] },
            { id: "CTX-002", statement: "Owners manage billing.", sourceReferences: [{ sourceId: "SOURCE-CONTEXT", location: "Page 1", page: 1, heading: null, paragraph: null }] },
          ],
          sources: [
            { id: "SOURCE-INITIAL", kind: "initial_prompt", filename: null, mimeType: "text/plain", sizeBytes: null, characterCount: 30, pageCount: null },
            { id: "SOURCE-CONTEXT", kind: "uploaded_file", filename: "partial-brief.pdf", mimeType: "application/pdf", sizeBytes: 20, characterCount: 43, pageCount: 2 },
          ],
          coverage: { coveredLocations: ["Initial Prompt", "Page 1"], omissions: ["Page 2 contained no recoverable text."], warnings: ["Some PDF pages had no recoverable text."], requiresAcknowledgement: true },
          confirmedAt: null,
        },
        temporaryExtraction: {
          sourceId: "SOURCE-CONTEXT",
          excerpts: [{ id: "EXCERPT-001", sourceId: "SOURCE-CONTEXT", text: fullExtractionMarker, reference: { sourceId: "SOURCE-CONTEXT", location: "Page 1", page: 1, heading: null, paragraph: null } }],
          complete: false,
          warnings: ["Some PDF pages had no recoverable text."],
        },
      }),
    });
  });
  await page.route("**/api/brain", async (route) => {
    brainRequest = route.request().postDataJSON() as V3BrainRequest;
    const response = brainResponse(brainRequest, teamBillingSnapshots[0], teamBillingPrompts[1]);
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: brainStreamBody(response, brainRequest) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with text only" }).click();
  await page.getByRole("textbox", { name: /Initial Prompt/ }).fill("Build a reviewed billing flow.");
  await page.getByRole("tab", { name: "Upload one file" }).click();
  await page.getByLabel("Project document").setInputFiles({ name: "partial-brief.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 test") });
  await page.getByRole("button", { name: "Prepare context" }).click();
  await expect(page.getByRole("heading", { name: "Review Project Context Digest" })).toBeVisible();
  await expect(page.getByText("Page 2 contained no recoverable text.")).toBeVisible();
  await expect(page.getByText("Some PDF pages had no recoverable text.")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm digest and start interview" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox", { name: /I reviewed the known gaps/ }).check();
  await confirm.click();
  await expect(page.getByRole("heading", { name: /Which workspace roles/ })).toBeVisible();
  expect(contextCalls).toBe(1);
  expect(brainRequest).toMatchObject({
    operation: "initialize",
    confirmedContextDigest: { coverage: { requiresAcknowledgement: true }, confirmedAt: expect.any(String) },
  });
  await expectNoSeriousAxeViolations(page);

  const checkpointBeforeReload = await page.evaluate(() => sessionStorage.getItem("spec-grill:checkpoint:v1"));
  expect(checkpointBeforeReload).toContain("partial-brief.pdf");
  expect(checkpointBeforeReload).toContain("Page 2 contained no recoverable text.");
  expect(checkpointBeforeReload).not.toContain(fullExtractionMarker);
  const checkpoint = JSON.parse(checkpointBeforeReload!) as { state: { contextPreparation: unknown; temporaryExtractionAvailable: boolean } };
  expect(checkpoint.state.contextPreparation).toBeNull();
  expect(checkpoint.state.temporaryExtractionAvailable).toBe(false);

  await page.reload();
  await expect(page.getByRole("heading", { name: /Which workspace roles/ })).toBeVisible();
  expect(contextCalls).toBe(1);
  await page.getByRole("button", { name: "Review specification" }).click();
  await page.getByRole("button", { name: "Exit and clear session" }).click();
  await page.getByRole("button", { name: "Yes, exit and clear" }).click();
  await expect(page.getByRole("heading", { name: "Spec Grill" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("spec-grill:checkpoint:v1"))).toBeNull();
});
