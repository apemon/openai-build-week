import { describe, expect, it, vi } from "vitest";

import { BrainStreamInterruptedError, parseBrainStream } from "./brain-client";

const now = "2026-07-21T00:00:00.000Z";
const expected = { requestId: "REQUEST-001", actionId: "ACTION-001", baseRevision: 0, cancelEpoch: 1 };
const lifecycle = { schemaVersion: 1, ...expected, attempt: 1, sequence: 1, observedAt: now, kind: "request_accepted" };

function response(lines: string[], chunks: number[] = []): Response {
  const encoded = new TextEncoder().encode(lines.join("\n"));
  let offset = 0;
  let chunkIndex = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= encoded.length) {
        controller.close();
        return;
      }
      const length = chunks[chunkIndex++] ?? encoded.length;
      controller.enqueue(encoded.slice(offset, offset + length));
      offset += length;
    },
  }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

describe("V3 Brain NDJSON client", () => {
  it("parses split lifecycle chunks and a terminal result", async () => {
    const result = {
      schemaVersion: 1,
      requestId: "REQUEST-001",
      baseRevision: 0,
      revision: 1,
      provenance: { source: "live_ai", agent: "brain", requestedModel: "gpt-5.6", actualModel: "gpt-5.6", validatedAt: now, repairAttempted: false },
      output: {
        specification: { title: "Spec", problemStatement: [], users: [], jobsToBeDone: [], functionalRequirements: [], nonFunctionalRequirements: [], assumptions: [], risks: [], edgeCases: [], openQuestions: [], blockers: [], acceptanceCriteria: [], nextActions: [], readiness: { status: "draft", evidence: [], blockerIds: [], openQuestionIds: [] }, externalEvidence: [] },
        questionRoadmap: { id: "ROADMAP-STATE", baseRevision: 1, dependencyVersion: "DEPENDENCY-1", items: [], currentDecisionItemId: null, completedItemIds: [], unresolvedDependencyIds: [], lookaheadApproval: null },
        nextPrompt: null,
        changeSummary: [],
        interviewWindow: { id: "WINDOW-001", approvedAtRevision: 1, dependencyVersion: "DEPENDENCY-1", independentOfOperation: "answer", applicationCap: 1, permits: [] },
        priorPermitDispositions: [],
      },
    };
    const onLifecycle = vi.fn();
    await expect(parseBrainStream(response([
      JSON.stringify({ type: "lifecycle", event: lifecycle }),
      JSON.stringify({ type: "result", response: result }),
    ], [7, 11, 3]), expected, onLifecycle)).resolves.toEqual(result);
    expect(onLifecycle).toHaveBeenCalledOnce();
  });

  it("treats EOF without a terminal envelope as an interruption", async () => {
    await expect(parseBrainStream(response([JSON.stringify({ type: "lifecycle", event: lifecycle })]), expected, vi.fn())).rejects.toBeInstanceOf(BrainStreamInterruptedError);
  });

  it("rejects content-bearing, out-of-order, and post-terminal envelopes", async () => {
    await expect(parseBrainStream(response([JSON.stringify({ type: "lifecycle", event: { ...lifecycle, transcript: "secret" } })]), expected, vi.fn())).rejects.toThrow(/content-free/);
    await expect(parseBrainStream(response([
      JSON.stringify({ type: "lifecycle", event: lifecycle }),
      JSON.stringify({ type: "lifecycle", event: lifecycle }),
    ]), expected, vi.fn())).rejects.toThrow(/sequence/);
  });
});
