import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readBrainHarnessConfiguration } from "@/agents/brain/harness-config";
import { buildEvaluationRequest, syntheticEvaluationSessions } from "@/agents/brain/evaluation/dataset";
import { validateV3BrainRequest } from "@/agents/brain/v3-semantic-validator";

describe("V3 experimental harness policy", () => {
  it("ships 24 validated synthetic fixtures without captured Live-session markers", () => {
    expect(syntheticEvaluationSessions).toHaveLength(24);
    expect(new Set(syntheticEvaluationSessions.map((fixture) => fixture.id)).size).toBe(24);
    for (const fixture of syntheticEvaluationSessions) {
      expect(validateV3BrainRequest(buildEvaluationRequest(fixture)).valid).toBe(true);
      expect(JSON.stringify(fixture)).not.toMatch(/transcript|provider[_ -]?log|live session/i);
    }
  });

  it("defaults ordinary Live to one_shot with public search off and rejects codex_ephemeral", () => {
    expect(readBrainHarnessConfiguration("live_route", { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual({
      mode: "one_shot",
      publicSearchEnabled: false,
    });
    expect(() => readBrainHarnessConfiguration("live_route", {
      NODE_ENV: "test",
      OPENAI_BRAIN_HARNESS: "codex_ephemeral",
      BRAIN_EXPERIMENTAL_HARNESSES_ENABLED: "true",
    } as NodeJS.ProcessEnv)).toThrow(/ordinary Live route/);
  });

  it("keeps harness and search controls server-only with safe documented defaults", () => {
    const example = readFileSync(".env.example", "utf8");
    expect(example).toMatch(/^OPENAI_BRAIN_HARNESS=one_shot$/m);
    expect(example).toMatch(/^BRAIN_PUBLIC_SEARCH_ENABLED=false$/m);
    expect(example).not.toMatch(/^NEXT_PUBLIC_.*(?:HARNESS|SEARCH)/m);
  });
});
