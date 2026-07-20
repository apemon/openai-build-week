import { afterEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/brain/route";
import { createEmptyQuestionRoadmap, createInitialContextDigest, emptySpecification } from "@/domain/initial-state";

const originalEnvironment = {
  LIVE_AI_ENABLED: process.env.LIVE_AI_ENABLED,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/brain", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify(body),
  });
}

function validBody(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId: "SESSION-001",
    mode: "live",
    requestId: "REQUEST-001",
    baseRevision: 0,
    operation: "answer",
    turns: [
      {
        id: "TURN-001",
        promptId: "PROMPT-INITIAL",
        type: "confirmed_answer",
        text: "We need team billing.",
        createdAt: new Date().toISOString(),
      },
    ],
    confirmedContextDigest: createInitialContextDigest(),
    questionRoadmap: createEmptyQuestionRoadmap(),
    relevantSourceExcerpts: [],
    currentSpecification: emptySpecification,
    currentPrompt: null,
  };
}

describe("POST /api/brain guards", () => {
  it("keeps Live Mode disabled when the kill switch or key is absent", async () => {
    process.env.LIVE_AI_ENABLED = "false";
    delete process.env.OPENAI_API_KEY;

    const response = await POST(request(validBody()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "LIVE_DISABLED" } });
  });

  it("rejects an unexpected origin before provider work", async () => {
    process.env.LIVE_AI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key-not-a-real-secret";
    process.env.ALLOWED_ORIGIN = "https://allowed.example";

    const response = await POST(request(validBody()));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("rejects Demo Mode and malformed request contracts", async () => {
    process.env.LIVE_AI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key-not-a-real-secret";
    process.env.ALLOWED_ORIGIN = "http://localhost:3000";
    const body = validBody();
    body.mode = "demo";

    const response = await POST(request(body, { "x-request-id": "REQUEST-001" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "The Brain request is invalid.",
        retryable: false,
        requestId: "REQUEST-001",
      },
    });
  });

  it("rejects an expired Interview Session", async () => {
    process.env.LIVE_AI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key-not-a-real-secret";
    process.env.ALLOWED_ORIGIN = "http://localhost:3000";
    const body = validBody();
    body.turns = [
      {
        id: "TURN-001",
        promptId: null,
        type: "confirmed_answer",
        text: "An old answer.",
        createdAt: new Date(Date.now() - 32 * 60_000).toISOString(),
      },
    ];

    const response = await POST(request(body));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("rejects semantically invalid digest/excerpt provenance before provider work", async () => {
    process.env.LIVE_AI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key-not-a-real-secret";
    process.env.ALLOWED_ORIGIN = "http://localhost:3000";
    const body = validBody();
    body.relevantSourceExcerpts = [{
      id: "EXCERPT-001",
      sourceId: "SOURCE-MISSING",
      text: "Reference content that was not retained by the confirmed digest.",
      reference: {
        sourceId: "SOURCE-MISSING",
        location: "Unknown source",
        page: null,
        heading: null,
        paragraph: 1,
      },
    }];

    const response = await POST(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "The Brain request is invalid.",
        retryable: false,
        requestId: "REQUEST-001",
      },
    });
  });
});
