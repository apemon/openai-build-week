import { afterEach, describe, expect, it, vi } from "vitest";

import {
  logBrainProviderTrace,
  logBrainSubmission,
} from "@/agents/brain/debug-log";

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
      timeoutMs: 120_000,
      executionMode: "background",
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
      timeoutMs: 120_000,
      executionMode: "background",
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
      timeoutMs: 120_000,
      executionMode: "background",
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
        "executionMode",
        "event",
        "operation",
        "requestId",
        "requestedModel",
        "retryable",
        "status",
        "timestamp",
        "timeoutMs",
        "turnCount",
      ].sort(),
    );
  });

  it("strips unexpected runtime fields instead of trusting TypeScript callers", () => {
    process.env.BRAIN_DEBUG_LOGS = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logBrainSubmission({
      event: "submitted",
      requestId: "REQUEST-001",
      operation: "answer",
      baseRevision: 0,
      turnCount: 1,
      requestedModel: "gpt-5.6",
      timeoutMs: 300_000,
      executionMode: "background",
      prompt: "LEAK-SENTINEL-PROMPT",
      specification: "LEAK-SENTINEL-SPECIFICATION",
      apiKey: "LEAK-SENTINEL-KEY",
    } as Parameters<typeof logBrainSubmission>[0]);

    const serialized = String(info.mock.calls[0][1]);
    expect(serialized).not.toContain("LEAK-SENTINEL");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("specification");
    expect(serialized).not.toContain("apiKey");
  });
});

describe("Brain provider debug trace", () => {
  it("is silent unless explicitly enabled with lowercase true", () => {
    process.env.BRAIN_DEBUG_LOGS = "TRUE";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logBrainProviderTrace({
      requestId: "REQUEST-001",
      operation: "answer",
      attempt: 1,
      call: "create",
      direction: "request",
      sequence: 0,
    });

    expect(info).not.toHaveBeenCalled();
  });

  it("emits the approved provider metadata and strips payload-shaped fields", () => {
    process.env.BRAIN_DEBUG_LOGS = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logBrainProviderTrace({
      requestId: "REQUEST-001",
      operation: "answer",
      attempt: 1,
      call: "retrieve",
      direction: "response",
      sequence: 2,
      status: "completed",
      actualModel: "gpt-5.6-2026-07-01",
      elapsedMs: 47,
      outputItemCount: 1,
      inputTokens: 120,
      outputTokens: 80,
      reasoningTokens: 35,
      totalTokens: 200,
      hasProviderResponseId: true,
      responseId: "LEAK-SENTINEL-RESPONSE-ID",
      output: "LEAK-SENTINEL-OUTPUT",
      outputParsed: "LEAK-SENTINEL-PARSED",
      rawError: "LEAK-SENTINEL-ERROR",
    } as Parameters<typeof logBrainProviderTrace>[0]);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toBe("[spec-grill:brain:provider]");
    const serialized = String(info.mock.calls[0][1]);
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    expect(payload).toMatchObject({
      requestId: "REQUEST-001",
      operation: "answer",
      attempt: 1,
      call: "retrieve",
      direction: "response",
      sequence: 2,
      status: "completed",
      actualModel: "gpt-5.6-2026-07-01",
      elapsedMs: 47,
      outputItemCount: 1,
      inputTokens: 120,
      outputTokens: 80,
      reasoningTokens: 35,
      totalTokens: 200,
      hasProviderResponseId: true,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "actualModel",
        "attempt",
        "call",
        "direction",
        "elapsedMs",
        "hasProviderResponseId",
        "inputTokens",
        "operation",
        "outputItemCount",
        "outputTokens",
        "reasoningTokens",
        "requestId",
        "sequence",
        "status",
        "timestamp",
        "totalTokens",
      ].sort(),
    );
    expect(serialized).not.toContain("LEAK-SENTINEL");
    expect(serialized).not.toContain("responseId");
    expect(serialized).not.toContain("outputParsed");
    expect(serialized).not.toContain("rawError");
  });
});
