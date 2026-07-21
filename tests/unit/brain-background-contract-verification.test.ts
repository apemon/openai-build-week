import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";

import {
  BRAIN_POLL_INTERVAL_MS,
  BRAIN_TIMEOUT_MS,
} from "@/agents/brain/retry-policy";
import {
  DEFAULT_BRAIN_TIMEOUT_MS,
  MAX_BRAIN_TIMEOUT_MS,
  MIN_BRAIN_TIMEOUT_MS,
} from "@/agents/brain/runtime-config";
import { externalEvidenceSchema, v3BrainModelOutputSchema } from "@/domain/v3-schemas";

describe("background Brain contract verification", () => {
  it("keeps the five-minute per-attempt default, bounded override, polling interval, and explicit route duration visible", () => {
    expect(DEFAULT_BRAIN_TIMEOUT_MS).toBe(300_000);
    expect(BRAIN_TIMEOUT_MS).toBe(DEFAULT_BRAIN_TIMEOUT_MS);
    expect(MIN_BRAIN_TIMEOUT_MS).toBe(30_000);
    expect(MAX_BRAIN_TIMEOUT_MS).toBe(300_000);
    expect(BRAIN_POLL_INTERVAL_MS).toBeGreaterThan(0);

    const route = readFileSync("src/app/api/brain/route.ts", "utf8");
    expect(route).toContain("export const maxDuration = 620");
    expect(route).toContain("OPENAI_BRAIN_TIMEOUT_MS");
    expect(route).toMatch(/createLiveBrainHarness\(configuration,\s*\{\s*timeoutMs\s*\}\)/);

    const example = readFileSync(".env.example", "utf8");
    expect(example).toMatch(/^OPENAI_BRAIN_TIMEOUT_MS=300000$/m);
  });

  it("creates a non-stored background response, polls only active states, and attempts cancellation", () => {
    const runner = readFileSync("src/agents/brain/run-v3-brain.ts", "utf8");
    expect(runner).toMatch(/background:\s*true/);
    expect(runner).toMatch(/store:\s*false/);
    expect(runner).toContain('responseStatus(response) === "queued"');
    expect(runner).toContain('responseStatus(response) === "in_progress"');
    expect(runner).toContain("responses.retrieve(id");
    expect(runner).toMatch(/bestEffortCancel\(responses,\s*id\)/);
  });

  it("documents temporary background retention and the bounded local live verification", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("https://developers.openai.com/api/docs/guides/background");
    expect(readme).toMatch(/temporarily stored[\s\S]{0,100}roughly ten minutes/);
    expect(readme).toContain("Automated verification uses mocked provider boundaries");
    expect(readme).toContain("opt-in local smoke validated a live requested `gpt-5.6`");
    expect(readme).toContain("Advanced voice/media races, deployment, and provider-retention verification are not claimed");
  });

  it("keeps HTTPS evidence validation without emitting an unsupported uri format", () => {
    const providerSchema = zodTextFormat(v3BrainModelOutputSchema, "v3_brain_model_output");
    expect(JSON.stringify(providerSchema)).not.toContain('"format":"uri"');
    expect(externalEvidenceSchema.safeParse({
      id: "EVID-001",
      title: "Public reference",
      url: "https://example.com/reference",
      retrievedAt: "2026-07-21T00:00:00.000Z",
      informedTargets: [{ kind: "specification_item", itemId: "PROB-001" }],
    }).success).toBe(true);
    expect(externalEvidenceSchema.safeParse({
      id: "EVID-001",
      title: "Insecure reference",
      url: "http://example.com/reference",
      retrievedAt: "2026-07-21T00:00:00.000Z",
      informedTargets: [{ kind: "specification_item", itemId: "PROB-001" }],
    }).success).toBe(false);
  });
});
