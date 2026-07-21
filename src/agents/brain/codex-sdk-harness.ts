import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";

import { zodTextFormat } from "openai/helpers/zod";

import type { BrainHarness, BrainHarnessEvent } from "@/domain/brain-harness";
import {
  brainLifecycleEventSchema,
  codexThreadIdSchema,
  v3BrainModelOutputSchema,
} from "@/domain/v3-schemas";
import type {
  BrainLifecycleEvent,
  V3BrainModelOutput,
  V3BrainRequest,
  V3BrainResponse,
} from "@/domain/v3-schemas";

import { BRAIN_TIMEOUT_MS, BrainRunError, compactValidationErrors } from "./retry-policy";
import { buildV3BrainInput, buildV3RepairInput, V3_BRAIN_SYSTEM_PROMPT } from "./v3-prompt";
import { validateV3BrainOutput, validateV3BrainRequest } from "./v3-semantic-validator";

const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";
const DEFAULT_STORAGE_DIRECTORY = ".spec-grill-codex";
const MAX_CODEX_OUTPUT_BYTES = 1_500_000;

type CodexThreadOptions = {
  model: string;
  sandboxMode: "read-only";
  workingDirectory: string;
  skipGitRepoCheck: true;
  modelReasoningEffort: "medium";
  networkAccessEnabled: false;
  webSearchMode: "disabled";
  approvalPolicy: "never";
};

export interface CodexSdkThreadLike {
  readonly id: string | null;
  runStreamed(
    input: string,
    options: { outputSchema: unknown; signal: AbortSignal },
  ): Promise<{ events: AsyncIterable<unknown> }>;
}

export interface CodexSdkClientLike {
  startThread(options: CodexThreadOptions): CodexSdkThreadLike;
  resumeThread(id: string, options: CodexThreadOptions): CodexSdkThreadLike;
}

export interface CodexSdkClientConstructionOptions {
  apiKey: string;
  env: Record<string, string>;
}

export interface CodexSdkBrainHarnessOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  storageRoot?: string;
  now?: () => Date;
  clientFactory?: (options: CodexSdkClientConstructionOptions) => CodexSdkClientLike;
}

type CandidateValidation =
  | { valid: true; output: V3BrainModelOutput }
  | {
      valid: false;
      rejectedOutput: V3BrainModelOutput | null;
      errors: string[];
      failureKind: "output_size" | "json_parse" | "schema" | "semantic";
    };

const activeThreadKeys = new Set<string>();
const quarantinedThreadIds = new Set<string>();

/** Test-only reset for process-local coordination state. */
export function resetCodexSdkHarnessStateForTests(): void {
  activeThreadKeys.clear();
  quarantinedThreadIds.clear();
}

function buildOutputSchema(): Record<string, unknown> {
  return zodTextFormat(v3BrainModelOutputSchema, "v3_brain_model_output").schema;
}

function safeEnvironment(storageRoot: string, apiKey: string): CodexSdkClientConstructionOptions {
  const userHome = join(storageRoot, "user-home");
  const codexHome = join(storageRoot, "codex-home");
  const temporaryDirectory = join(storageRoot, "tmp");
  const env: Record<string, string> = {
    NODE_ENV: "production",
    HOME: userHome,
    CODEX_HOME: codexHome,
    PATH: process.env.PATH ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: temporaryDirectory,
  };
  if (process.platform === "win32") {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (process.env.ComSpec) env.ComSpec = process.env.ComSpec;
  }
  return { apiKey, env };
}

async function prepareStorage(storageRoot: string): Promise<void> {
  await Promise.all([
    mkdir(join(storageRoot, "user-home"), { recursive: true, mode: 0o700 }),
    mkdir(join(storageRoot, "codex-home"), { recursive: true, mode: 0o700 }),
    mkdir(join(storageRoot, "tmp"), { recursive: true, mode: 0o700 }),
  ]);
}

