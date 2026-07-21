import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route } from "@playwright/test";
import { teamBillingPrompts, teamBillingSnapshots } from "@/demo/team-billing-snapshots";
import { createEmptyQuestionRoadmap } from "@/domain/initial-state";
import type { InterviewPrompt, Specification } from "@/domain/types";
import { migrateSpecificationToV3 } from "@/domain/v3-invariants";
import type { V3BrainRequest, V3BrainResponse } from "@/domain/v3-schemas";

export async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.map((node) => node.target) }));
  expect(serious).toEqual([]);
}

export async function startLiveText(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with text only" }).click();
  await expect(page.getByRole("heading", { name: "Start with reviewed context" })).toBeVisible();
  await page.getByRole("textbox", { name: /Initial Prompt/ }).fill("We need team billing for our SaaS.");
  await page.getByRole("button", { name: "Prepare context" }).click();
  await expect(page.getByRole("heading", { name: "Review Project Context Digest" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm digest and start interview" }).click();
  await expect(page.getByRole("heading", { name: /Which workspace roles/ })).toBeVisible();
}

export async function createTypedDraft(page: Page, text: string): Promise<void> {
  await page.getByLabel("Type an answer").fill(text);
  await page.getByRole("button", { name: "Review answer" }).click();
  await expect(page.getByRole("heading", { name: /Answer Summary/ })).toBeVisible();
}

export function brainResponse(
  request: V3BrainRequest,
  specification: Specification = teamBillingSnapshots[0],
  nextPrompt: InterviewPrompt | null = teamBillingPrompts[1],
): V3BrainResponse {
  const revision = request.operation === "revalidate_restored" ? request.baseRevision : request.baseRevision + 1;
  const roadmap = createEmptyQuestionRoadmap(revision);
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    baseRevision: request.baseRevision,
    revision,
    provenance: {
      source: "live_ai",
      agent: "brain",
      requestedModel: "gpt-5.6",
      actualModel: "gpt-5.6",
      validatedAt: new Date().toISOString(),
      repairAttempted: false,
    },
    output: {
      specification: migrateSpecificationToV3(specification),
      questionRoadmap: roadmap,
      nextPrompt: nextPrompt
        ? { ...nextPrompt, recommendation: nextPrompt.recommendation ? { ...nextPrompt.recommendation, externalEvidenceIds: [] } : null }
        : null,
      changeSummary: ["Applied a validated test revision."],
      interviewWindow: {
        id: `WINDOW-E2E-${revision}`,
        approvedAtRevision: revision,
        dependencyVersion: roadmap.dependencyVersion,
        independentOfOperation: request.operation,
        applicationCap: request.requestedApplicationCap,
        permits: [],
      },
      priorPermitDispositions: (request.priorInterviewWindow?.permits ?? []).map((permit) => ({
        priorWindowId: request.priorInterviewWindow!.id,
        priorPermitId: permit.id,
        roadmapItemId: permit.roadmapItemId,
        status: "dependency_invalidated" as const,
        reason: "The mocked authoritative revision invalidated this prior permit.",
        revalidatedAtRevision: revision,
        dependencyVersion: roadmap.dependencyVersion,
      })),
    },
  };
}

export function brainStreamBody(response: unknown, request?: V3BrainRequest): string {
  const lifecycle = request
    ? [{
        type: "lifecycle",
        event: {
          schemaVersion: 1,
          requestId: request.requestId,
          actionId: request.actionId,
          baseRevision: request.baseRevision,
          cancelEpoch: request.cancelEpoch,
          attempt: 1,
          sequence: 0,
          observedAt: new Date().toISOString(),
          kind: "request_accepted",
        },
      }]
    : [];
  return `${[...lifecycle, { type: "result", response }].map((envelope) => JSON.stringify(envelope)).join("\n")}\n`;
}

export async function fulfillBrain(route: Route, responder?: (request: V3BrainRequest) => unknown): Promise<V3BrainRequest> {
  const request = route.request().postDataJSON() as V3BrainRequest;
  await route.fulfill({
    status: 200,
    contentType: "application/x-ndjson",
    body: brainStreamBody(responder ? responder(request) : brainResponse(request), request),
  });
  return request;
}

export async function downloadText(page: Page): Promise<{ filename: string; text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Markdown" }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { filename: download.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
}

export async function installFakeRealtime(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const track = {
      enabled: false,
      readyState: "live",
      stop() { this.readyState = "ended"; },
    };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    };
    class FakeDataChannel extends EventTarget {
      readyState = "open";
      send(data: string) {
        (window as typeof window & { __realtimeSent?: string[] }).__realtimeSent?.push(data);
      }
      close() { this.readyState = "closed"; }
    }
    class FakePeerConnection extends EventTarget {
      connectionState = "connected";
      localDescription: RTCSessionDescriptionInit | null = null;
      createDataChannel() {
        const channel = new FakeDataChannel();
        (window as typeof window & { __realtimeChannel?: FakeDataChannel }).__realtimeChannel = channel;
        return channel;
      }
      addTrack() {}
      async createOffer() { return { type: "offer" as const, sdp: "fake-local-sdp" }; }
      async setLocalDescription(description: RTCSessionDescriptionInit) { this.localDescription = description; }
      async setRemoteDescription() {}
      close() { this.connectionState = "closed"; }
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: FakePeerConnection });
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: async () => undefined });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: () => undefined });
    (window as typeof window & { __realtimeSent?: string[] }).__realtimeSent = [];
  });
}

export async function emitRealtime(page: Page, event: object): Promise<void> {
  await page.evaluate((providerEvent) => {
    const channel = (window as typeof window & { __realtimeChannel?: EventTarget }).__realtimeChannel;
    if (!channel) throw new Error("Fake Realtime data channel is not connected");
    channel.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(providerEvent) }));
  }, event);
}
