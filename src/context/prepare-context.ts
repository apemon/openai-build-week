import {
  contextPreparationResponseSchema,
  projectContextDigestSchema,
  temporaryContextExtractionSchema,
} from "@/domain/schemas";
import type {
  ContextPreparationResponse,
  ContextSourceMetadata,
  ProjectContextDigest,
  SourceReference,
  TemporaryContextExtraction,
} from "@/domain/types";
import {
  EXTRACTED_CONTEXT_MAX_CHARACTERS,
  PASTED_CONTEXT_MAX_CHARACTERS,
  contextFileExtension,
  isServerExtractionRequired,
  validateContextInput,
} from "./limits";

export type ContextPreparationErrorCode =
  | "INVALID_CONTEXT"
  | "INVALID_TEXT_ENCODING"
  | "EMPTY_CONTEXT"
  | "EXTRACTION_TOO_LARGE"
  | "TOO_MANY_DIGEST_STATEMENTS"
  | "SERVER_EXTRACTION_REQUIRED"
  | "ENCRYPTED_DOCUMENT"
  | "CORRUPT_DOCUMENT"
  | "PDF_PAGE_LIMIT";

export class ContextPreparationError extends Error {
  constructor(
    readonly code: ContextPreparationErrorCode,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContextPreparationError";
  }
}

export interface ContextPreparationInput {
  schemaVersion: 1;
  sessionId: string;
  requestId: string;
  initialPrompt: string;
  pastedContext: string;
  file: File | null;
}

export interface ExtractedContextSection {
  text: string;
  location: string;
  page: number | null;
  heading: string | null;
  paragraph: number | null;
}

export interface ExtractedContextSource {
  metadata: ContextSourceMetadata;
  sections: ExtractedContextSection[];
  coveredLocations: string[];
  omissions: string[];
  warnings: string[];
  complete: boolean;
}

const DIGEST_TEXT_LIMIT = 4_000;
const EXCERPT_TEXT_LIMIT = 10_000;

