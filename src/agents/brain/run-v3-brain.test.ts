import { describe, expect, it, vi } from "vitest";

import { runV3Brain } from "./run-v3-brain";
import { validV3BrainOutput, validV3BrainRequest } from "./v3-test-fixtures";

function client(outputs: unknown[]) {
  return {
    create: vi.fn().mockImplementation(async () => outputs.shift()),
    retrieve: vi.fn(),
    cancel: vi.fn(),
  };
}

function provider(output: unknown) {
  return {
    id: "resp_private_not_emitted",
    model: "gpt-5.6-2026-07-01",
    status: "completed",
    output_parsed: output,
  };
}

describe("runV3Brain", () => {
  it("uses the fixed one-shot Responses boundary and emits verified lifecycle", async () => {
    const responses = client([provider(validV3BrainOutput())]);
    const lifecycle: string[] = [];
    const response = await runV3Brain(validV3BrainRequest(), {
      responses,
      now: () => new Date("2026-07-21T00:00:02.000Z"),
      onLifecycle: (event) => lifecycle.push(event.kind),
    });
    expect(responses.create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6",
      reasoning: { effort: "medium" },
      background: true,
      store: false,
      text: { format: expect.objectContaining({ type: "json_schema" }) },
    }), expect.objectContaining({ signal: expect.anything() }));
    expect(response.revision).toBe(1);
    expect(lifecycle).toEqual([
      "request_accepted",
      "provider_attempt_terminal",
      "validating_output",
    ]);
  });

  it("keeps one monotonic lifecycle sequence across the bounded repair", async () => {
    const invalid = structuredClone(validV3BrainOutput());
    invalid.interviewWindow.applicationCap = 1;
    const responses = client([provider(invalid), provider(validV3BrainOutput())]);
    const events: Array<{ kind: string; sequence: number; attempt: number }> = [];
    const response = await runV3Brain(validV3BrainRequest(), {
      responses,
      onLifecycle: (event) => events.push(event),
    });
    expect(response.provenance.repairAttempted).toBe(true);
    expect(responses.create).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.kind === "repair_started" && event.attempt === 2)).toBe(true);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
  });

  it("repairs a schema-invalid missing Answer Aspect list with the frozen V3.1 instructions", async () => {
    const invalid = structuredClone(validV3BrainOutput());
    invalid.nextPrompt!.answerAspects = [];
    const responses = client([provider(invalid), provider(validV3BrainOutput())]);

    const response = await runV3Brain(validV3BrainRequest(), { responses });

    expect(response.provenance.repairAttempted).toBe(true);
    expect(responses.create).toHaveBeenCalledTimes(2);
    const firstBody = responses.create.mock.calls[0][0] as { input: Array<{ role: string; content: string }> };
    expect(firstBody.input[0].content).toContain("Every non-null nextPrompt and every Question Permit prompt");
    const repairBody = responses.create.mock.calls[1][0] as { input: Array<{ role: string; content: string }> };
    expect(repairBody.input[1].content).toContain("Rebuild every invalid answerAspects list");
  });
});
