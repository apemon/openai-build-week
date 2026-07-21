import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zodTextFormat } from "openai/helpers/zod";

import type { BrainHarness, BrainHarnessEvent } from "@/domain/brain-harness";
import { brainLifecycleEventSchema, v3BrainModelOutputSchema } from "@/domain/v3-schemas";
import type {
  BrainLifecycleEvent,
  V3BrainModelOutput,
  V3BrainRequest,
  V3BrainResponse,
} from "@/domain/v3-schemas";

import { BrainRunError, compactValidationErrors } from "../retry-policy";
import { buildV3BrainInput, buildV3RepairInput, V3_BRAIN_SYSTEM_PROMPT } from "../v3-prompt";
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

export function buildCodexOutputSchema(): Record<string, unknown> {
  return zodTextFormat(v3BrainModelOutputSchema, "v3_brain_model_output").schema;
}

export function buildCodexEvaluationResponse(
  input: V3BrainRequest,
  output: V3BrainModelOutput,
  model: string,
  validatedAt: string,
  repairAttempted = false,
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
      repairAttempted,
    },
    output,
  };
}

class InvalidCodexModelOutputError extends BrainRunError {
  readonly rejectedOutput: V3BrainModelOutput | null;
  readonly validationErrors: string[];

  constructor(rejectedOutput: V3BrainModelOutput | null, validationErrors: readonly string[]) {
    super("INVALID_MODEL_OUTPUT", "Codex returned invalid structured output.", true);
    this.rejectedOutput = rejectedOutput;
    this.validationErrors = compactValidationErrors(validationErrors);
  }
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

async function validateCodexOutput(
  outputPath: string,
  input: V3BrainRequest,
): Promise<V3BrainModelOutput> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    throw new InvalidCodexModelOutputError(null, ["Structured output parsing failed."]);
  }
  const parsed = v3BrainModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new InvalidCodexModelOutputError(
      null,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`),
    );
  }
  const semantic = validateV3BrainOutput(input, parsed.data);
  if (!semantic.valid) throw new InvalidCodexModelOutputError(parsed.data, semantic.errors);
  return parsed.data;
}

function remainingTimeout(deadline: number, signal: AbortSignal): number {
  const remaining = deadline - Date.now();
  if (signal.aborted || remaining <= 0) {
    throw new BrainRunError("MODEL_TIMEOUT", "The local Codex evaluation timed out.", true);
  }
  return remaining;
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
    const lifecycle = (kind: BrainLifecycleEvent["kind"], attempt: 1 | 2) =>
      brainLifecycleEventSchema.parse({
        schemaVersion: 1,
        requestId: input.requestId,
        actionId: input.actionId,
        baseRevision: input.baseRevision,
        cancelEpoch: input.cancelEpoch,
        attempt,
        sequence: sequence++,
        observedAt: now().toISOString(),
        kind,
      });
    yield { type: "lifecycle", event: lifecycle("request_accepted", 1) };

    const root = await mkdtemp(join(tmpdir(), "spec-grill-codex-eval-"));
    const schemaPath = join(root, "output-schema.json");
    try {
      await mkdir(join(root, "codex-home"), { recursive: true });
      await mkdir(join(root, "tmp"), { recursive: true });
      await writeFile(schemaPath, JSON.stringify(buildCodexOutputSchema()), { mode: 0o600 });
      const deadline = Date.now() + (this.options.timeoutMs ?? 300_000);
      let attempt: 1 | 2 = 1;
      let repairAttempted = false;
      let prompt = `${V3_BRAIN_SYSTEM_PROMPT}\n\n${buildV3BrainInput(input)}`;
      let output: V3BrainModelOutput;

      while (true) {
        const outputPath = join(root, `output-attempt-${attempt}.json`);
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
        try {
          await executeCodex(this.options.executable ?? "codex", args, prompt, {
            cwd: root,
            env: safeEnvironment(root, this.options.apiKey),
            timeoutMs: remainingTimeout(deadline, signal),
            signal,
          });
        } catch (error) {
          yield { type: "lifecycle", event: lifecycle("provider_attempt_terminal", attempt) };
          if (error instanceof BrainRunError && error.code === "MODEL_TIMEOUT") {
            yield { type: "lifecycle", event: lifecycle("cancellation_requested", attempt) };
          }
          throw error;
        }
        yield { type: "lifecycle", event: lifecycle("provider_attempt_terminal", attempt) };
        yield { type: "lifecycle", event: lifecycle("validating_output", attempt) };

        try {
          output = await validateCodexOutput(outputPath, input);
          break;
        } catch (error) {
          if (!(error instanceof InvalidCodexModelOutputError)) throw error;
          if (attempt === 2) {
            throw new BrainRunError(
              "INVALID_MODEL_OUTPUT",
              "Codex returned invalid output after the bounded repair.",
              false,
            );
          }
          repairAttempted = true;
          attempt = 2;
          yield { type: "lifecycle", event: lifecycle("repair_started", attempt) };
          prompt = `${V3_BRAIN_SYSTEM_PROMPT}\n\n${buildV3RepairInput(
            input,
            error.rejectedOutput,
            error.validationErrors,
          )}`;
        }
      }

      yield {
        type: "result",
        response: buildCodexEvaluationResponse(
          input,
          output,
          this.options.model ?? "codex_ephemeral",
          now().toISOString(),
          repairAttempted,
        ),
      };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
