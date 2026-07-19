import { afterEach, describe, expect, it, vi } from "vitest";

import { logBrainSubmission } from "@/agents/brain/debug-log";

const originalDebugSetting = process.env.BRAIN_DEBUG_LOGS;

afterEach(() => {
  if (originalDebugSetting === undefined) delete process.env.BRAIN_DEBUG_LOGS;
  else process.env.BRAIN_DEBUG_LOGS = originalDebugSetting;
  vi.restoreAllMocks();
});

describe("Brain submission debug log", () => {
  it("is silent by default", () => {
    delete process.env.BRAIN_DEBUG_LOGS;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logBrainSubmission({
      event: "submitted",
      requestId: "REQUEST-001",
      operation: "answer",
      baseRevision: 0,
      turnCount: 1,
      requestedModel: "gpt-5.6",
    });

    expect(info).not.toHaveBeenCalled();
  });

  it("emits only the approved operational metadata", () => {
    process.env.BRAIN_DEBUG_LOGS = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logBrainSubmission({
      event: "failed",
      requestId: "REQUEST-001",
      operation: "answer",
      baseRevision: 3,
      turnCount: 4,
      requestedModel: "gpt-5.6",
      elapsedMs: 30_001,
      errorCode: "MODEL_TIMEOUT",
      retryable: true,
      status: 504,
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toBe("[spec-grill:brain]");
    const payload = JSON.parse(String(info.mock.calls[0][1])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "failed",
      requestId: "REQUEST-001",
      operation: "answer",
      baseRevision: 3,
      turnCount: 4,
      requestedModel: "gpt-5.6",
      elapsedMs: 30_001,
      errorCode: "MODEL_TIMEOUT",
      retryable: true,
      status: 504,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "baseRevision",
        "elapsedMs",
        "errorCode",
        "event",
        "operation",
        "requestId",
        "requestedModel",
        "retryable",
        "status",
        "timestamp",
        "turnCount",
      ].sort(),
    );
  });
});
