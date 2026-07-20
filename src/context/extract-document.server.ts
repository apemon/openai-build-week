import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { ContextPreparationResponse } from "@/domain/types";
import {
  EXTRACTED_CONTEXT_MAX_CHARACTERS,
  PDF_MAX_PAGES,
  contextFileExtension,
  validateContextInput,
} from "./limits";
import {
  ContextPreparationError,
  buildContextPreparationResponse,
  type ContextPreparationInput,
  type ExtractedContextSection,
  type ExtractedContextSource,
} from "./prepare-context";

function normalizeDocumentError(error: unknown): ContextPreparationError {
  if (error instanceof ContextPreparationError) return error;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("password") || message.includes("encrypted")) {
    return new ContextPreparationError("ENCRYPTED_DOCUMENT", "Encrypted or password-protected documents are not supported. Replace or remove the file.", false, { cause: error });
  }
  return new ContextPreparationError("CORRUPT_DOCUMENT", "The document could not be read. It may be corrupt or unsupported. Replace it or continue without the file.", true, { cause: error });
}

function characterCount(sections: ExtractedContextSection[]): number {
  return sections.reduce((total, section) => total + section.text.length, 0);
}

function assertUsableSize(sections: ExtractedContextSection[]): void {
  const count = characterCount(sections);
  if (count === 0) throw new ContextPreparationError("EMPTY_CONTEXT", "The document contains no usable text. Replace or remove it before continuing.");
  if (count > EXTRACTED_CONTEXT_MAX_CHARACTERS) {
    throw new ContextPreparationError("EXTRACTION_TOO_LARGE", "The document contains more than 100,000 extracted characters. Nothing was truncated.");
  }
}

async function extractPdf(file: File): Promise<ExtractedContextSource> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > PDF_MAX_PAGES) {
      await pdf.destroy();
      throw new ContextPreparationError("PDF_PAGE_LIMIT", `The PDF has ${pdf.numPages} pages; the project limit is ${PDF_MAX_PAGES}. Nothing was extracted or truncated.`);
    }
    const result = await extractText(pdf);
    await pdf.destroy();
    const omissions: string[] = [];
    const sections = result.text.flatMap((pageText, index) => {
      const page = index + 1;
      const normalized = pageText.trim();
      if (!normalized) {
        omissions.push(`Page ${page} contained no recoverable text.`);
        return [];
      }
      const chunks: ExtractedContextSection[] = [];
      for (let start = 0; start < normalized.length; start += 4_000) {
        chunks.push({ text: normalized.slice(start, start + 4_000).trim(), location: `Page ${page}`, page, heading: null, paragraph: null });
      }
      return chunks.filter((section) => section.text.length > 0);
    });
    assertUsableSize(sections);
    return {
      metadata: { id: "SOURCE-CONTEXT", kind: "uploaded_file", filename: file.name, mimeType: "application/pdf", sizeBytes: file.size, characterCount: characterCount(sections), pageCount: result.totalPages },
      sections,
      coveredLocations: Array.from({ length: result.totalPages }, (_, index) => `Page ${index + 1}`).filter((location) => !omissions.some((omission) => omission.startsWith(location))),
      omissions,
      warnings: omissions.length ? ["Some PDF pages had no recoverable text. Review the identified omissions before confirming the digest."] : [],
      complete: omissions.length === 0,
    };
  } catch (error) {
    throw normalizeDocumentError(error);
  }
}

async function extractDocx(file: File): Promise<ExtractedContextSource> {
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
    const normalized = result.value.replaceAll("\r\n", "\n").trim();
    const sections = normalized.split(/\n\s*\n/).filter((text) => text.trim()).flatMap((text, index) => {
      const paragraph = index + 1;
      const values: ExtractedContextSection[] = [];
      for (let start = 0; start < text.length; start += 4_000) {
        values.push({ text: text.slice(start, start + 4_000).trim(), location: `Paragraph ${paragraph}`, page: null, heading: null, paragraph });
      }
      return values.filter((section) => section.text.length > 0);
    });
    assertUsableSize(sections);
    const warnings = result.messages.map((message) => message.message.trim()).filter(Boolean).slice(0, 50);
    return {
      metadata: { id: "SOURCE-CONTEXT", kind: "uploaded_file", filename: file.name, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: file.size, characterCount: characterCount(sections), pageCount: null },
      sections,
      coveredLocations: sections.map((section) => section.location).slice(0, 100),
      omissions: [],
      warnings,
      complete: warnings.length === 0,
    };
  } catch (error) {
    throw normalizeDocumentError(error);
  }
}

export async function prepareUploadedDocument(input: ContextPreparationInput & { file: File }): Promise<ContextPreparationResponse> {
  const validation = validateContextInput(input);
  if (!validation.valid) throw new ContextPreparationError("INVALID_CONTEXT", validation.message);
  const extension = contextFileExtension(input.file.name);
  if (extension !== ".pdf" && extension !== ".docx") {
    throw new ContextPreparationError("INVALID_CONTEXT", "This route extracts PDF or DOCX files only.");
  }
  const extracted = extension === ".pdf" ? await extractPdf(input.file) : await extractDocx(input.file);
  return buildContextPreparationResponse(input, extracted);
}
