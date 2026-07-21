import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateV3BrainRequest } from "../v3-semantic-validator";
import {
  buildCodexEvaluationResponse,
  buildCodexOutputSchema,
  CodexEphemeralBrainHarness,
} from "./codex-ephemeral";
import { buildEvaluationRequest, syntheticEvaluationSessions } from "./dataset";
import { evaluatePromotionGate, nearestRankP95, type CandidateGateMetrics } from "./gates";
import { scoreTechnicalOutput } from "./technical-scorer";
import { validV3BrainOutput, validV3BrainRequest } from "../v3-test-fixtures";
import { labelExperimentalEvaluationResponse } from "./runner";

function metrics(candidate: CandidateGateMetrics["candidate"]): CandidateGateMetrics {
  return {
    candidate,
    totalSessions: 24,
    questionWins: candidate === "one_shot" ? 0 : 15,
    questionNonTies: 20,
    specificationWins: candidate === "one_shot" ? 0 : 15,
    specificationNonTies: 20,
    firstPassValidityRate: 0.9,
    dependencyAccuracy: candidate === "one_shot" ? 0.8 : 0.86,
    acceptanceCriterionScore: candidate === "one_shot" ? 3.5 : 3.8,
    authorityViolationCount: 0,
    privacyViolationCount: 0,
    securityViolationCount: 0,
    provenanceViolationCount: 0,
    inventedDecisionCount: 0,
    p95LatencyMs: candidate === "one_shot" ? 1_000 : 1_900,
    cancellationVerified: true,
    lateOutputRejectionVerified: true,
    retentionVerified: true,
    sandboxVerified: true,
    packagingVerified: true,
    targetHostVerified: true,
    eligibleThreePermitJobs: 12,
    dependencyInvalidatedThreePermitJobs: 3,
  };
}

async function createMockCodex(outputs: unknown[]): Promise<{ executable: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "spec-grill-codex-mock-"));
  const executable = join(root, "mock-codex.cjs");
  await writeFile(join(root, "outputs.json"), JSON.stringify(outputs), { mode: 0o600 });
  await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const root = path.dirname(process.argv[1]);
const countPath = path.join(root, "count.txt");
const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, "utf8")) : 0;
const args = process.argv.slice(2);
const outputPath = args[args.indexOf("--output-last-message") + 1];
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  const next = count + 1;
  fs.writeFileSync(countPath, String(next));
  fs.writeFileSync(path.join(root, "prompt-" + next + ".txt"), prompt, { mode: 0o600 });
  const outputs = JSON.parse(fs.readFileSync(path.join(root, "outputs.json"), "utf8"));
  fs.writeFileSync(outputPath, JSON.stringify(outputs[count]), { mode: 0o600 });
});
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { executable, root };
}