function splitWithoutTruncation(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let boundary = remaining.lastIndexOf("\n", limit);
    if (boundary < Math.floor(limit * 0.6)) boundary = remaining.lastIndexOf(" ", limit);
    if (boundary < Math.floor(limit * 0.6)) boundary = limit;
    const chunk = remaining.slice(0, boundary).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function markdownSections(text: string): ExtractedContextSection[] {
  const paragraphs = text.replaceAll("\r\n", "\n").split(/\n\s*\n/);
  const sections: ExtractedContextSection[] = [];
  let currentHeading: string | null = null;
  let paragraph = 0;
  for (const raw of paragraphs) {
    const value = raw.trim();
    if (!value) continue;
    paragraph += 1;
    const headingMatch = /^(#{1,6})\s+(.+)$/m.exec(value);
    if (headingMatch?.[2]) currentHeading = headingMatch[2].trim().slice(0, 500);
    for (const chunk of splitWithoutTruncation(value, DIGEST_TEXT_LIMIT)) {
      sections.push({
        text: chunk,
        location: currentHeading ? `${currentHeading} · paragraph ${paragraph}` : `Paragraph ${paragraph}`,
        page: null,
        heading: currentHeading,
        paragraph,
      });
    }
  }
  return sections;
}

function plainTextSections(text: string): ExtractedContextSection[] {
  const normalized = text.replaceAll("\r\n", "\n").trim();
  return splitWithoutTruncation(normalized, DIGEST_TEXT_LIMIT).map((chunk, index) => ({
    text: chunk,
    location: `Paragraph ${index + 1}`,
    page: null,
    heading: null,
    paragraph: index + 1,
  }));
}

export function sourceReference(sourceId: string, section: ExtractedContextSection): SourceReference {
  return {
    sourceId,
    location: section.location,
    page: section.page,
    heading: section.heading,
    paragraph: section.paragraph,
  };
}

function safeDigestId(requestId: string): string {
  return `DIGEST-${requestId.replaceAll(/[^A-Z0-9_-]/gi, "-").toUpperCase().slice(-40)}`;
}

export function buildContextPreparationResponse(
  input: Pick<ContextPreparationInput, "requestId" | "initialPrompt">,
  extracted: ExtractedContextSource | null,
): ContextPreparationResponse {
  const initialSource: ContextSourceMetadata = {
    id: "SOURCE-INITIAL",
    kind: "initial_prompt",
    filename: null,
    mimeType: "text/plain",
    sizeBytes: null,
    characterCount: input.initialPrompt.length,
    pageCount: null,
  };
  const statements: ProjectContextDigest["statements"] = [{
    id: "CTX-001",
    statement: input.initialPrompt.trim(),
    sourceReferences: [{ sourceId: initialSource.id, location: "Initial Prompt", page: null, heading: null, paragraph: 1 }],
  }];
  for (const section of extracted?.sections ?? []) {
    statements.push({
      id: `CTX-${String(statements.length + 1).padStart(3, "0")}`,
      statement: section.text,
      sourceReferences: [sourceReference(extracted!.metadata.id, section)],
    });
  }
  if (statements.length > 100) {
    throw new ContextPreparationError("TOO_MANY_DIGEST_STATEMENTS", "The context contains more than 99 source sections. Combine nearby sections and retry; nothing was silently dropped.");
  }

  const coverage = {
    coveredLocations: ["Initial Prompt", ...(extracted?.coveredLocations ?? [])].slice(0, 100),
    omissions: extracted?.omissions ?? [],
    warnings: extracted?.warnings ?? [],
    requiresAcknowledgement: Boolean(extracted && (extracted.omissions.length > 0 || extracted.warnings.length > 0)),
  };
  const digest = projectContextDigestSchema.parse({
    id: safeDigestId(input.requestId),
    initialPrompt: input.initialPrompt.trim(),
    statements,
    sources: [initialSource, ...(extracted ? [extracted.metadata] : [])],
    coverage,
    confirmedAt: null,
  });

  let temporaryExtraction: TemporaryContextExtraction | null = null;
  if (extracted) {
    const excerpts = extracted.sections.flatMap((section, sectionIndex) =>
      splitWithoutTruncation(section.text, EXCERPT_TEXT_LIMIT).map((text, chunkIndex) => ({
        id: `EXCERPT-${String(sectionIndex + 1).padStart(3, "0")}-${String(chunkIndex + 1).padStart(2, "0")}`,
        sourceId: extracted.metadata.id,
        text,
        reference: sourceReference(extracted.metadata.id, section),
      })),
    );
    temporaryExtraction = temporaryContextExtractionSchema.parse({
      sourceId: extracted.metadata.id,
      excerpts,
      complete: extracted.complete,
      warnings: extracted.warnings,
    });
  }
  return contextPreparationResponseSchema.parse({ schemaVersion: 1, requestId: input.requestId, digest, temporaryExtraction });
}

function extractedTextSource(text: string, kind: "pasted_text" | "uploaded_file", filename: string | null, mimeType: string, sizeBytes: number | null): ExtractedContextSource {
  if (text.length > EXTRACTED_CONTEXT_MAX_CHARACTERS) {
    throw new ContextPreparationError("EXTRACTION_TOO_LARGE", `Extracted context exceeds ${PASTED_CONTEXT_MAX_CHARACTERS.toLocaleString()} characters. Nothing was truncated.`);
  }
  const isMarkdown = filename?.toLowerCase().endsWith(".md") ?? (kind === "pasted_text" && /^#{1,6}\s+\S/m.test(text));
  const sections = isMarkdown ? markdownSections(text) : plainTextSections(text);
  if (sections.length === 0) throw new ContextPreparationError("EMPTY_CONTEXT", "The context contains no usable text. Replace or remove it before continuing.");
  const characterCount = sections.reduce((total, section) => total + section.text.length, 0);
  if (characterCount > EXTRACTED_CONTEXT_MAX_CHARACTERS) {
    throw new ContextPreparationError("EXTRACTION_TOO_LARGE", `Extracted context exceeds ${PASTED_CONTEXT_MAX_CHARACTERS.toLocaleString()} characters. Nothing was truncated.`);
  }
  return {
    metadata: { id: "SOURCE-CONTEXT", kind, filename, mimeType, sizeBytes, characterCount: text.length, pageCount: null },
    sections,
    coveredLocations: sections.map((section) => section.location).slice(0, 100),
    omissions: [],
    warnings: [],
    complete: true,
  };
}

export async function prepareContextLocally(input: ContextPreparationInput): Promise<ContextPreparationResponse> {
  const validation = validateContextInput(input);
  if (!validation.valid) throw new ContextPreparationError("INVALID_CONTEXT", validation.message);
  if (input.file && isServerExtractionRequired(input.file.name)) {
    throw new ContextPreparationError("SERVER_EXTRACTION_REQUIRED", "PDF and DOCX files must use the ephemeral server extraction route.");
  }

  let extracted: ExtractedContextSource | null = null;
  if (input.file) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await input.file.arrayBuffer());
    } catch (error) {
      throw new ContextPreparationError("INVALID_TEXT_ENCODING", "The text file is not valid UTF-8. Replace it or continue without the file.", false, { cause: error });
    }
    const extension = contextFileExtension(input.file.name);
    extracted = extractedTextSource(text, "uploaded_file", input.file.name, extension === ".md" ? "text/markdown" : "text/plain", input.file.size);
  } else if (input.pastedContext.trim()) {
    extracted = extractedTextSource(input.pastedContext, "pasted_text", null, "text/plain", null);
  }
  return buildContextPreparationResponse(input, extracted);
}
