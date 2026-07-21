import { describe, expect, it } from "vitest";

import { readBrainHarnessConfiguration } from "./harness-config";

describe("Brain harness server configuration", () => {
  it("defaults to one_shot with public search disabled", () => {
    expect(readBrainHarnessConfiguration("live_route", { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual({
      mode: "one_shot",
      publicSearchEnabled: false,
    });
  });

  it("rejects codex_ephemeral on the ordinary Live route even when experiments are enabled", () => {
    expect(() => readBrainHarnessConfiguration("live_route", {
      NODE_ENV: "test",
      OPENAI_BRAIN_HARNESS: "codex_ephemeral",
      BRAIN_EXPERIMENTAL_HARNESSES_ENABLED: "true",
    } as NodeJS.ProcessEnv)).toThrow(/ordinary Live route/);
  });

  it("rejects incompatible public-search combinations", () => {
    expect(() => readBrainHarnessConfiguration("local_evaluation", {
      NODE_ENV: "test",
      OPENAI_BRAIN_HARNESS: "one_shot",
      BRAIN_PUBLIC_SEARCH_ENABLED: "true",
    } as NodeJS.ProcessEnv)).toThrow(/Public search/);
  });

  it("keeps responses_native out of the ordinary Live route", () => {
    expect(() => readBrainHarnessConfiguration("live_route", {
      NODE_ENV: "test",
      OPENAI_BRAIN_HARNESS: "responses_native",
      BRAIN_EXPERIMENTAL_HARNESSES_ENABLED: "true",
    } as NodeJS.ProcessEnv)).toThrow(/ordinary Live route/);
  });

  it("allows persistent Codex on the ordinary Live route only behind the experimental flag", () => {
    expect(() => readBrainHarnessConfiguration("live_route", {
      NODE_ENV: "test",
      OPENAI_BRAIN_HARNESS: "codex_sdk_persistent",
    } as NodeJS.ProcessEnv)).toThrow(/disabled/);

    expect(readBrainHarnessConfiguration("live_route", {
      NODE_ENV: "test",
      OPENAI_BRAIN_HARNESS: "codex_sdk_persistent",
      BRAIN_EXPERIMENTAL_HARNESSES_ENABLED: "true",
    } as NodeJS.ProcessEnv)).toEqual({
      mode: "codex_sdk_persistent",
      publicSearchEnabled: false,
    });
  });
});