describe("frozen Brain evaluation", () => {
  it("emits a Codex-compatible output schema without unsupported oneOf keywords", () => {
    const schema = buildCodexOutputSchema();
    const pending: unknown[] = [schema];

    while (pending.length > 0) {
      const value = pending.pop();
      if (Array.isArray(value)) {
        pending.push(...value);
      } else if (value !== null && typeof value === "object") {
        expect(Object.hasOwn(value, "oneOf")).toBe(false);
        pending.push(...Object.values(value));
      }
    }

    expect(schema).toMatchObject({ type: "object" });
  });

  it("contains at least 24 validated synthetic, category-diverse sessions", () => {
    expect(syntheticEvaluationSessions).toHaveLength(24);
    expect(new Set(syntheticEvaluationSessions.map((session) => session.category)).size).toBeGreaterThanOrEqual(10);
    for (const session of syntheticEvaluationSessions) {
      expect(validateV3BrainRequest(buildEvaluationRequest(session)).valid).toBe(true);
    }
  });

  it("computes the frozen promotion and three-permit gates", () => {
    expect(evaluatePromotionGate(metrics("responses_native"), metrics("one_shot"))).toEqual({
      promoted: true,
      disqualified: false,
      reasons: [],
    });
    const unsafe = metrics("codex_ephemeral");
    unsafe.inventedDecisionCount = 1;
    expect(evaluatePromotionGate(unsafe, metrics("one_shot"))).toMatchObject({ promoted: false, disqualified: true });
    expect(nearestRankP95([1, 2, 3, 4, 5])).toBe(5);
  });

  it("keeps Codex public search disabled when query/source caps cannot be enforced", async () => {
    const harness = new CodexEphemeralBrainHarness({
      apiKey: "not-used-because-search-is-rejected",
      publicSearchEnabled: true,
      searchProcessingAcknowledged: true,
    });
    const iterate = harness.run(buildEvaluationRequest(syntheticEvaluationSessions[0]), new AbortController().signal);
    await expect(iterate[Symbol.asyncIterator]().next()).rejects.toThrow(/cannot be enforced/);
  });

  it("repairs one semantically invalid Codex output with a bounded second attempt", async () => {
    const invalid = structuredClone(validV3BrainOutput());
    invalid.interviewWindow.applicationCap = 1;
    const { executable, root: testRoot } = await createMockCodex([invalid, validV3BrainOutput()]);

    try {
      const harness = new CodexEphemeralBrainHarness({
        apiKey: "local-test-key",
        executable,
        timeoutMs: 10_000,
        now: () => new Date("2026-07-21T00:00:00.000Z"),
      });
      const events = [];
      for await (const event of harness.run(validV3BrainRequest(), new AbortController().signal)) {
        events.push(event);
      }

      expect(events.filter((event) => event.type === "lifecycle").map(({ event }) => ({
        kind: event.kind,
        attempt: event.attempt,
        sequence: event.sequence,
      }))).toEqual([
        { kind: "request_accepted", attempt: 1, sequence: 0 },
        { kind: "provider_attempt_terminal", attempt: 1, sequence: 1 },
        { kind: "validating_output", attempt: 1, sequence: 2 },
        { kind: "repair_started", attempt: 2, sequence: 3 },
        { kind: "provider_attempt_terminal", attempt: 2, sequence: 4 },
        { kind: "validating_output", attempt: 2, sequence: 5 },
      ]);
      expect(events.find((event) => event.type === "result")?.response.provenance.repairAttempted).toBe(true);
      expect(await readFile(join(testRoot, "count.txt"), "utf8")).toBe("2");
      const repairPrompt = await readFile(join(testRoot, "prompt-2.txt"), "utf8");
      expect(repairPrompt).toContain("Repair the rejected candidate.");
      expect(repairPrompt).toContain("Correct every bounded validation failure literally");
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("sanitizes the terminal error when the bounded repair is still invalid", async () => {
    const invalid = structuredClone(validV3BrainOutput());
    invalid.interviewWindow.applicationCap = 1;
    const { executable, root: testRoot } = await createMockCodex([invalid, invalid]);

    try {
      const harness = new CodexEphemeralBrainHarness({
        apiKey: "local-test-key",
        executable,
        timeoutMs: 10_000,
      });
      let terminalError: unknown;
      try {
        for await (const event of harness.run(validV3BrainRequest(), new AbortController().signal)) {
          void event;
        }
      } catch (error) {
        terminalError = error;
      }

      expect(terminalError).toMatchObject({
        code: "INVALID_MODEL_OUTPUT",
        message: "Codex returned invalid output after the bounded repair.",
        retryable: false,
      });
      expect(Object.hasOwn(terminalError as object, "rejectedOutput")).toBe(false);
      expect(Object.hasOwn(terminalError as object, "validationErrors")).toBe(false);
      expect(JSON.stringify(terminalError)).not.toContain("applicationCap");
      expect(await readFile(join(testRoot, "count.txt"), "utf8")).toBe("2");
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("scores malformed candidate output as a deterministic technical failure", () => {
    expect(scoreTechnicalOutput(syntheticEvaluationSessions[0], { invalid: true })).toMatchObject({
      schemaValid: false,
      semanticValid: false,
      firstPassValid: false,
      evidenceAuthoritySafe: false,
    });
  });

  it("labels Codex output as local experimental evaluation, never ordinary Live", () => {
    const response = buildCodexEvaluationResponse(
      validV3BrainRequest(),
      validV3BrainOutput(),
      "codex_ephemeral",
      "2026-07-21T00:00:00.000Z",
    );
    expect(response.provenance).toEqual(expect.objectContaining({
      source: "experimental_evaluation",
      harnessMode: "codex_ephemeral",
      publicSearchEnabled: false,
      localOnly: true,
    }));
  });

  it("labels the one_shot baseline as experimental inside frozen evaluation artifacts", () => {
    const request = validV3BrainRequest();
    const response = labelExperimentalEvaluationResponse({
      schemaVersion: 1,
      requestId: request.requestId,
      baseRevision: request.baseRevision,
      revision: 1,
      provenance: {
        source: "live_ai",
        agent: "brain",
        requestedModel: "gpt-5.6",
        actualModel: "gpt-5.6",
        validatedAt: "2026-07-21T00:00:00.000Z",
        repairAttempted: false,
      },
      output: validV3BrainOutput(),
    }, "one_shot");
    expect(response.provenance).toMatchObject({
      source: "experimental_evaluation",
      harnessMode: "one_shot",
      localOnly: true,
    });
  });
});
