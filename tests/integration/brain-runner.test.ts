import refusalFixture from "../fixtures/brain-refusal.json";
import validFixture from "../fixtures/brain-valid.json";
import { describe, expect, it, vi } from "vitest";

import { runBrain } from "@/agents/brain/run-brain";
import { BrainRunError } from "@/agents/brain/retry-policy";
import { brainModelOutputSchema, brainRequestSchema } from "@/domain/schemas";
import { createEmptyQuestionRoadmap, createInitialContextDigest, emptySpecification } from "@/domain/initial-state";

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
  confirmedContextDigest: createInitialContextDigest(new Date("2026-07-20T00:00:00.000Z")),
  questionRoadmap: createEmptyQuestionRoadmap(4),
  relevantSourceExcerpts: [],
  currentSpecification: emptySpecification,
  currentPrompt: null
});

function providerResponse(output: unknown = validFixture) {
  const parsedOutput = output === validFixture ? structuredClone(validFixture) : output;
  if (parsedOutput && typeof parsedOutput === "object" && "questionRoadmap" in parsedOutput && output === validFixture) {
    const roadmap = (parsedOutput as typeof validFixture).questionRoadmap;
    roadmap.baseRevision = 5;
    roadmap.dependencyVersion = "DEPENDENCY-5";
    if (roadmap.lookaheadApproval) {
      roadmap.lookaheadApproval.approvedAtRevision = 5;
      roadmap.lookaheadApproval.dependencyVersion = "DEPENDENCY-5";
    }
  }
  return {
    id: "resp_001",
    model: "gpt-5.6-2026-07-01",
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(parsedOutput),
          },
        ],
      },
    ],
  };
}

