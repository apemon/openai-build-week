import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrainHarnessEvent } from "@/domain/brain-harness";

import {
  CodexSdkBrainHarness,
  type CodexSdkClientConstructionOptions,
  type CodexSdkClientLike,
  type CodexSdkThreadLike,
  resetCodexSdkHarnessStateForTests,
} from "./codex-sdk-harness";
import { validV3BrainOutput, validV3BrainRequest } from "./v3-test-fixtures";

type TurnBehavior = {
  output?: unknown;
  failure?: string;
  gate?: Promise<void>;
  waitForAbort?: boolean;
};

async function* fakeTurnEvents(
  thread: FakeThread,
  behavior: TurnBehavior,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  if (!thread.id) thread.id = thread.assignedId;
  yield { type: "thread.started", thread_id: thread.id };
  yield { type: "turn.started" };
  if (behavior.gate) await behavior.gate;
  if (behavior.waitForAbort) {
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) reject(new Error("SECRET_ABORT_DETAIL"));
      else signal.addEventListener(
        "abort",
        () => reject(new Error("SECRET_ABORT_DETAIL")),
        { once: true },
      );
    });
  }
  if (behavior.failure) throw new Error(behavior.failure);
  if (behavior.output !== undefined) {
    yield {
      type: "item.completed",
      item: {
        id: "content-bearing-id",
        type: "agent_message",
        text: typeof behavior.output === "string"
          ? behavior.output
          : JSON.stringify(behavior.output),
      },
    };
  }
  yield { type: "turn.completed", usage: null };
}

class FakeThread implements CodexSdkThreadLike {
  readonly prompts: string[] = [];
  readonly turnOptions: Array<{ outputSchema: unknown; signal: AbortSignal }> = [];

  constructor(
    public id: string | null,
    readonly assignedId: string,
    private readonly behaviors: TurnBehavior[],
  ) {}

  async runStreamed(
    input: string,
    options: { outputSchema: unknown; signal: AbortSignal },
  ): Promise<{ events: AsyncIterable<unknown> }> {
    this.prompts.push(input);
    this.turnOptions.push(options);
    const behavior = this.behaviors.shift() ?? {};
    return { events: fakeTurnEvents(this, behavior, options.signal) };
  }
}

class FakeClient implements CodexSdkClientLike {
  readonly startThread = vi.fn((options: Parameters<CodexSdkClientLike["startThread"]>[0]) => {
    void options;
    return this.thread;
  });
  readonly resumeThread = vi.fn((
    id: string,
    options: Parameters<CodexSdkClientLike["resumeThread"]>[1],
  ) => {
    void id;
    void options;
    return this.thread;
  });

  constructor(readonly thread: FakeThread) {}
}

function harness(
  client: FakeClient,
  storageRoot: string,
  construction?: (options: CodexSdkClientConstructionOptions) => void,
): CodexSdkBrainHarness {
  return new CodexSdkBrainHarness({
    apiKey: "test-only-key",
    storageRoot,
    now: () => new Date("2026-07-21T00:00:00.000Z"),
    clientFactory: (options) => {
      construction?.(options);
      return client;
    },
  });
}

async function collect(
  candidate: CodexSdkBrainHarness,
  signal = new AbortController().signal,
  request = validV3BrainRequest(),
): Promise<BrainHarnessEvent[]> {
  const events: BrainHarnessEvent[] = [];
  for await (const event of candidate.run(request, signal)) events.push(event);
  return events;
}

