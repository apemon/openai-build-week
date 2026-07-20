import validFixture from "../fixtures/brain-valid.json";
import { describe, expect, it } from "vitest";

import { buildBrainInput } from "@/agents/brain/prompt";
import {
  MAX_RELEVANT_SOURCE_EXCERPT_CHARACTERS,
  validateBrainOutput,
  validateBrainRequest,
} from "@/agents/brain/semantic-validator";
import { brainModelOutputSchema, brainRequestSchema } from "@/domain/schemas";
import { createEmptyQuestionRoadmap, createInitialContextDigest, emptySpecification } from "@/domain/initial-state";
import type { BrainModelOutput, BrainRequest } from "@/domain/types";

const timestamp = "2026-07-20T00:00:00.000Z";

function request(overrides: Partial<BrainRequest> = {}): BrainRequest {
  return brainRequestSchema.parse({
    schemaVersion: 1,
    sessionId: "SESSION-001",
    mode: "live",
    requestId: "REQUEST-001",
    baseRevision: 0,
    operation: "initialize",
    turns: [{
      id: "TURN-001",
      promptId: "PROMPT-INITIAL",
      type: "confirmed_answer",
      text: "We need team billing for our SaaS.",
      createdAt: timestamp,
    }],
    confirmedContextDigest: createInitialContextDigest(new Date(timestamp)),
    questionRoadmap: createEmptyQuestionRoadmap(),
    relevantSourceExcerpts: [],
    currentSpecification: emptySpecification,
    currentPrompt: null,
    ...overrides,
  });
}

function output(): BrainModelOutput {
  return brainModelOutputSchema.parse(structuredClone(validFixture));
}

function uploadedDigest() {
  const digest = createInitialContextDigest(new Date(timestamp));
  digest.sources.push({
    id: "SOURCE-DOC",
    kind: "uploaded_file",
    filename: "billing.md",
    mimeType: "text/markdown",
    sizeBytes: 30_000,
    characterCount: 30_000,
    pageCount: null,
  });
  digest.statements.push({
    id: "CTX-002",
    statement: "Workspace Owners currently manage the account.",
    sourceReferences: [{
      sourceId: "SOURCE-DOC",
      location: "Roles paragraph 2",
      page: null,
      heading: "Roles",
      paragraph: 2,
    }],
  });
  return digest;
}

function nextRevisionRequest(): BrainRequest {
  const previous = output();
  return request({
    baseRevision: 1,
    operation: "answer",
    questionRoadmap: previous.questionRoadmap,
    currentSpecification: previous.specification,
  });
}

function bindToRevision(candidate: BrainModelOutput, revision: number): void {
  candidate.questionRoadmap.baseRevision = revision;
  candidate.questionRoadmap.dependencyVersion = `DEPENDENCY-${revision}`;
  const approval = candidate.questionRoadmap.lookaheadApproval;
  if (approval) {
    approval.approvedAtRevision = revision;
    approval.dependencyVersion = `DEPENDENCY-${revision}`;
  }
}

