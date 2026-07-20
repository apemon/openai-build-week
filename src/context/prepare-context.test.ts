import { describe, expect, it } from "vitest";
import {
  CONTEXT_FILE_MAX_BYTES,
  PASTED_CONTEXT_MAX_CHARACTERS,
  validateContextInput,
} from "./limits";
import {
  ContextPreparationError,
  DIGEST_SOURCE_STATEMENT_CHARACTER_LIMIT,
  DIGEST_SOURCE_STATEMENT_LIMIT,
  prepareContextLocally,
} from "./prepare-context";

const base = {
  schemaVersion: 1 as const,
  sessionId: "SESSION-TEST",
  requestId: "REQUEST-TEST",
  initialPrompt: "Build a reviewed intake flow.",
  pastedContext: "",
  file: null,
};

describe("context input limits", () => {
  it("enforces exactly one optional context source and every client file limit", () => {
    const file = new File(["hello"], "context.md", { type: "text/markdown" });
    expect(validateContextInput({ ...base, pastedContext: "notes", file })).toMatchObject({ valid: false, code: "MULTIPLE_CONTEXT_SOURCES" });
    expect(validateContextInput({ ...base, file: new File([], "empty.txt") })).toMatchObject({ valid: false, code: "EMPTY_FILE" });
    expect(validateContextInput({ ...base, file: { name: "large.pdf", type: "application/pdf", size: CONTEXT_FILE_MAX_BYTES + 1 } })).toMatchObject({ valid: false, code: "FILE_TOO_LARGE" });
    expect(validateContextInput({ ...base, file: new File(["hello"], "context.csv") })).toMatchObject({ valid: false, code: "UNSUPPORTED_FILE" });
    expect(validateContextInput({ ...base, pastedContext: "x".repeat(PASTED_CONTEXT_MAX_CHARACTERS + 1) })).toMatchObject({ valid: false, code: "PASTED_CONTEXT_TOO_LONG" });
  });
});

describe("prepareContextLocally", () => {
  it("creates an editable digest and temporary source extraction with stable provenance", async () => {
    const result = await prepareContextLocally({ ...base, pastedContext: "# Scope\n\nOwners approve billing.\n\n## Limits\n\nNo annual plans." });
    expect(result.digest.confirmedAt).toBeNull();
    expect(result.digest.sources).toHaveLength(2);
    expect(result.digest.statements.map((statement) => statement.id)).toEqual(["CTX-001", "CTX-002", "CTX-003", "CTX-004", "CTX-005"]);
    expect(result.digest.statements[1]?.sourceReferences[0]?.sourceId).toBe("SOURCE-CONTEXT");
    expect(result.temporaryExtraction?.complete).toBe(true);
    expect(result.temporaryExtraction?.excerpts.map((excerpt) => excerpt.text).join(" ")).toContain("Owners approve billing");
  });

  it("routes PDF and DOCX extraction to the ephemeral server implementation", async () => {
    await expect(prepareContextLocally({ ...base, file: new File(["pdf"], "brief.pdf", { type: "application/pdf" }) })).rejects.toMatchObject({ code: "SERVER_EXTRACTION_REQUIRED" });
  });

  it("rejects over-limit extraction without silently truncating", async () => {
    await expect(prepareContextLocally({ ...base, pastedContext: "x".repeat(PASTED_CONTEXT_MAX_CHARACTERS + 1) })).rejects.toBeInstanceOf(ContextPreparationError);
  });

  it("keeps the checkpointable digest concise while retaining the complete temporary extraction", async () => {
    const sections = Array.from({ length: DIGEST_SOURCE_STATEMENT_LIMIT + 3 }, (_, index) => `## Decision ${index + 1}\n\n${String(index + 1).repeat(DIGEST_SOURCE_STATEMENT_CHARACTER_LIMIT + 200)}`);
    const source = sections.join("\n\n");
    const result = await prepareContextLocally({ ...base, pastedContext: source });
    const retainedSourceStatements = result.digest.statements.slice(1);

    expect(retainedSourceStatements).toHaveLength(DIGEST_SOURCE_STATEMENT_LIMIT);
    expect(retainedSourceStatements.every((statement) => statement.statement.length <= DIGEST_SOURCE_STATEMENT_CHARACTER_LIMIT)).toBe(true);
    expect(result.digest.coverage.omissions.length).toBeGreaterThan(0);
    expect(result.digest.coverage.requiresAcknowledgement).toBe(true);
    expect(result.temporaryExtraction?.excerpts.map((excerpt) => excerpt.text).join("\n")).toContain(String(DIGEST_SOURCE_STATEMENT_LIMIT + 3).repeat(DIGEST_SOURCE_STATEMENT_CHARACTER_LIMIT + 200));
  });
});
