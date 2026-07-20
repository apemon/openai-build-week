export const INITIAL_PROMPT_MAX_CHARACTERS = 4_000;
export const PASTED_CONTEXT_MAX_CHARACTERS = 100_000;
export const CONTEXT_FILE_MAX_BYTES = 10_000_000;
export const PDF_MAX_PAGES = 50;
export const EXTRACTED_CONTEXT_MAX_CHARACTERS = 100_000;

export const SUPPORTED_CONTEXT_EXTENSIONS = [".md", ".txt", ".pdf", ".docx"] as const;

export type SupportedContextExtension = (typeof SUPPORTED_CONTEXT_EXTENSIONS)[number];

export type ContextValidationCode =
  | "EMPTY_INITIAL_PROMPT"
  | "INITIAL_PROMPT_TOO_LONG"
  | "PASTED_CONTEXT_TOO_LONG"
  | "MULTIPLE_CONTEXT_SOURCES"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE";

export interface ContextValidationFailure {
  valid: false;
  code: ContextValidationCode;
  message: string;
}

export interface ContextValidationSuccess {
  valid: true;
  extension: SupportedContextExtension | null;
}

export type ContextValidationResult = ContextValidationSuccess | ContextValidationFailure;

export interface ContextInputLike {
  initialPrompt: string;
  pastedContext: string;
  file: Pick<File, "name" | "size" | "type"> | null;
}

export function contextFileExtension(filename: string): SupportedContextExtension | null {
  const lowercase = filename.toLowerCase();
  return SUPPORTED_CONTEXT_EXTENSIONS.find((extension) => lowercase.endsWith(extension)) ?? null;
}

export function validateContextInput(input: ContextInputLike): ContextValidationResult {
  if (!input.initialPrompt.trim()) {
    return { valid: false, code: "EMPTY_INITIAL_PROMPT", message: "Enter an Initial Prompt before preparing context." };
  }
  if (input.initialPrompt.length > INITIAL_PROMPT_MAX_CHARACTERS) {
    return { valid: false, code: "INITIAL_PROMPT_TOO_LONG", message: `The Initial Prompt exceeds ${INITIAL_PROMPT_MAX_CHARACTERS.toLocaleString()} characters.` };
  }
  if (input.pastedContext.length > PASTED_CONTEXT_MAX_CHARACTERS) {
    return { valid: false, code: "PASTED_CONTEXT_TOO_LONG", message: `Pasted context exceeds ${PASTED_CONTEXT_MAX_CHARACTERS.toLocaleString()} characters. Nothing was truncated.` };
  }
  if (input.file && input.pastedContext.trim()) {
    return { valid: false, code: "MULTIPLE_CONTEXT_SOURCES", message: "Use pasted context or one file, not both." };
  }
  if (!input.file) return { valid: true, extension: null };
  if (input.file.size === 0) {
    return { valid: false, code: "EMPTY_FILE", message: "The selected file is empty. Replace or remove it before continuing." };
  }
  if (input.file.size > CONTEXT_FILE_MAX_BYTES) {
    return { valid: false, code: "FILE_TOO_LARGE", message: "The selected file exceeds the 10 MB project limit. Nothing was uploaded or truncated." };
  }
  const extension = contextFileExtension(input.file.name);
  if (!extension) {
    return { valid: false, code: "UNSUPPORTED_FILE", message: "Choose one .md, .txt, .pdf, or .docx file." };
  }
  return { valid: true, extension };
}

export function isServerExtractionRequired(filename: string): boolean {
  const extension = contextFileExtension(filename);
  return extension === ".pdf" || extension === ".docx";
}
