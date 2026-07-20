import { expect, test } from "@playwright/test";
import { emitRealtime, expectNoSeriousAxeViolations, fulfillBrain, installFakeRealtime } from "./helpers";

test("receives, edits, and confirms a mocked transcription before Brain submission", async ({ page }) => {
  let submittedText = "";
  await installFakeRealtime(page);
  await page.route("**/api/realtime/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        clientSecret: "temporary-e2e-secret",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        configuration: { realtimeModel: "gpt-realtime-2.1", transcriptionModel: "gpt-4o-transcribe", voice: "marin" },
      }),
    });
  });
  await page.route("https://api.openai.com/v1/realtime/calls", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/sdp", body: "fake-remote-sdp" });
  });
  await page.route("**/api/brain", async (route) => {
    const request = await fulfillBrain(route);
    submittedText = request.turns.at(-1)?.text ?? "";
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await expect(page.getByRole("heading", { name: "Start with reviewed context" })).toBeVisible();
  await page.getByRole("textbox", { name: /Initial Prompt/ }).fill("We need team billing for our SaaS.");
  await page.getByRole("button", { name: "Prepare context" }).click();
  await page.getByRole("button", { name: "Confirm digest and start interview" }).click();
  await expect(page.getByRole("heading", { name: /Which workspace roles/ })).toBeVisible();
  submittedText = "";
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __realtimeSent?: string[] }).__realtimeSent?.some((event) => event.includes("PROMPT-PERMISSIONS")))).toBe(true);

  await emitRealtime(page, { event_id: "evt-created", type: "response.created", response: { id: "resp-1", metadata: { purpose: "speak_brain_prompt", promptId: "PROMPT-PERMISSIONS" } } });
  await emitRealtime(page, { event_id: "evt-stopped", type: "output_audio_buffer.stopped", response_id: "resp-1" });
  await emitRealtime(page, { event_id: "evt-speech-start", type: "input_audio_buffer.speech_started", item_id: "item-1", audio_start_ms: 0 });
  await emitRealtime(page, { event_id: "evt-speech-stop", type: "input_audio_buffer.speech_stopped", item_id: "item-1", audio_end_ms: 800 });
  await emitRealtime(page, { event_id: "evt-transcript", type: "conversation.item.input_audio_transcription.completed", item_id: "item-1", content_index: 0, transcript: "We need team billng." });

  const draft = page.getByRole("textbox", { name: "Answer Draft" });
  await expect(draft).toHaveValue("We need team billng.");
  await expect(page.getByText("Edit this transcription before it reaches the Brain.")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await draft.fill("We need team billing.");
  expect(submittedText).toBe("");
  await page.getByRole("button", { name: "Send to Brain" }).click();
  await expect.poll(() => submittedText).toBe("We need team billing.");
});