describe("Brain V2 request boundary", () => {
  it("accepts confirmed digest provenance and only bounded source-addressable excerpts", () => {
    const digest = uploadedDigest();
    const candidate = request({
      confirmedContextDigest: digest,
      relevantSourceExcerpts: [{
        id: "EXCERPT-001",
        sourceId: "SOURCE-DOC",
        text: "Workspace Owners currently manage the account.",
        reference: digest.statements[1].sourceReferences[0],
      }],
    });

    expect(validateBrainRequest(candidate)).toEqual({ valid: true, errors: [] });
    const input = buildBrainInput(candidate);
    expect(input).toContain("PM-confirmed Project Context Digest");
    expect(input).toContain("Workspace Owners currently manage the account.");
    expect(input).toContain("reference only, not Confirmed Input");
  });

  it("rejects unknown sources, mismatched references, and a routine-turn excerpt over budget", () => {
    const digest = uploadedDigest();
    const excerpt = (id: string, characters: number) => ({
      id,
      sourceId: "SOURCE-DOC",
      text: "x".repeat(characters),
      reference: {
        ...digest.statements[1].sourceReferences[0],
        sourceId: id === "EXCERPT-003" ? "SOURCE-MISSING" : "SOURCE-DOC",
      },
    });
    const candidate = request({
      confirmedContextDigest: digest,
      relevantSourceExcerpts: [excerpt("EXCERPT-001", 9_000), excerpt("EXCERPT-002", 9_000), excerpt("EXCERPT-003", 9_000)],
    });

    const errors = validateBrainRequest(candidate).errors.join("\n");
    expect(errors).toContain(`${MAX_RELEVANT_SOURCE_EXCERPT_CHARACTERS} character budget`);
    expect(errors).toMatch(/source and source reference do not match/);
  });

  it("rejects Prepared Demo context and operation/confirmation mismatches", () => {
    const digest = uploadedDigest();
    digest.sources[1].kind = "prepared_sample";
    const candidate = request({ confirmedContextDigest: digest, operation: "decision_summary" });

    const errors = validateBrainRequest(candidate).errors.join("\n");
    expect(errors).toMatch(/Prepared Demo sources are forbidden/);
    expect(errors).toMatch(/decision_summary requires the latest turn to be confirmed_decision_summary/);
  });

  it("accepts a PM-confirmed Decision Summary as authoritative input", () => {
    const candidate = request({
      operation: "decision_summary",
      turns: [{
        id: "TURN-001",
        promptId: "PROMPT-LOOKAHEAD-001",
        type: "confirmed_decision_summary",
        text: "We need team billing for our SaaS.",
        createdAt: timestamp,
      }],
    });

    expect(validateBrainRequest(candidate)).toEqual({ valid: true, errors: [] });
    expect(validateBrainOutput(candidate, output())).toEqual({ valid: true, errors: [] });
  });

  it("allows digest statement IDs to carry confirmed initialization provenance without a synthetic turn", () => {
    const digest = createInitialContextDigest(new Date(timestamp));
    digest.initialPrompt = "We need team billing for our SaaS.";
    digest.statements[0].statement = "We need team billing for our SaaS.";
    const candidateRequest = request({ turns: [], confirmedContextDigest: digest });
    const candidateOutput = output();
    candidateOutput.specification.problemStatement[0].sourceTurnIds = ["CTX-001"];

    expect(validateBrainRequest(candidateRequest)).toEqual({ valid: true, errors: [] });
    expect(validateBrainOutput(candidateRequest, candidateOutput)).toEqual({ valid: true, errors: [] });
  });
});

describe("Brain-owned V2 Question Roadmap", () => {
  it("accepts one dependency-independent lookahead bound to the complete revision", () => {
    expect(validateBrainOutput(request(), output())).toEqual({ valid: true, errors: [] });
  });

  it("rejects lookahead with an unresolved dependency", () => {
    const candidate = output();
    candidate.questionRoadmap.items[1].dependencyIds = ["ROADMAP-001"];
    candidate.questionRoadmap.unresolvedDependencyIds = ["ROADMAP-001"];

    expect(validateBrainOutput(request(), candidate).errors.join("\n")).toMatch(
      /Lookahead approval has unresolved dependencies/,
    );
  });

  it("preserves stable roadmap IDs and meaning across revisions", () => {
    const current = nextRevisionRequest();
    const candidate = output();
    bindToRevision(candidate, 2);
    expect(validateBrainOutput(current, candidate)).toEqual({ valid: true, errors: [] });

    candidate.questionRoadmap.items[1].id = "ROADMAP-003";
    candidate.questionRoadmap.lookaheadApproval!.roadmapItemId = "ROADMAP-003";
    const errors = validateBrainOutput(current, candidate).errors.join("\n");
    expect(errors).toMatch(/ROADMAP-002: roadmap items must be retained/);
    expect(errors).toMatch(/unchanged roadmap meaning received a new stable ID/);
  });

  it("requires a concise stale reason when a prior lookahead is invalidated", () => {
    const current = nextRevisionRequest();
    const candidate = output();
    bindToRevision(candidate, 2);
    candidate.questionRoadmap.lookaheadApproval = null;

    expect(validateBrainOutput(current, candidate).errors.join("\n")).toMatch(/requires a stale reason/);
    candidate.questionRoadmap.items[1].staleReason = "Provider choice now depends on the unresolved billing basis.";
    expect(validateBrainOutput(current, candidate)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a current prompt that is detached from the roadmap decision", () => {
    const candidate = output();
    candidate.questionRoadmap.currentDecisionItemId = "ROADMAP-002";

    expect(validateBrainOutput(request(), candidate).errors.join("\n")).toMatch(
      /nextPrompt decisionKey must match/,
    );
  });
});
