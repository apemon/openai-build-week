import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validV3BrainOutput, validV3BrainRequest } from "@/agents/brain/v3-test-fixtures";

const provider = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  cancel: vi.fn(),
}));

const codexSdk = vi.hoisted(() => ({
  startThread: vi.fn(),
  resumeThread: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = provider;
  },
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: class MockCodex {
    startThread(options: unknown) {
      return codexSdk.startThread(options);
    }

    resumeThread(id: string, options: unknown) {
      return codexSdk.resumeThread(id, options);
    }
  },
}));

import { POST } from "./route";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.clearAllMocks();
});

function liveRequest(body = validV3BrainRequest()): Request {
  const current = structuredClone(body);
  current.turns = current.turns.map((turn) => ({ ...turn, createdAt: new Date().toISOString() }));
  return new Request("http://localhost:3000/api/brain", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(current),
  });
}

describe("V3 streamed Brain route", () => {
  it("streams allowlisted lifecycle followed by exactly one result", async () => {
    process.env.LIVE_AI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-only-key";
    process.env.ALLOWED_ORIGIN = "http://localhost:3000";
    delete process.env.OPENAI_BRAIN_HARNESS;
    delete process.env.BRAIN_PUBLIC_SEARCH_ENABLED;
    provider.create.mockResolvedValue({
      id: "provider-id-must-not-enter-lifecycle",
      status: "completed",
      model: "gpt-5.6-test",
      output_parsed: validV3BrainOutput(),
    });

    const response = await POST(liveRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const lines = (await response.text()).trim().split("\n");
    const envelopes = lines.map((line) => JSON.parse(line) as { type: string });
    expect(envelopes.map((envelope) => envelope.type)).toEqual([
      "lifecycle",
      "lifecycle",
      "lifecycle",
      "result",
    ]);
    expect(lines.slice(0, -1).join("\n")).not.toContain("provider-id-must-not-enter-lifecycle");
    expect(envelopes.filter((envelope) => envelope.type === "result")).toHaveLength(1);
  });

  it("rejects local-only frozen evidence before streaming", async () => {
    process.env.LIVE_AI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-only-key";
    process.env.ALLOWED_ORIGIN = "http://localhost:3000";
    const request = validV3BrainRequest();
    request.externalEvidenceBundle = [{
      id: "EVID-001",
      title: "Synthetic source",
      url: "https://example.org/source",
      retrievedAt: "2026-07-21T00:00:00.000Z",
      factualAbstract: "Synthetic abstract.",
      contentHash: `sha256:${"1".repeat(64)}`,
    }];
    const response = await POST(liveRequest(request));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("rejects codex_ephemeral and incompatible search on the ordinary Live route", async () => {
    process.env.LIVE_AI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-only-key";
    process.env.ALLOWED_ORIGIN = "http://localhost:3000";
    process.env.OPENAI_BRAIN_HARNESS = "codex_ephemeral";
    process.env.BRAIN_EXPERIMENTAL_HARNESSES_ENABLED = "true";
    let response = await POST(liveRequest());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });

    process.env.OPENAI_BRAIN_HARNESS = "one_shot";
    process.env.BRAIN_PUBLIC_SEARCH_ENABLED = "true";
    response = await POST(liveRequest());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("streams persistent Codex through the existing route only when experimentally enabled", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-route-codex-"));
    process.env.LIVE_AI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-only-key";
    process.env.ALLOWED_ORIGIN = "http://localhost:3000";
    process.env.OPENAI_BRAIN_HARNESS = "codex_sdk_persistent";
    process.env.BRAIN_EXPERIMENTAL_HARNESSES_ENABLED = "true";
    process.env.CODEX_BRAIN_HOME = storageRoot;
    const thread = {
      id: null as string | null,
      async runStreamed() {
        return {
          events: (async function* () {
            thread.id = "THREAD-ROUTE-001";
            yield { type: "thread.started", thread_id: thread.id };
            yield { type: "turn.started" };
            yield {
              type: "item.completed",
              item: { type: "agent_message", text: JSON.stringify(validV3BrainOutput()) },
            };
            yield { type: "turn.completed", usage: null };
          })(),
        };
      },
    };
    codexSdk.startThread.mockReturnValue(thread);

    try {
      const response = await POST(liveRequest());
      expect(response.status).toBe(200);
      const envelopes = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
      expect(envelopes.map((envelope) => envelope.type)).toEqual([
        "lifecycle",
        "lifecycle",
        "lifecycle",
        "lifecycle",
        "result",
      ]);
      expect(envelopes.at(-1)).toMatchObject({
        type: "result",
        response: {
          codexThreadId: "THREAD-ROUTE-001",
          provenance: {
            source: "live_ai",
            requestedModel: "gpt-5.6-sol",
            actualModel: "gpt-5.6-sol:unverified",
          },
        },
      });
      expect(codexSdk.startThread).toHaveBeenCalledWith(expect.objectContaining({
        sandboxMode: "read-only",
        webSearchMode: "disabled",
      }));
      expect(provider.create).not.toHaveBeenCalled();
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});
