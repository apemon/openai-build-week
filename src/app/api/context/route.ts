import { NextResponse } from "next/server";
import { ContextPreparationError } from "@/context/prepare-context";
import { CONTEXT_FILE_MAX_BYTES } from "@/context/limits";
import { prepareUploadedDocument } from "@/context/extract-document.server";
import { prepareContextLocally } from "@/context/prepare-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MULTIPART_BYTES = CONTEXT_FILE_MAX_BYTES + 250_000;

function responseHeaders(): HeadersInit {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}

function errorResponse(code: string, message: string, retryable: boolean, requestId: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message, retryable, requestId } }, { status, headers: responseHeaders() });
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function fileEntry(value: FormDataEntryValue | null): File | null {
  if (value === null || typeof value === "string") return null;
  if (typeof value.name !== "string" || typeof value.size !== "number" || typeof value.arrayBuffer !== "function") return null;
  return value as File;
}

export async function POST(request: Request): Promise<NextResponse> {
  let requestId = request.headers.get("x-request-id") ?? "UNKNOWN";
  const origin = request.headers.get("origin");
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "http://localhost:3000";
  if (origin !== allowedOrigin) return errorResponse("INVALID_REQUEST", "The request origin is not allowed.", false, requestId, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse("INVALID_REQUEST", "Content-Type must be multipart/form-data.", false, requestId, 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    return errorResponse("FILE_TOO_LARGE", "The preparation request exceeds the 10 MB file limit.", false, requestId, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("INVALID_REQUEST", "The preparation request could not be read.", true, requestId, 400);
  }
  requestId = field(form, "requestId") || requestId;
  const schemaVersion = Number(field(form, "schemaVersion"));
  const sessionId = field(form, "sessionId");
  const initialPrompt = field(form, "initialPrompt");
  const pastedContext = field(form, "pastedContext");
  const file = fileEntry(form.get("file"));
  if (schemaVersion !== 1 || !/^[A-Z][A-Z0-9_-]{1,63}$/.test(sessionId) || !/^[A-Z][A-Z0-9_-]{1,63}$/.test(requestId)) {
    return errorResponse("INVALID_REQUEST", "The preparation request is invalid.", false, requestId, 400);
  }

  try {
    const input = { schemaVersion: 1 as const, sessionId, requestId, initialPrompt, pastedContext, file };
    const prepared = file && (file.name.toLowerCase().endsWith(".pdf") || file.name.toLowerCase().endsWith(".docx"))
      ? await prepareUploadedDocument({ ...input, file })
      : await prepareContextLocally(input);
    return NextResponse.json(prepared, { status: 200, headers: responseHeaders() });
  } catch (error) {
    const failure = error instanceof ContextPreparationError
      ? error
      : new ContextPreparationError("CORRUPT_DOCUMENT", "The context could not be prepared. Replace it or retry.", true, { cause: error });
    const status = failure.code === "PDF_PAGE_LIMIT" || failure.code === "EXTRACTION_TOO_LARGE" ? 413 : failure.code === "CORRUPT_DOCUMENT" ? 422 : 400;
    return errorResponse(failure.code, failure.message, failure.retryable, requestId, status);
  }
}
