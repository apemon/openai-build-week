import { describe, expect, it } from "vitest";

import { mapProviderError } from "@/agents/brain/retry-policy";

describe("Brain provider error mapping", () => {
  it.each([
    [401, "INTERNAL_ERROR", false, "not authorized"],
    [403, "INTERNAL_ERROR", false, "not authorized"],
    [404, "INVALID_REQUEST", false, "model is unavailable"],
    [400, "INVALID_REQUEST", false, "rejected the configured Brain request"],
  ] as const)("maps provider status %s without exposing raw provider text", (status, code, retryable, message) => {
    const mapped = mapProviderError({ status, message: "sensitive provider response" });

    expect(mapped).toMatchObject({ code, retryable });
    expect(mapped.message).toContain(message);
    expect(mapped.message).not.toContain("sensitive provider response");
  });
});
