import { expect, test, type Page } from "@playwright/test";
import type { V3BrainRequest } from "@/domain/v3-schemas";
import { createLockedRealtimeSession } from "@/realtime/realtime-session";
import { emitRealtime, expectNoSeriousAxeViolations, fulfillBrain, installFakeRealtime } from "./helpers";

async function responseCreate(page: Page, purpose: string): Promise<{ metadata: Record<string, string> } | null> {
  return page.evaluate((expectedPurpose) => {
    const sent = (window as typeof window & { __realtimeSent?: string[] }).__realtimeSent ?? [];
    for (const raw of [...sent].reverse()) {
      const event = JSON.parse(raw) as { type?: string; response?: { metadata?: Record<string, string> } };
      if (event.type === "response.create" && event.response?.metadata?.purpose === expectedPurpose) {
        return { metadata: event.response.metadata };
      }
    }
    return null;
  }, purpose);
}

test("assesses a finalized transcript and submits only the edited confirmed summary", async ({ page }) => {
  const requests: V3BrainRequest[] = [];
  const rawIntake = "LEAK_SENTINEL_RAW_INTAKE Owners can manage billng.";
  const assessedSummary = "Owners can manage billng and members cannot access billing.";
  const editedSummary = "Owners manage billing, Billing Admins maintain payment details, and Members have no billing access.";

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
    requests.push(await fulfillBrain(route));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await expect(page.getByRole("heading", { name: "Start with reviewed context" })).toBeVisible();
  await page.getByRole("textbox", { name: /Initial Prompt/ }).fill("We need team billing for our SaaS.");
  await page.getByRole("button", { name: "Prepare context" }).click();
  await page.getByRole("button", { name: "Confirm digest and start interview" }).click();
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as typeof window & { __realtimeChannel?: EventTarget }).__realtimeChannel,
  ))).toBe(true);
  await emitRealtime(page, {
    event_id: "session-created",
    type: "session.created",
    session: createLockedRealtimeSession(),
  });
  await expect(page.getByRole("heading", { name: /Which workspace roles/ })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);

  await expect.poll(async () => responseCreate(page, "speak_brain_prompt")).not.toBeNull();
  const promptRequest = (await responseCreate(page, "speak_brain_prompt"))!;
  await emitRealtime(page, { event_id: "evt-created", type: "response.created", response: { id: "resp-prompt", metadata: promptRequest.metadata } });
  await emitRealtime(page, { event_id: "evt-started", type: "output_audio_buffer.started", response_id: "resp-prompt" });
  await emitRealtime(page, { event_id: "evt-stopped", type: "output_audio_buffer.stopped", response_id: "resp-prompt" });
  await emitRealtime(page, { event_id: "evt-speech-start", type: "input_audio_buffer.speech_started", item_id: "item-1", audio_start_ms: 0 });
  await emitRealtime(page, { event_id: "evt-speech-stop", type: "input_audio_buffer.speech_stopped", item_id: "item-1", audio_end_ms: 800 });
  await emitRealtime(page, { event_id: "evt-transcript", type: "conversation.item.input_audio_transcription.completed", item_id: "item-1", content_index: 0, transcript: rawIntake });

  await expect.poll(async () => responseCreate(page, "answer_intake_assessment")).not.toBeNull();
  await expect(page.getByRole("heading", { name: /Answer Summary/ })).toHaveCount(0);
  expect(requests).toHaveLength(1);

  const assessmentRequest = (await responseCreate(page, "answer_intake_assessment"))!;
  await emitRealtime(page, { event_id: "assessment-created", type: "response.created", response: { id: "resp-assessment", metadata: assessmentRequest.metadata } });
  await emitRealtime(page, {
    event_id: "assessment-done",
    type: "response.output_text.done",
    response_id: "resp-assessment",
    item_id: "assessment-item",
    output_index: 0,
    content_index: 0,
    text: JSON.stringify({
      summary: assessedSummary,
      coverage: [
        { aspectId: "ASPECT-101", status: "covered" },
        { aspectId: "ASPECT-102", status: "covered" },
        { aspectId: "ASPECT-103", status: "covered" },
      ],
      uncertainties: [],
      clarificationQuestion: null,
      clarificationAspectIds: [],
    }),
  });

  const summary = page.getByRole("textbox", { name: "Answer Summary" });
  await expect(summary).toHaveValue(assessedSummary);
  await expect(page.getByText("Edit this concise Communicator summary before confirming it.")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await summary.fill(editedSummary);
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "Send confirmed summary to Brain" }).click();
  await expect.poll(() => requests.length).toBe(2);

  expect(requests[1].turns.at(-1)).toMatchObject({
    type: "confirmed_answer",
    text: editedSummary,
  });
  expect(JSON.stringify(requests[1])).not.toContain(rawIntake);
  expect(JSON.stringify(requests[1])).not.toContain(assessedSummary);
});
