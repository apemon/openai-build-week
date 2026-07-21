import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readBrainHarnessConfiguration } from "../../src/agents/brain/harness-config";

function repositoryFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function exampleEnvironment(): Record<string, string> {
  return Object.fromEntries(
    repositoryFile(".env.example")
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

describe("persistent Codex hackathon documentation and safety boundary", () => {
  it("keeps the persistent adapter disabled by default and requires explicit acknowledgement", () => {
    const environment = exampleEnvironment();

    expect(environment).toMatchObject({
      OPENAI_API_KEY: "",
      LIVE_AI_ENABLED: "false",
      OPENAI_BRAIN_HARNESS: "one_shot",
      BRAIN_EXPERIMENTAL_HARNESSES_ENABLED: "false",
      BRAIN_PUBLIC_SEARCH_ENABLED: "false",
      OPENAI_CODEX_BRAIN_MODEL: "gpt-5.6-sol",
      CODEX_BRAIN_HOME: ".spec-grill-codex",
    });
    expect(Object.keys(environment).some((name) => name.startsWith("NEXT_PUBLIC_OPENAI"))).toBe(false);
    expect(() => readBrainHarnessConfiguration("live_route", {
      NODE_ENV: "test",
      OPENAI_BRAIN_HARNESS: "codex_sdk_persistent",
    } as NodeJS.ProcessEnv)).toThrow(/disabled/u);
    expect(readBrainHarnessConfiguration("live_route", {
      NODE_ENV: "test",
      OPENAI_BRAIN_HARNESS: "codex_sdk_persistent",
      BRAIN_EXPERIMENTAL_HARNESSES_ENABLED: "true",
    } as NodeJS.ProcessEnv)).toEqual({
      mode: "codex_sdk_persistent",
      publicSearchEnabled: false,
    });
  });

  it("documents local-only resume, cleanup, Prepared isolation, and non-claims", () => {
    const readme = repositoryFile("README.md");

    expect(readme).toContain("same machine");
    expect(readme).toContain("same browser tab");
    expect(readme).toContain("delete the exact directory configured by `CODEX_BRAIN_HOME`");
    expect(readme).toContain("Prepared Demo remains independent while this flag is enabled");
    expect(readme).toContain("No database, KV store, account system, daemon, or additional service is required");
    expect(readme).toContain("no `store:false`, Zero Data Retention, provider-cancellation, provider thread-deletion");
    expect(readme).toContain("not a production, hosted-persistence, authenticated-sharing, or privacy-retention design");
  });

  it("keeps the opt-in live smoke summary on a content-free allowlist", () => {
    const smoke = repositoryFile("scripts/live-brain-smoke.ts");
    const summary = smoke.match(/console\.log\(\s*JSON\.stringify\(\{([\s\S]*?)\}\),\s*\);/u)?.[1];
    expect(summary).toBeDefined();

    const emittedKeys = [...summary!.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)(?::|,)/gmu)]
      .map((match) => match[1]);
    expect(emittedKeys).toEqual([
      "validated",
      "threadResumed",
      "requestedModel",
      "actualModel",
      "revision",
      "repairAttempted",
      "hasNextPrompt",
      "lifecycleEvents",
    ]);
    expect(summary).toContain("hasNextPrompt: validated.output.nextPrompt !== null");
    expect(summary).not.toMatch(/apiKey|codexThreadId|requestBody|transcript|specification/u);
  });
});
