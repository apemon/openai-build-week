import refusalFixture from "../fixtures/brain-refusal.json";
import validFixture from "../fixtures/brain-valid.json";
import { describe, expect, it, vi } from "vitest";

import { runBrain } from "@/agents/brain/run-brain";
import { BrainRunError } from "@/agents/brain/retry-policy";
import { brainModelOutputSchema, brainRequestSchema } from "@/domain/schemas";
import { emptySpecification } from "@/domain/initial-state";

const request = brainRequestSchema.parse({
  schemaVersion: 1,
  sessionId: "SESSION-001",
  mode: "live",
  requestId: "REQUEST-001",
  baseRevision: 4,
  operation: "answer",
  turns: [
    {
      id: "TURN-001",
      promptId: "PROMPT-INITIAL",
      type: "confirmed_answer",
      text: "We need team billing for our SaaS.",
      createdAt: "2026-07-20T00:00:00.000Z"
    }
  ],
  currentSpecification: emptySpecification,
  currentPrompt: null
});

function providerResponse(output: unknown = validFixture) {
  return {
    id: "resp_001",
    model: "gpt-5.6-2026-07-01",
    status: "completed",
    output: [],
    output_parsed: output,
  };
}

describe("runBrain", () => {
  it("uses GPT-5.6 Responses Structured Outputs and returns complete provenance", async () => {
    const parse = vi.fn().mockResolvedValue(providerResponse());
    const result = await runBrain(request, {
      responses: { parse },
      now: () => new Date("2026-07-20T01:00:00.000Z"),
    });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6",
      reasoning: { effort: "medium" },
      store: false,
      text: { format: { type: "json_schema" } },
    });
    expect(result).toMatchObject({
      requestId: "REQUEST-001",
      baseRevision: 4,
      revision: 5,
      provenance: {
        requestedModel: "gpt-5.6",
        actualModel: "gpt-5.6-2026-07-01",
        repairAttempted: false,
        validatedAt: "2026-07-20T01:00:00.000Z",
      },
    });
  });

  it("makes exactly one repair attempt after semantic rejection", async () => {
    const invalid = brainModelOutputSchema.parse(structuredClone(validFixture));
    invalid.nextPrompt!.detailedQuestion = "Who pays? Who cancels?";
    const parse = vi
      .fn()
      .mockResolvedValueOnce(providerResponse(invalid))
      .mockResolvedValueOnce(providerResponse());

    const result = await runBrain(request, { responses: { parse } });

    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[1][0].input[1].content).toContain("Validation errors");
    expect(result.provenance.repairAttempted).toBe(true);
  });

  it("returns a typed error after a second invalid response", async () => {
    const invalid = brainModelOutputSchema.parse(structuredClone(validFixture));
    invalid.nextPrompt!.spokenQuestion = "Who pays? Who cancels?";
    const parse = vi.fn().mockResolvedValue(providerResponse(invalid));

    await expect(runBrain(request, { responses: { parse } })).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
      retryable: true,
    });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("maps repeated refusals without exposing refusal text", async () => {
    const parse = vi.fn().mockResolvedValue(refusalFixture);

    await expect(runBrain(request, { responses: { parse } })).rejects.toEqual(
      expect.objectContaining<Partial<BrainRunError>>({
        code: "MODEL_REFUSAL",
        message: "The Brain refused the request.",
      }),
    );
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("maps provider rate limiting", async () => {
    const parse = vi.fn().mockRejectedValue({ status: 429 });

    await expect(runBrain(request, { responses: { parse } })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("aborts and maps an application timeout", async () => {
    const parse = vi.fn((_body: unknown, options?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });

    await expect(runBrain(request, { responses: { parse }, timeoutMs: 1 })).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
      retryable: true,
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("uses the application abort signal when the SDK rejection shape is unknown", async () => {
    const parse = vi.fn((_body: unknown, options?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new Error("opaque SDK wrapper"));
        });
      });
    });

    await expect(runBrain(request, { responses: { parse }, timeoutMs: 1 })).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
      retryable: true,
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("maps an SDK connection wrapper with a nested abort as a timeout", async () => {
    const nestedAbort = Object.assign(new Error("request aborted"), {
      name: "APIUserAbortError",
    });
    const wrapped = Object.assign(new Error("connection failed"), {
      name: "APIConnectionError",
      cause: nestedAbort,
    });
    const parse = vi.fn().mockRejectedValue(wrapped);

    await expect(runBrain(request, { responses: { parse }, timeoutMs: 10 })).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
      retryable: true,
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