async function validateStorageRoot(storageRoot: string): Promise<void> {
  const projectRoot = process.cwd();
  const forbiddenRoots = new Set([
    parse(storageRoot).root,
    projectRoot,
    homedir(),
    ...(process.env.HOME ? [resolve(/*turbopackIgnore: true*/ process.env.HOME)] : []),
  ]);
  if (forbiddenRoots.has(storageRoot)) {
    throw new BrainRunError("INVALID_REQUEST", "The configured Codex Brain storage directory is unsafe.", false);
  }
  try {
    const existing = await stat(storageRoot);
    if (!existing.isDirectory()) {
      throw new BrainRunError(
        "INVALID_REQUEST",
        "The configured Codex Brain storage path is not a directory.",
        false,
      );
    }
  } catch (error) {
    if (error instanceof BrainRunError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new BrainRunError("INVALID_REQUEST", "The configured Codex Brain storage path is unavailable.", false);
    }
  }
}

function validateCandidate(raw: string, request: V3BrainRequest): CandidateValidation {
  if (new TextEncoder().encode(raw).byteLength > MAX_CODEX_OUTPUT_BYTES) {
    return {
      valid: false,
      rejectedOutput: null,
      errors: ["Structured output exceeded its safe bound."],
      failureKind: "output_size",
    };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return {
      valid: false,
      rejectedOutput: null,
      errors: ["Structured output parsing failed."],
      failureKind: "json_parse",
    };
  }
  const parsed = v3BrainModelOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      valid: false,
      rejectedOutput: null,
      errors: compactValidationErrors(
        parsed.error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`),
      ),
      failureKind: "schema",
    };
  }
  const semantic = validateV3BrainOutput(request, parsed.data);
  if (!semantic.valid) {
    return {
      valid: false,
      rejectedOutput: parsed.data,
      errors: compactValidationErrors(semantic.errors),
      failureKind: "semantic",
    };
  }
  return { valid: true, output: parsed.data };
}

function validationCategories(errors: readonly string[]): string[] {
  const categories = new Set<string>();
  for (const error of errors) {
    if (/source|provenance|grounded|confirmed evidence|unsupported constraint/i.test(error)) categories.add("provenance");
    if (/roadmap|dependency|current decision/i.test(error)) categories.add("roadmap");
    if (/interview window|permit|disposition/i.test(error)) categories.add("interview_window");
    if (/nextprompt|spoken|detailed|question/i.test(error)) categories.add("prompt");
    if (/readiness|blocker|open question/i.test(error)) categories.add("readiness");
    if (/external evidence|evidence/i.test(error)) categories.add("external_evidence");
    if (/\bid\b|duplicate|stable/i.test(error)) categories.add("identity");
    if (/criterion|requirement/i.test(error)) categories.add("acceptance_criteria");
  }
  return [...categories].sort();
}

function logValidationFailure(
  input: V3BrainRequest,
  attempt: 1 | 2,
  validation: Extract<CandidateValidation, { valid: false }>,
): void {
  if (process.env.BRAIN_DEBUG_LOGS !== "true") return;
  console.info("[spec-grill:codex]", JSON.stringify({
    event: "validation_failed",
    requestId: input.requestId,
    operation: input.operation,
    baseRevision: input.baseRevision,
    attempt,
    failureKind: validation.failureKind,
    errorCount: validation.errors.length,
    categories: validation.failureKind === "semantic" ? validationCategories(validation.errors) : [],
  }));
}

function eventType(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

function threadIdFromEvent(value: unknown): string | null {
  if (eventType(value) !== "thread.started") return null;
  const threadId = (value as { thread_id?: unknown }).thread_id;
  const parsed = codexThreadIdSchema.safeParse(threadId);
  return parsed.success ? parsed.data : null;
}

function agentMessageFromEvent(value: unknown): string | null {
  if (eventType(value) !== "item.completed") return null;
  const item = (value as { item?: unknown }).item;
  if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "agent_message") return null;
  const text = (item as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function buildResponse(
  input: V3BrainRequest,
  output: V3BrainModelOutput,
  threadId: string,
  model: string,
  repairAttempted: boolean,
  validatedAt: string,
): V3BrainResponse {
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    baseRevision: input.baseRevision,
    revision: input.operation === "revalidate_restored" ? input.baseRevision : input.baseRevision + 1,
    codexThreadId: threadId,
    provenance: {
      source: "live_ai",
      agent: "brain",
      requestedModel: model,
      actualModel: `${model}:unverified`,
      validatedAt,
      repairAttempted,
    },
    output,
  };
}

function quarantine(threadId: string | null): void {
  if (threadId) quarantinedThreadIds.add(threadId);
}

export class CodexSdkBrainHarness implements BrainHarness {
  constructor(private readonly options: CodexSdkBrainHarnessOptions) {}

  async *run(input: V3BrainRequest, externalSignal: AbortSignal): AsyncIterable<BrainHarnessEvent> {
    if (!validateV3BrainRequest(input).valid) {
      throw new BrainRunError("INVALID_REQUEST", "The Codex Brain input is invalid.", false);
    }
    if (!this.options.apiKey) {
      throw new BrainRunError("INVALID_REQUEST", "The Codex Brain requires explicit authentication.", false);
    }
    const requestedThreadId = input.codexThreadId ?? null;
    if (requestedThreadId && quarantinedThreadIds.has(requestedThreadId)) {
      throw new BrainRunError("INVALID_REQUEST", "The Codex Brain thread is quarantined.", false);
    }
    const lockKey = requestedThreadId ?? `new:${input.sessionId}`;
    if (activeThreadKeys.has(lockKey)) {
      throw new BrainRunError("RATE_LIMITED", "The Codex Brain thread already has an active turn.", true);
    }
    activeThreadKeys.add(lockKey);

    const now = this.options.now ?? (() => new Date());
    const model = this.options.model ?? process.env.OPENAI_CODEX_BRAIN_MODEL ?? DEFAULT_CODEX_MODEL;
    if (!model || model.length > 80) {
      activeThreadKeys.delete(lockKey);
      throw new BrainRunError("INVALID_REQUEST", "The configured Codex Brain model is invalid.", false);
    }
    const storageRoot = resolve(/*turbopackIgnore: true*/
      this.options.storageRoot
        ?? process.env.CODEX_BRAIN_HOME
        ?? join(/*turbopackIgnore: true*/ process.cwd(), DEFAULT_STORAGE_DIRECTORY),
    );
    const actionController = new AbortController();
    let actionTimedOut = false;
    const onExternalAbort = () => actionController.abort();
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    if (externalSignal.aborted) actionController.abort();
    const timeout = setTimeout(() => {
      actionTimedOut = true;
      actionController.abort();
    }, this.options.timeoutMs ?? BRAIN_TIMEOUT_MS);

    let sequence = 0;
    let knownThreadId = requestedThreadId;
    let workspace: string | null = null;
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

    try {
      yield { type: "lifecycle", event: lifecycle("request_accepted", 1) };
      await validateStorageRoot(storageRoot);
      await prepareStorage(storageRoot);
      workspace = await mkdtemp(join(tmpdir(), "spec-grill-codex-sdk-work-"));
      const clientOptions = safeEnvironment(storageRoot, this.options.apiKey);
      const client = this.options.clientFactory
        ? this.options.clientFactory(clientOptions)
        : new (await import("@openai/codex-sdk")).Codex(clientOptions) as unknown as CodexSdkClientLike;
      const threadOptions: CodexThreadOptions = {
        model,
        sandboxMode: "read-only",
        workingDirectory: workspace,
        skipGitRepoCheck: true,
        modelReasoningEffort: "medium",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        approvalPolicy: "never",
      };
      const thread = requestedThreadId
        ? client.resumeThread(requestedThreadId, threadOptions)
        : client.startThread(threadOptions);
      let attempt: 1 | 2 = 1;
      let repairAttempted = false;
      let prompt = `${V3_BRAIN_SYSTEM_PROMPT}\n\n${buildV3BrainInput(input)}`;
      let output: V3BrainModelOutput;

      while (true) {
        let finalResponse = "";
        let turnCompleted = false;
        let providerInProgressEmitted = false;
        try {
          const streamed = await thread.runStreamed(prompt, {
            outputSchema: buildOutputSchema(),
            signal: actionController.signal,
          });
          for await (const event of streamed.events) {
            const type = eventType(event);
            if (type === "thread.started") {
              const eventThreadId = threadIdFromEvent(event);
              if (!eventThreadId || (requestedThreadId && eventThreadId !== requestedThreadId)) {
                throw new Error("invalid-thread-identity");
              }
              knownThreadId = eventThreadId;
            } else if (type === "turn.started" && !providerInProgressEmitted) {
              providerInProgressEmitted = true;
              yield { type: "lifecycle", event: lifecycle("provider_in_progress", attempt) };
            } else if (type === "turn.completed") {
              turnCompleted = true;
            } else if (type === "turn.failed" || type === "error") {
              throw new Error("codex-turn-failed");
            } else {
              const message = agentMessageFromEvent(event);
              if (message !== null) finalResponse = message;
            }
          }
          if (!turnCompleted) throw new Error("codex-turn-incomplete");
          const threadId = codexThreadIdSchema.safeParse(thread.id ?? knownThreadId);
          if (!threadId.success || (requestedThreadId && threadId.data !== requestedThreadId)) {
            throw new Error("invalid-thread-identity");
          }
          knownThreadId = threadId.data;
        } catch {
          yield { type: "lifecycle", event: lifecycle("provider_attempt_terminal", attempt) };
          quarantine(knownThreadId ?? thread.id);
          if (actionController.signal.aborted) {
            yield { type: "lifecycle", event: lifecycle("cancellation_requested", attempt) };
            throw new BrainRunError(
              "MODEL_TIMEOUT",
              actionTimedOut
                ? "The Codex Brain request timed out."
                : "The Codex Brain request was cancelled.",
              true,
            );
          }
          throw new BrainRunError("INTERNAL_ERROR", "The Codex Brain request failed.", true);
        }

        yield { type: "lifecycle", event: lifecycle("provider_attempt_terminal", attempt) };
        if (actionController.signal.aborted) {
          quarantine(knownThreadId ?? thread.id);
          yield { type: "lifecycle", event: lifecycle("cancellation_requested", attempt) };
          throw new BrainRunError(
            "MODEL_TIMEOUT",
            actionTimedOut
              ? "The Codex Brain request timed out."
              : "The Codex Brain request was cancelled.",
            true,
          );
        }
        yield { type: "lifecycle", event: lifecycle("validating_output", attempt) };
        const validation = validateCandidate(finalResponse, input);
        if (validation.valid) {
          output = validation.output;
          break;
        }
        logValidationFailure(input, attempt, validation);
        if (attempt === 2) {
          quarantine(knownThreadId ?? thread.id);
          throw new BrainRunError(
            "INVALID_MODEL_OUTPUT",
            "The Codex Brain returned invalid output after the bounded repair.",
            false,
          );
        }
        repairAttempted = true;
        attempt = 2;
        yield { type: "lifecycle", event: lifecycle("repair_started", attempt) };
        prompt = `${V3_BRAIN_SYSTEM_PROMPT}\n\n${buildV3RepairInput(
          input,
          validation.rejectedOutput,
          validation.errors,
        )}`;
      }

      const finalThreadId = codexThreadIdSchema.safeParse(thread.id ?? knownThreadId);
      if (!finalThreadId.success) {
        quarantine(knownThreadId);
        throw new BrainRunError("INTERNAL_ERROR", "The Codex Brain thread identity was invalid.", false);
      }
      yield {
        type: "result",
        response: buildResponse(
          input,
          output,
          finalThreadId.data,
          model,
          repairAttempted,
          now().toISOString(),
        ),
      };
    } catch (error) {
      if (error instanceof BrainRunError) throw error;
      quarantine(knownThreadId);
      throw new BrainRunError("INTERNAL_ERROR", "The Codex Brain request failed.", true);
    } finally {
      clearTimeout(timeout);
      externalSignal.removeEventListener("abort", onExternalAbort);
      activeThreadKeys.delete(lockKey);
      if (workspace) {
        try {
          await rm(workspace, { recursive: true, force: true });
        } catch {
          // The isolated workspace contains no application data and cleanup must
          // never replace the already-sanitized Brain outcome.
        }
      }
    }
  }
}