beforeEach(() => resetCodexSdkHarnessStateForTests());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("CodexSdkBrainHarness", () => {
  it.each([process.cwd(), homedir(), parse(process.cwd()).root])(
    "rejects unsafe storage root %s before creating SDK state",
    async (storageRoot) => {
      const client = new FakeClient(new FakeThread(null, "THREAD-UNUSED-001", []));
      await expect(collect(harness(client, storageRoot)))
        .rejects.toMatchObject({ code: "INVALID_REQUEST", retryable: false });
      expect(client.startThread).not.toHaveBeenCalled();
      expect(client.resumeThread).not.toHaveBeenCalled();
    },
  );

  it("rejects an existing non-directory storage path before creating SDK state", async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-path-test-"));
    const storagePath = join(testRoot, "not-a-directory");
    await writeFile(storagePath, "not storage");
    const client = new FakeClient(new FakeThread(null, "THREAD-UNUSED-001", []));

    try {
      await expect(collect(harness(client, storagePath)))
        .rejects.toMatchObject({ code: "INVALID_REQUEST", retryable: false });
      expect(client.startThread).not.toHaveBeenCalled();
      expect(client.resumeThread).not.toHaveBeenCalled();
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("starts an isolated thread and returns its validated ID with truthful provenance", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-test-"));
    const thread = new FakeThread(null, "THREAD-STARTED-001", [{ output: validV3BrainOutput() }]);
    const client = new FakeClient(thread);
    let construction: CodexSdkClientConstructionOptions | null = null;

    try {
      const events = await collect(harness(client, storageRoot, (options) => { construction = options; }));
      expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
        model: "gpt-5.6-sol",
        sandboxMode: "read-only",
        skipGitRepoCheck: true,
        modelReasoningEffort: "medium",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        approvalPolicy: "never",
      }));
      expect(client.resumeThread).not.toHaveBeenCalled();
      expect(construction).not.toBeNull();
      expect(Object.keys(construction!.env).sort()).toEqual([
        "CODEX_HOME", "HOME", "LANG", "NODE_ENV", "PATH", "TMPDIR",
      ]);
      expect(construction!.env.CODEX_HOME).toBe(join(storageRoot, "codex-home"));
      const result = events.find((event) => event.type === "result");
      expect(result?.response).toMatchObject({
        codexThreadId: "THREAD-STARTED-001",
        provenance: {
          source: "live_ai",
          requestedModel: "gpt-5.6-sol",
          actualModel: "gpt-5.6-sol:unverified",
          repairAttempted: false,
        },
      });
      expect(events.filter((event) => event.type === "lifecycle").map(({ event }) => event.kind)).toEqual([
        "request_accepted",
        "provider_in_progress",
        "provider_attempt_terminal",
        "validating_output",
      ]);
      const workingDirectory = client.startThread.mock.calls[0][0].workingDirectory;
      await expect(stat(workingDirectory)).rejects.toThrow();
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("resumes the exact validated thread ID supplied by the request", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-test-"));
    const request = validV3BrainRequest();
    request.codexThreadId = "THREAD-RESUME-001";
    const thread = new FakeThread(request.codexThreadId, request.codexThreadId, [{ output: validV3BrainOutput() }]);
    const client = new FakeClient(thread);

    try {
      const events = await collect(harness(client, storageRoot), new AbortController().signal, request);
      expect(client.resumeThread).toHaveBeenCalledWith(
        "THREAD-RESUME-001",
        expect.objectContaining({ sandboxMode: "read-only" }),
      );
      expect(client.startThread).not.toHaveBeenCalled();
      expect(events.find((event) => event.type === "result")?.response.codexThreadId).toBe("THREAD-RESUME-001");
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("uses the same thread for exactly one bounded repair with monotonic lifecycle", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-test-"));
    const invalid = structuredClone(validV3BrainOutput());
    invalid.interviewWindow.applicationCap = 1;
    const thread = new FakeThread(null, "THREAD-REPAIR-001", [
      { output: invalid },
      { output: validV3BrainOutput() },
    ]);
    const client = new FakeClient(thread);

    try {
      const events = await collect(harness(client, storageRoot));
      expect(thread.prompts).toHaveLength(2);
      expect(thread.prompts[0]).toContain("return an empty permits array");
      expect(thread.prompts[1]).toContain("Repair the rejected candidate.");
      expect(thread.prompts[1]).toContain("Never rename or remove an ID already present");
      expect(events.filter((event) => event.type === "lifecycle").map(({ event }) => ({
        kind: event.kind,
        attempt: event.attempt,
        sequence: event.sequence,
      }))).toEqual([
        { kind: "request_accepted", attempt: 1, sequence: 0 },
        { kind: "provider_in_progress", attempt: 1, sequence: 1 },
        { kind: "provider_attempt_terminal", attempt: 1, sequence: 2 },
        { kind: "validating_output", attempt: 1, sequence: 3 },
        { kind: "repair_started", attempt: 2, sequence: 4 },
        { kind: "provider_in_progress", attempt: 2, sequence: 5 },
        { kind: "provider_attempt_terminal", attempt: 2, sequence: 6 },
        { kind: "validating_output", attempt: 2, sequence: 7 },
      ]);
      expect(events.find((event) => event.type === "result")?.response.provenance.repairAttempted).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("logs only content-free validation categories when debug tracing is enabled", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-test-"));
    const invalid = structuredClone(validV3BrainOutput());
    invalid.specification.title = "SECRET_SPECIFICATION_TITLE";
    invalid.interviewWindow.applicationCap = 1;
    const client = new FakeClient(new FakeThread(null, "THREAD-SECRET-001", [
      { output: invalid },
      { output: validV3BrainOutput() },
    ]));
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubEnv("BRAIN_DEBUG_LOGS", "true");

    try {
      await collect(harness(client, storageRoot));
      expect(log).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify(log.mock.calls);
      expect(serialized).toContain("validation_failed");
      expect(serialized).toContain("interview_window");
      expect(serialized).not.toContain("SECRET_SPECIFICATION_TITLE");
      expect(serialized).not.toContain("THREAD-SECRET-001");
      expect(serialized).not.toContain("applicationCap");
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("enforces one active turn per thread", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-test-"));
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const request = validV3BrainRequest();
    request.codexThreadId = "THREAD-LOCK-001";
    const thread = new FakeThread(request.codexThreadId, request.codexThreadId, [
      { gate, output: validV3BrainOutput() },
    ]);
    const client = new FakeClient(thread);
    const candidate = harness(client, storageRoot);
    const first = candidate.run(request, new AbortController().signal)[Symbol.asyncIterator]();

    try {
      await first.next();
      await first.next();
      const second = candidate.run(request, new AbortController().signal)[Symbol.asyncIterator]();
      await expect(second.next()).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
      releaseGate();
      while (!(await first.next()).done) {
        // Drain the successful first turn so its lock is released.
      }
    } finally {
      releaseGate();
      await first.return?.();
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("quarantines a terminally invalid thread and exposes only a sanitized error", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-test-"));
    const request = validV3BrainRequest();
    request.codexThreadId = "THREAD-INVALID-001";
    const invalid = structuredClone(validV3BrainOutput());
    invalid.interviewWindow.applicationCap = 1;
    const client = new FakeClient(new FakeThread(request.codexThreadId, request.codexThreadId, [
      { output: invalid },
      { output: invalid },
    ]));

    try {
      let terminal: unknown;
      try {
        await collect(harness(client, storageRoot), new AbortController().signal, request);
      } catch (error) {
        terminal = error;
      }
      expect(terminal).toMatchObject({ code: "INVALID_MODEL_OUTPUT", retryable: false });
      expect(Object.hasOwn(terminal as object, "rejectedOutput")).toBe(false);
      expect(Object.hasOwn(terminal as object, "validationErrors")).toBe(false);
      expect(JSON.stringify(terminal)).not.toContain("applicationCap");
      await expect(collect(harness(client, storageRoot), new AbortController().signal, request))
        .rejects.toMatchObject({ code: "INVALID_REQUEST", retryable: false });
      expect(client.resumeThread).toHaveBeenCalledTimes(1);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { name: "SDK failure", behavior: { failure: "SECRET_SDK_STDERR" }, abort: false, code: "INTERNAL_ERROR" },
    { name: "external cancellation", behavior: { waitForAbort: true }, abort: true, code: "MODEL_TIMEOUT" },
  ])("quarantines after $name without exposing SDK content", async ({ behavior, abort, code }) => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-test-"));
    const request = validV3BrainRequest();
    request.codexThreadId = `THREAD-${abort ? "CANCEL" : "FAILURE"}-001`;
    const client = new FakeClient(new FakeThread(request.codexThreadId, request.codexThreadId, [behavior]));
    const controller = new AbortController();
    const iterator = harness(client, storageRoot).run(request, controller.signal)[Symbol.asyncIterator]();

    try {
      await iterator.next();
      await iterator.next();
      if (abort) controller.abort();
      let terminal: unknown;
      try {
        while (!(await iterator.next()).done) {
          // Drain until the sanitized terminal error.
        }
      } catch (error) {
        terminal = error;
      }
      expect(terminal).toMatchObject({ code });
      expect(JSON.stringify(terminal)).not.toContain("SECRET_");
      expect(Object.hasOwn(terminal as object, "cause")).toBe(false);
      await expect(collect(harness(client, storageRoot), new AbortController().signal, request))
        .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    } finally {
      controller.abort();
      await iterator.return?.();
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("uses one total timeout and quarantines the interrupted thread", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "spec-grill-sdk-test-"));
    const request = validV3BrainRequest();
    request.codexThreadId = "THREAD-TIMEOUT-001";
    const client = new FakeClient(new FakeThread(request.codexThreadId, request.codexThreadId, [
      { waitForAbort: true },
    ]));
    const candidate = new CodexSdkBrainHarness({
      apiKey: "test-only-key",
      storageRoot,
      timeoutMs: 10,
      clientFactory: () => client,
    });

    try {
      await expect(collect(candidate, new AbortController().signal, request))
        .rejects.toMatchObject({ code: "MODEL_TIMEOUT", retryable: true });
      await expect(collect(harness(client, storageRoot), new AbortController().signal, request))
        .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});
