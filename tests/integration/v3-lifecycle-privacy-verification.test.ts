import { describe, expect, it, vi } from "vitest";

import { BrainStreamInterruptedError, parseBrainStream } from "@/app/brain-client";
import { brainLifecycleEventSchema } from "@/domain/v3-schemas";

const observedAt = "2026-07-21T00:00:00.000Z";
const expected = {
  requestId: "REQUEST-PRIVACY",
  actionId: "ACTION-PRIVACY",
  baseRevision: 4,
  cancelEpoch: 2,
};

function stream(lines: unknown[], chunkSize = 13): Response {
  const encoded = new TextEncoder().encode(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= encoded.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoded.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
}

function lifecycle(sequence: number, extra: Record<string, unknown> = {}) {
  return {
    type: "lifecycle",
    event: {
      schemaVersion: 1,
      ...expected,
      attempt: 1,
      sequence,
      observedAt,
      kind: sequence === 0 ? "request_accepted" : "provider_in_progress",
      ...extra,
    },
  };
}

describe("V3 lifecycle stream privacy boundary", () => {
  it("accepts only the strict content-free lifecycle allowlist across split chunks", async () => {
    const onLifecycle = vi.fn();
    await expect(parseBrainStream(stream([lifecycle(0), lifecycle(1)], 1), expected, onLifecycle))
      .rejects.toBeInstanceOf(BrainStreamInterruptedError);
    expect(onLifecycle.mock.calls.map(([event]) => brainLifecycleEventSchema.parse(event).sequence)).toEqual([0, 1]);
  });

  it.each([
    ["prompt", "LEAK_SENTINEL_PROMPT"],
    ["transcript", "LEAK_SENTINEL_TRANSCRIPT"],
    ["providerResponseId", "resp_LEAK_SENTINEL"],
    ["specification", { title: "LEAK_SENTINEL_SPECIFICATION" }],
    ["error", "LEAK_SENTINEL_RAW_ERROR"],
  ])("terminates a compromised stream carrying %s", async (field, value) => {
    const onLifecycle = vi.fn();
    await expect(parseBrainStream(stream([lifecycle(0, { [field]: value })]), expected, onLifecycle))
      .rejects.toThrow(/content-free validation/);
    expect(onLifecycle).not.toHaveBeenCalled();
  });

  it("rejects mismatched, duplicate, and post-cancellation identities locally", async () => {
    await expect(parseBrainStream(stream([lifecycle(0, { actionId: "ACTION-OLD" })]), expected, vi.fn()))
      .rejects.toThrow(/actionId/);
    await expect(parseBrainStream(stream([lifecycle(0), lifecycle(0)]), expected, vi.fn()))
      .rejects.toThrow(/sequence/);
    await expect(parseBrainStream(stream([lifecycle(0, { cancelEpoch: expected.cancelEpoch - 1 })]), expected, vi.fn()))
      .rejects.toThrow(/cancelEpoch/);
  });
});
