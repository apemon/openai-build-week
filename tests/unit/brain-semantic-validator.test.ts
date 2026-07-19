import invalidFixture from "../fixtures/brain-invalid.json";
import validFixture from "../fixtures/brain-valid.json";
import { describe, expect, it } from "vitest";

import { validateBrainOutput } from "@/agents/brain/semantic-validator";
import { brainModelOutputSchema, brainRequestSchema } from "@/domain/schemas";
import { emptySpecification } from "@/domain/initial-state";
import type { BrainModelOutput, BrainRequest } from "@/domain/types";

const request = brainRequestSchema.parse({
  schemaVersion: 1,
  sessionId: "SESSION-001",
  mode: "live",
  requestId: "REQUEST-001",
  baseRevision: 0,
  operation: "answer",
  turns: [
    {
      id: "TURN-001",
      promptId: "PROMPT-INITIAL",
      type: "confirmed_answer",
      text: "We need team billing for our SaaS.",
      createdAt: "2026-07-20T00:00:00.000Z"
    }
  ],
  currentSpecification: emptySpecification,
  currentPrompt: null
});

function cloneOutput(): BrainModelOutput {
  return brainModelOutputSchema.parse(structuredClone(validFixture));
}

describe("Brain semantic validation", () => {
  it("accepts a complete, source-linked output", () => {
    expect(validateBrainOutput(request, cloneOutput())).toEqual({ valid: true, errors: [] });
  });

  it("rejects category, source, and multi-question violations", () => {
    const output = brainModelOutputSchema.parse(invalidFixture);
    const result = validateBrainOutput(request, output);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/ID does not match category/);
    expect(result.errors.join("\n")).toMatch(/unknown source turn/);
    expect(result.errors.join("\n")).toMatch(/exactly one question/);
  });

  it("rejects duplicate IDs and readiness references that disagree with sections", () => {
    const output = cloneOutput();
    const problem = output.specification.problemStatement[0];
    output.specification.users.push({ ...problem, kind: "user" });
    output.specification.readiness.blockerIds = ["BLK-999"];

    const errors = validateBrainOutput(request, output).errors.join("\n");
    expect(errors).toMatch(/duplicate ID/);
    expect(errors).toMatch(/blockerIds must exactly match/);
  });

  it("rejects changed meaning for a retained ID", () => {
    const output = cloneOutput();
    const previous: BrainRequest = {
      ...request,
      currentSpecification: structuredClone(output.specification),
    };
    output.specification.problemStatement[0].statement = "Customers want a mobile photo editor.";

    expect(validateBrainOutput(previous, output).errors.join("\n")).toMatch(/changed meaning/);
  });

  it("rejects unsupported derived constraints", () => {
    const output = cloneOutput();
    output.specification.functionalRequirements.push({
      id: "FR-001",
      kind: "functional_requirement",
      statement: "Billing must always settle within 15 minutes.",
      status: "derived",
      sourceTurnIds: ["TURN-001"],
      rationale: "Claimed as derived.",
    });

    expect(validateBrainOutput(request, output).errors.join("\n")).toMatch(/unsupported constraint/);
  });

  it("rejects invalid visual-aid references", () => {
    const output = cloneOutput();
    if (!output.nextPrompt) throw new Error("fixture requires a prompt");
    output.nextPrompt.visualAid = {
      kind: "role_map",
      title: "Roles",
      nodes: [{ id: "NODE-001", label: "Owner", description: null }],
      edges: [{ id: "EDGE-001", from: "NODE-001", to: "NODE-MISSING", label: null }],
      sourceItemIds: ["FR-999"],
    };

    const errors = validateBrainOutput(request, output).errors.join("\n");
    expect(errors).toMatch(/unknown node/);
    expect(errors).toMatch(/unknown source item/);
  });
});
