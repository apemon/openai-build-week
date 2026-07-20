import { describe, expect, it } from "vitest";

import type { BrainHarness } from "@/domain/brain-harness";
import type { BrainStreamEnvelope } from "@/domain/v3-schemas";

import { createBrainNdjsonStream, encodeBrainStreamEnvelope } from "./ndjson-stream";
import { validV3BrainOutput, validV3BrainRequest } from "./v3-test-fixtures";

function responseEnvelope(): Extract<BrainStreamEnvelope, { type: "result" }> {
  const request = validV3BrainRequest();
  return {
    type: "result",
    response: {
      schemaVersion: 1,
      requestId: request.requestId,
      baseRevision: request.baseRevision,
      revision: 1,
      provenance: {
        source: "live_ai",
        agent: "brain",
        requestedModel: "gpt-5.6",
        actualModel: "gpt-5.6",
        validatedAt: "2026-07-21T00:00:01.000Z",
        repairAttempted: false,
      },
      output: validV3BrainOutput(),
    },
  };
}

async function readInPieces(stream: ReadableStream<Uint8Array>, splitAt: number): Promise<BrainStreamEnvelope[]> {
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const pieces = [bytes.slice(0, splitAt), bytes.slice(splitAt)];
  const text = pieces.map((piece) => new TextDecoder().decode(piece, { stream: true })).join("");
  return text.trim().split("\n").map((line) => JSON.parse(line) as BrainStreamEnvelope);
}

describe("Brain NDJSON stream", () => {
  it("survives partial and coalesced chunk boundaries and closes with one result", async () => {
    const request = validV3BrainRequest();
    const harness: BrainHarness = {
      async *run() {
        yield {
          type: "lifecycle",
          event: {
            schemaVersion: 1,
            requestId: request.requestId,
            actionId: request.actionId,
            baseRevision: request.baseRevision,
            cancelEpoch: request.cancelEpoch,
            attempt: 1,
            sequence: 0,
            observedAt: "2026-07-21T00:00:00.000Z",
            kind: "request_accepted",
          },
        };
        yield responseEnvelope();
      },
    };
    const envelopes = await readInPieces(createBrainNdjsonStream(request, harness, new AbortController().signal), 7);
    expect(envelopes.map((envelope) => envelope.type)).toEqual(["lifecycle", "result"]);
  });

  it("turns EOF before a terminal result into exactly one terminal error", async () => {
    const request = validV3BrainRequest();
    const harness: BrainHarness = { async *run() { return; yield undefined as never; } };
    const envelopes = await readInPieces(createBrainNdjsonStream(request, harness, new AbortController().signal), 1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].type).toBe("error");
  });

  it("strictly rejects content-bearing lifecycle fields", () => {
    const request = validV3BrainRequest();
    expect(() => encodeBrainStreamEnvelope({
      type: "lifecycle",
      event: {
        schemaVersion: 1,
        requestId: request.requestId,
        actionId: request.actionId,
        baseRevision: request.baseRevision,
        cancelEpoch: request.cancelEpoch,
        attempt: 1,
        sequence: 0,
        observedAt: "2026-07-21T00:00:00.000Z",
        kind: "request_accepted",
        prompt: "LEAK_SENTINEL_PROMPT",
      },
    } as unknown as BrainStreamEnvelope)).toThrow();
  });
});

