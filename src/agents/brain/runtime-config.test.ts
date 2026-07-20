import { describe, expect, it } from "vitest";
import {
  BrainTimeoutConfigurationError,
  DEFAULT_BRAIN_TIMEOUT_MS,
  MAX_BRAIN_TIMEOUT_MS,
  MIN_BRAIN_TIMEOUT_MS,
  parseBrainTimeoutMs,
} from "./runtime-config";

describe("parseBrainTimeoutMs", () => {
  it("defaults to 120 seconds as a number", () => {
    expect(parseBrainTimeoutMs(undefined)).toBe(DEFAULT_BRAIN_TIMEOUT_MS);
    expect(typeof parseBrainTimeoutMs(undefined)).toBe("number");
  });

  it("accepts inclusive bounded integer values", () => {
    expect(parseBrainTimeoutMs(String(MIN_BRAIN_TIMEOUT_MS))).toBe(MIN_BRAIN_TIMEOUT_MS);
    expect(parseBrainTimeoutMs("120000")).toBe(120_000);
    expect(parseBrainTimeoutMs(String(MAX_BRAIN_TIMEOUT_MS))).toBe(MAX_BRAIN_TIMEOUT_MS);
  });

  it.each([
    String(MIN_BRAIN_TIMEOUT_MS - 1),
    String(MAX_BRAIN_TIMEOUT_MS + 1),
    "30000.5",
    "3e4",
    "+30000",
    " 30000",
    "30000 ",
    "030000",
    "not-a-number",
    "",
  ])("rejects invalid timeout value %j", (value) => {
    expect(() => parseBrainTimeoutMs(value)).toThrow(BrainTimeoutConfigurationError);
  });
});
