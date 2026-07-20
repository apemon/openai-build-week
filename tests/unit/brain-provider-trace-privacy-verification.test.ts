import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logBrainProviderTrace } from "@/agents/brain/debug-log";

const originalDebugSetting = process.env.BRAIN_DEBUG_LOGS;

afterEach(() => {
  if (originalDebugSetting === undefined) delete process.env.BRAIN_DEBUG_LOGS;
  else process.env.BRAIN_DEBUG_LOGS = originalDebugSetting;
  vi.restoreAllMocks();
});

describe("Brain provider trace privacy contract", () => {
  it.each([undefined, "false", "TRUE", "1", " true "])(
    "stays disabled for non-exact opt-in %j",
    (setting) => {
      if (setting === undefined) delete process.env.BRAIN_DEBUG_LOGS;
      else process.env.BRAIN_DEBUG_LOGS = setting;
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

      logBrainProviderTrace({
        requestId: "REQUEST-TRACE",
        operation: "answer",
        attempt: 1,
        call: "create",
        direction: "request",
        sequence: 0,
      });

      expect(info).not.toHaveBeenCalled();
    },
  );

  it("serializes only approved metadata even when a caller injects leaked-content sentinels", () => {
    process.env.BRAIN_DEBUG_LOGS = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const unsafeEvent = {
      requestId: "REQUEST-TRACE",
      operation: "answer",
      attempt: 2,
      call: "retrieve",
      direction: "response",
      sequence: 3,
      status: "completed",
      requestedModel: "gpt-5.6\nLEAKED_MODEL_METADATA",
      actualModel: "gpt-5.6",
      background: true,
      store: false,
      reasoningEffort: "medium",
      schemaName: "brain_model_output",
      elapsedMs: 42,
      outputItemCount: 2,
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 30,
      totalTokens: 60,
      errorCode: "INTERNAL_ERROR",
      hasProviderResponseId: true,
      input: "LEAKED_REQUEST_INPUT",
      body: { prompt: "LEAKED_REQUEST_BODY" },
      content: "LEAKED_CONTENT",
      output: "LEAKED_OUTPUT",
      output_parsed: "LEAKED_PARSED_OUTPUT",
      providerResponseId: "resp_LEAKED_PROVIDER_ID",
      id: "resp_LEAKED_ID",
      error: new Error("LEAKED_ERROR_MESSAGE"),
      validationText: "LEAKED_VALIDATION_TEXT",
      specification: "LEAKED_SPECIFICATION",
      transcript: "LEAKED_TRANSCRIPT",
      apiKey: "sk-LEAKED_CREDENTIAL",
      clientSecret: "LEAKED_CLIENT_SECRET",
    } as unknown as Parameters<typeof logBrainProviderTrace>[0];

    logBrainProviderTrace(unsafeEvent);

    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toBe("[spec-grill:brain:provider]");
    const serialized = String(info.mock.calls[0][1]);
    for (const sentinel of [
      "LEAKED_MODEL_METADATA",
      "LEAKED_REQUEST_INPUT",
      "LEAKED_REQUEST_BODY",
      "LEAKED_CONTENT",
      "LEAKED_OUTPUT",
      "LEAKED_PARSED_OUTPUT",
      "resp_LEAKED_PROVIDER_ID",
      "resp_LEAKED_ID",
      "LEAKED_ERROR_MESSAGE",
      "LEAKED_VALIDATION_TEXT",
      "LEAKED_SPECIFICATION",
      "LEAKED_TRANSCRIPT",
      "sk-LEAKED_CREDENTIAL",
      "LEAKED_CLIENT_SECRET",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }

    const payload = JSON.parse(serialized) as Record<string, unknown>;
    expect(payload).toMatchObject({
      requestId: "REQUEST-TRACE",
      operation: "answer",
      attempt: 2,
      call: "retrieve",
      direction: "response",
      sequence: 3,
      status: "completed",
      requestedModel: "unknown",
      actualModel: "gpt-5.6",
      background: true,
      store: false,
      reasoningEffort: "medium",
      schemaName: "brain_model_output",
      elapsedMs: 42,
      outputItemCount: 2,
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 30,
      totalTokens: 60,
      errorCode: "INTERNAL_ERROR",
      hasProviderResponseId: true,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "actualModel",
        "attempt",
        "background",
        "call",
        "direction",
        "elapsedMs",
        "errorCode",
        "hasProviderResponseId",
        "inputTokens",
        "operation",
        "outputItemCount",
        "outputTokens",
        "reasoningEffort",
        "reasoningTokens",
        "requestId",
        "requestedModel",
        "schemaName",
        "sequence",
        "status",
        "store",
        "timestamp",
        "totalTokens",
      ].sort(),
    );
  });

  it("keeps the flag and logger out of browser-owned modules", () => {
    const example = readFileSync(".env.example", "utf8");
    expect(example).toMatch(/^BRAIN_DEBUG_LOGS=false$/m);
    expect(example).not.toMatch(/^NEXT_PUBLIC_.*BRAIN_DEBUG_LOGS/m);

    const browserSources = [
      "src/app/SpecGrillApp.tsx",
      "src/app/brain-client.ts",
      "src/realtime/OpenAIWebRTCTransport.ts",
      "src/realtime/realtime-client.ts",
      "src/lib/session-checkpoint.ts",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(browserSources).not.toContain("BRAIN_DEBUG_LOGS");
    expect(browserSources).not.toContain("logBrainProviderTrace");
    expect(browserSources).not.toContain("[spec-grill:brain:provider]");
  });
});
