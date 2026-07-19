import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/realtime/session/route";

const routeUrl = "http://localhost:3000/api/realtime/session";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/realtime/session", () => {
  it("keeps Live Mode disabled without valid server configuration", async () => {
    vi.stubEnv("LIVE_AI_ENABLED", "false");
    const response = await POST(createRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "LIVE_DISABLED", retryable: false },
    });
  });

  it("mints only a short-lived credential with the locked session", async () => {
    stubLiveConfiguration();
    const providerFetch = vi.fn().mockResolvedValue(
      Response.json({ value: "temporary-client-value", expires_at: 1_800_000_000 }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(createRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      schemaVersion: 1,
      clientSecret: "temporary-client-value",
      expiresAt: new Date(1_800_000_000 * 1_000).toISOString(),
      configuration: {
        realtimeModel: "gpt-realtime-2.1",
        transcriptionModel: "gpt-4o-transcribe",
        voice: "marin",
      },
    });
    expect(JSON.stringify(body)).not.toContain("standard-server-test-value");

    const providerInit = providerFetch.mock.calls[0]?.[1] as RequestInit;
    const providerBody = JSON.parse(String(providerInit.body));
    expect(providerBody.session.audio.input.turn_detection.create_response).toBe(false);
    expect(providerBody.session.audio.input.turn_detection.interrupt_response).toBe(false);
    expect(providerBody.session.tools).toEqual([]);
    expect(providerBody.expires_after.seconds).toBe(600);
  });

  it("rejects a cross-origin credential request before contacting OpenAI", async () => {
    stubLiveConfiguration();
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const request = createRequest("https://unexpected.example");
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(providerFetch).not.toHaveBeenCalled();
  });
});

function stubLiveConfiguration(): void {
  vi.stubEnv("LIVE_AI_ENABLED", "true");
  vi.stubEnv("OPENAI_API_KEY", "standard-server-test-value");
  vi.stubEnv("ALLOWED_ORIGIN", "http://localhost:3000");
  vi.stubEnv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1");
  vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-transcribe");
}

function createRequest(origin = "http://localhost:3000"): Request {
  return new Request(routeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({ schemaVersion: 1, sessionId: "SESSION-123456789ABC" }),
  });
}