function responsesClient(
  create: (body: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>,
) {
  return {
    create,
    retrieve: vi.fn(),
    cancel: vi.fn().mockResolvedValue({ status: "cancelled" }),
  };
}

describe("runBrain", () => {
  it("uses GPT-5.6 Responses Structured Outputs and returns complete provenance", async () => {
    const create = vi.fn().mockResolvedValue(providerResponse());
    const responses = responsesClient(create);
    const result = await runBrain(request, {
      responses,
      now: () => new Date("2026-07-20T01:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6",
      reasoning: { effort: "medium" },
      background: true,
      store: false,
      text: { format: { type: "json_schema" } },
    });
    expect(responses.retrieve).not.toHaveBeenCalled();
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

  it("polls queued and in-progress background responses until completion", async () => {
    const create = vi.fn().mockResolvedValue({ id: "resp_001", status: "queued", output: [] });
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({ id: "resp_001", status: "in_progress", output: [] })
      .mockResolvedValueOnce(providerResponse());
    const responses = {
      create,
      retrieve,
      cancel: vi.fn().mockResolvedValue({ status: "cancelled" }),
    };

    await runBrain(request, { responses, pollIntervalMs: 0 });

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(retrieve).toHaveBeenNthCalledWith(
      1,
      "resp_001",
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(responses.cancel).not.toHaveBeenCalled();
  });

  it("makes exactly one repair attempt after semantic rejection", async () => {
    const invalid = brainModelOutputSchema.parse(structuredClone(validFixture));
    invalid.nextPrompt!.detailedQuestion = "Who pays? Who cancels?";
    const create = vi
      .fn()
      .mockResolvedValueOnce(providerResponse(invalid))
      .mockResolvedValueOnce(providerResponse());

    const result = await runBrain(request, { responses: responsesClient(create) });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].input[1].content).toContain("Validation errors");
    expect(result.provenance.repairAttempted).toBe(true);
  });

  it("makes exactly one repair attempt after structured output parsing fails", async () => {
    const malformedResponse = providerResponse();
    malformedResponse.output[0].content[0].text = "{";
    const create = vi
      .fn()
      .mockResolvedValueOnce(malformedResponse)
      .mockResolvedValueOnce(providerResponse());

    const result = await runBrain(request, { responses: responsesClient(create) });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].input[1].content).toContain("Structured output parsing failed.");
    expect(result.provenance.repairAttempted).toBe(true);
  });

  it("returns a typed error after a second invalid response", async () => {
    const invalid = brainModelOutputSchema.parse(structuredClone(validFixture));
    invalid.nextPrompt!.spokenQuestion = "Who pays? Who cancels?";
    const create = vi.fn().mockResolvedValue(providerResponse(invalid));

    await expect(runBrain(request, { responses: responsesClient(create) })).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
      retryable: true,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("maps repeated refusals without exposing refusal text", async () => {
    const create = vi.fn().mockResolvedValue(refusalFixture);

    await expect(runBrain(request, { responses: responsesClient(create) })).rejects.toEqual(
      expect.objectContaining<Partial<BrainRunError>>({
        code: "MODEL_REFUSAL",
        message: "The Brain refused the request.",
      }),
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("maps provider rate limiting", async () => {
    const create = vi.fn().mockRejectedValue({ status: 429 });

    await expect(runBrain(request, { responses: responsesClient(create) })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("aborts and maps an application timeout", async () => {
    const create = vi.fn().mockResolvedValue({ id: "resp_timeout", status: "queued", output: [] });
    const retrieve = vi.fn((_id: string, _query?: unknown, options?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    let cancelFinished = false;
    const cancel = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      cancelFinished = true;
      return { status: "cancelled" };
    });

    await expect(
      runBrain(request, {
        responses: { create, retrieve, cancel },
        timeoutMs: 1,
        pollIntervalMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
      retryable: true,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(
      "resp_timeout",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelFinished).toBe(true);
  });

  it("uses the application abort signal when the SDK rejection shape is unknown", async () => {
    const create = vi.fn().mockResolvedValue({ id: "resp_timeout", status: "queued", output: [] });
    const retrieve = vi.fn((_id: string, _query?: unknown, options?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new Error("opaque SDK wrapper"));
        });
      });
    });
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));

    await expect(
      runBrain(request, {
        responses: { create, retrieve, cancel },
        timeoutMs: 1,
        pollIntervalMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
      retryable: true,
    });
    expect(cancel).toHaveBeenCalledWith(
      "resp_timeout",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("cancels known provider work when the caller aborts", async () => {
    const externalController = new AbortController();
    const create = vi.fn().mockResolvedValue({ id: "resp_abandoned", status: "queued", output: [] });
    const retrieve = vi.fn((_id: string, _query?: unknown, options?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
        externalController.abort();
      });
    });
    let cancelFinished = false;
    const cancel = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      cancelFinished = true;
      return { status: "cancelled" };
    });

    await expect(
      runBrain(request, {
        responses: { create, retrieve, cancel },
        signal: externalController.signal,
        pollIntervalMs: 0,
      }),
    ).rejects.toMatchObject({ code: "MODEL_TIMEOUT", retryable: true });
    expect(cancel).toHaveBeenCalledWith(
      "resp_abandoned",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelFinished).toBe(true);
  });

  it("does not cancel when the application times out before receiving a response ID", async () => {
    const create = vi.fn((_body: unknown, options?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const responses = responsesClient(create);

    await expect(runBrain(request, { responses, timeoutMs: 1 })).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
      retryable: true,
    });
    expect(responses.cancel).not.toHaveBeenCalled();
  });

  it("rejects Live requests with Prepared Demo provenance before any provider call", async () => {
    const create = vi.fn();
    const invalidRequest = structuredClone(request);
    invalidRequest.confirmedContextDigest.sources[0].kind = "prepared_sample";

    await expect(runBrain(invalidRequest, { responses: responsesClient(create) })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("maps an SDK connection wrapper with a nested abort as a timeout", async () => {
    const nestedAbort = Object.assign(new Error("request aborted"), {
      name: "APIUserAbortError",
    });
    const wrapped = Object.assign(new Error("connection failed"), {
      name: "APIConnectionError",
      cause: nestedAbort,
    });
    const create = vi.fn().mockRejectedValue(wrapped);

    await expect(
      runBrain(request, { responses: responsesClient(create), timeoutMs: 10 }),
    ).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
      retryable: true,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
