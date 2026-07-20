import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { BrainHarness, BrainHarnessEvent } from "@/domain/brain-harness";
import { brainLifecycleEventSchema, v3BrainModelOutputSchema } from "@/domain/v3-schemas";
import type { V3BrainModelOutput, V3BrainRequest, V3BrainResponse } from "@/domain/v3-schemas";

import { BrainRunError } from "../retry-policy";
import { buildV3BrainInput, V3_BRAIN_SYSTEM_PROMPT } from "../v3-prompt";
import { validateV3BrainOutput, validateV3BrainRequest } from "../v3-semantic-validator";

export interface CodexEphemeralOptions {
  executable?: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  publicSearchEnabled?: boolean;
  searchProcessingAcknowledged?: boolean;
  now?: () => Date;
}

export function buildCodexEvaluationResponse(
  input: V3BrainRequest,
  output: V3BrainModelOutput,
  model: string,
  validatedAt: string,
): V3BrainResponse {
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    baseRevision: input.baseRevision,
    revision: input.operation === "revalidate_restored" ? input.baseRevision : input.baseRevision + 1,
    provenance: {
      source: "experimental_evaluation",
      agent: "brain",
      harnessMode: "codex_ephemeral",
      publicSearchEnabled: false,
      localOnly: true,
      requestedModel: model,
      actualModel: model,
      validatedAt,
      repairAttempted: false,
    },
    output,
  };
}

function safeEnvironment(root: string, apiKey: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    HOME: root,
    CODEX_HOME: join(root, "codex-home"),
    CODEX_API_KEY: apiKey,
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: join(root, "tmp"),
  };
  if (process.platform === "win32") {
    environment.SystemRoot = process.env.SystemRoot;
    environment.ComSpec = process.env.ComSpec;
  }
  return environment;
}

function executeCodex(
  executable: string,
  args: string[],
  prompt: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal: AbortSignal },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "ignore", "ignore"],
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    const onAbort = () => child.kill("SIGTERM");
    options.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", () => {
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", onAbort);
      reject(new BrainRunError("INTERNAL_ERROR", "The local Codex evaluation failed.", true));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else reject(new BrainRunError(
        timedOut || options.signal.aborted ? "MODEL_TIMEOUT" : "INTERNAL_ERROR",
        timedOut || options.signal.aborted
          ? "The local Codex evaluation timed out."
          : "The local Codex evaluation failed.",
        true,
      ));
    });
    child.stdin.on("error", () => {
      // Process exit reports the bounded failure without exposing prompt bytes.
    });
    child.stdin.end(prompt);
  });
}

export class CodexEphemeralBrainHarness implements BrainHarness {
  constructor(private readonly options: CodexEphemeralOptions) {}

  async *run(input: V3BrainRequest, signal: AbortSignal): AsyncIterable<BrainHarnessEvent> {
    if (!validateV3BrainRequest(input).valid) {
      throw new BrainRunError("INVALID_REQUEST", "The Codex evaluation input is invalid.", false);
    }
    if (!this.options.apiKey) throw new BrainRunError("INVALID_REQUEST", "Local Codex evaluation requires explicit authentication.", false);
    if (this.options.publicSearchEnabled) {
      // The current CLI exposes search enablement but not the V3 five-query/five-source
      // enforcement boundary, so controlled search remains disabled.
      throw new BrainRunError(
        "INVALID_REQUEST",
        this.options.searchProcessingAcknowledged
          ? "Controlled Codex search is unavailable because query/source caps cannot be enforced."
          : "Search processing acknowledgement is required.",
        false,
      );
    }

    const now = this.options.now ?? (() => new Date());
    let sequence = 0;
    const lifecycle = (kind: "request_accepted" | "provider_attempt_terminal" | "validating_output") =>
      brainLifecycleEventSchema.parse({
        schemaVersion: 1,
        requestId: input.requestId,
        actionId: input.actionId,
        baseRevision: input.baseRevision,
        cancelEpoch: input.cancelEpoch,
        attempt: 1,
        sequence: sequence++,
        observedAt: now().toISOString(),
        kind,
      });
    yield { type: "lifecycle", event: lifecycle("request_accepted") };

    const root = await mkdtemp(join(tmpdir(), "spec-grill-codex-eval-"));
    const schemaPath = join(root, "output-schema.json");
    const outputPath = join(root, "output.json");
    try {
      await mkdir(join(root, "codex-home"), { recursive: true });
      await mkdir(join(root, "tmp"), { recursive: true });
      await writeFile(schemaPath, JSON.stringify(z.toJSONSchema(v3BrainModelOutputSchema)), { mode: 0o600 });
      const prompt = `${V3_BRAIN_SYSTEM_PROMPT}\n\n${buildV3BrainInput(input)}`;
      const args = [
        "exec",
        "--ephemeral",
        "--sandbox", "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "-c", 'web_search="disabled"',
        "--output-schema", schemaPath,
        "--output-last-message", outputPath,
      ];
      if (this.options.model) args.push("--model", this.options.model);
      args.push("-");
      await executeCodex(this.options.executable ?? "codex", args, prompt, {
          cwd: root,
          env: safeEnvironment(root, this.options.apiKey),
          timeoutMs: this.options.timeoutMs ?? 300_000,
          signal,
      });
      yield { type: "lifecycle", event: lifecycle("provider_attempt_terminal") };
      yield { type: "lifecycle", event: lifecycle("validating_output") };
      const parsed = v3BrainModelOutputSchema.safeParse(JSON.parse(await readFile(outputPath, "utf8")));
      if (!parsed.success) throw new BrainRunError("INVALID_MODEL_OUTPUT", "Codex returned invalid structured output.", false);
      const semantic = validateV3BrainOutput(input, parsed.data);
      if (!semantic.valid) throw new BrainRunError("INVALID_MODEL_OUTPUT", "Codex returned invalid semantic output.", false);
      yield {
        type: "result",
        response: buildCodexEvaluationResponse(
          input,
          parsed.data,
          this.options.model ?? "codex_ephemeral",
          now().toISOString(),
        ),
      };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
