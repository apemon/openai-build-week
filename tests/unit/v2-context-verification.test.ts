import { describe, expect, it } from "vitest";

import {
  CONTEXT_FILE_MAX_BYTES,
  EXTRACTED_CONTEXT_MAX_CHARACTERS,
  INITIAL_PROMPT_MAX_CHARACTERS,
  PASTED_CONTEXT_MAX_CHARACTERS,
  contextFileExtension,
  validateContextInput,
} from "@/context/limits";
import { prepareContextLocally } from "@/context/prepare-context";
import { contextPreparationResponseSchema } from "@/domain/schemas";

const baseInput = {
  schemaVersion: 1 as const,
  sessionId: "SESSION-VERIFY",
  requestId: "REQUEST-VERIFY",
  initialPrompt: "Build a reviewed project intake flow.",
  pastedContext: "",
  file: null,
};

describe("V2 context boundary verification", () => {
  it("accepts every agreed extension case-insensitively and rejects disguised unsupported names", () => {
    expect(contextFileExtension("brief.MD")).toBe(".md");
    expect(contextFileExtension("notes.Txt")).toBe(".txt");
    expect(contextFileExtension("scope.PDF")).toBe(".pdf");
    expect(contextFileExtension("requirements.DOCX")).toBe(".docx");
    expect(contextFileExtension("requirements.docx.zip")).toBeNull();
    expect(contextFileExtension("notes.md.exe")).toBeNull();
  });

  it("enforces exact prompt, paste, file-size, empty-file, and one-source limits without truncation", () => {
    expect(validateContextInput({ ...baseInput, initialPrompt: "x".repeat(INITIAL_PROMPT_MAX_CHARACTERS) }).valid).toBe(true);
    expect(validateContextInput({ ...baseInput, initialPrompt: "x".repeat(INITIAL_PROMPT_MAX_CHARACTERS + 1) })).toMatchObject({ valid: false, code: "INITIAL_PROMPT_TOO_LONG" });
    expect(validateContextInput({ ...baseInput, pastedContext: "x".repeat(PASTED_CONTEXT_MAX_CHARACTERS) }).valid).toBe(true);
    expect(validateContextInput({ ...baseInput, pastedContext: "x".repeat(PASTED_CONTEXT_MAX_CHARACTERS + 1) })).toMatchObject({ valid: false, code: "PASTED_CONTEXT_TOO_LONG" });

    const exactFile = new File([new Uint8Array(CONTEXT_FILE_MAX_BYTES)], "brief.pdf", { type: "application/pdf" });
    const largeFile = new File([new Uint8Array(CONTEXT_FILE_MAX_BYTES + 1)], "brief.pdf", { type: "application/pdf" });
    expect(validateContextInput({ ...baseInput, file: exactFile }).valid).toBe(true);
    expect(validateContextInput({ ...baseInput, file: largeFile })).toMatchObject({ valid: false, code: "FILE_TOO_LARGE" });
    expect(validateContextInput({ ...baseInput, file: new File([], "empty.txt") })).toMatchObject({ valid: false, code: "EMPTY_FILE" });
    expect(validateContextInput({ ...baseInput, pastedContext: "pasted", file: new File(["file"], "brief.txt") })).toMatchObject({ valid: false, code: "MULTIPLE_CONTEXT_SOURCES" });
  });

  it("builds source-linked pasted context while preserving all accepted characters", async () => {
    const pastedContext = "# Permissions\n\nOwners manage billing.\n\nMembers cannot view billing.";
    const result = await prepareContextLocally({ ...baseInput, pastedContext });
    expect(contextPreparationResponseSchema.safeParse(result).success).toBe(true);
    expect(result.digest.confirmedAt).toBeNull();
    expect(result.digest.statements.map((statement) => statement.statement)).toEqual([
      baseInput.initialPrompt,
      "# Permissions",
      "Owners manage billing.",
      "Members cannot view billing.",
    ]);
    expect(result.digest.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "initial_prompt" }),
      expect.objectContaining({ kind: "pasted_text", characterCount: expect.any(Number) }),
    ]));
    expect(result.temporaryExtraction?.excerpts.every((excerpt) => excerpt.sourceId === "SOURCE-CONTEXT")).toBe(true);
    expect(result.temporaryExtraction?.excerpts.reduce((count, excerpt) => count + excerpt.text.length, 0)).toBeLessThanOrEqual(EXTRACTED_CONTEXT_MAX_CHARACTERS);
  });

  it("blocks empty optional text and invalid UTF-8 rather than manufacturing a digest", async () => {
    await expect(prepareContextLocally({ ...baseInput, pastedContext: "   " })).resolves.toMatchObject({
      digest: { statements: [expect.objectContaining({ statement: baseInput.initialPrompt })] },
      temporaryExtraction: null,
    });

    const invalidUtf8 = new File([new Uint8Array([0xc3, 0x28])], "context.txt", { type: "text/plain" });
    await expect(prepareContextLocally({ ...baseInput, file: invalidUtf8 })).rejects.toMatchObject({
      code: "INVALID_TEXT_ENCODING",
    });
  });
});
