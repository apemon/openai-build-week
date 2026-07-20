import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/context/route";

const allowedOrigin = "http://localhost:3000";
let priorOrigin: string | undefined;

function request(form: FormData, headers: Record<string, string> = {}): Request {
  return new Request(`${allowedOrigin}/api/context`, {
    method: "POST",
    headers: { origin: allowedOrigin, "x-request-id": "REQUEST-ROUTE", ...headers },
    body: form,
  });
}

function validForm(): FormData {
  const form = new FormData();
  form.set("schemaVersion", "1");
  form.set("sessionId", "SESSION-ROUTE");
  form.set("requestId", "REQUEST-ROUTE");
  form.set("initialPrompt", "Build a source-linked intake flow.");
  form.set("pastedContext", "# Constraints\n\nOne optional source only.");
  return form;
}

describe("ephemeral context preparation route", () => {
  beforeEach(() => {
    priorOrigin = process.env.ALLOWED_ORIGIN;
    process.env.ALLOWED_ORIGIN = allowedOrigin;
  });

  afterEach(() => {
    if (priorOrigin === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = priorOrigin;
  });

  it("returns a validated, non-cacheable digest without echoing multipart bytes", async () => {
    const response = await POST(request(validForm()));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body).toMatchObject({
      schemaVersion: 1,
      requestId: "REQUEST-ROUTE",
      digest: { confirmedAt: null, sources: expect.arrayContaining([expect.objectContaining({ kind: "pasted_text" })]) },
    });
    expect(JSON.stringify(body)).not.toContain("multipart/form-data");
  });

  it("rejects a foreign origin before reading context", async () => {
    const response = await POST(request(validForm(), { origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST", retryable: false } });
  });

  it("returns actionable failures for unsupported and empty uploads", async () => {
    const unsupported = validForm();
    unsupported.set("pastedContext", "");
    unsupported.set("file", new File(["payload"], "context.csv", { type: "text/csv" }));
    const unsupportedResponse = await POST(request(unsupported));
    expect(unsupportedResponse.status).toBe(400);
    await expect(unsupportedResponse.json()).resolves.toMatchObject({ error: { code: "INVALID_CONTEXT" } });

    const empty = validForm();
    empty.set("pastedContext", "");
    empty.set("file", new File([], "empty.txt", { type: "text/plain" }));
    const emptyResponse = await POST(request(empty));
    expect(emptyResponse.status).toBe(400);
    await expect(emptyResponse.json()).resolves.toMatchObject({ error: { code: "INVALID_CONTEXT" } });
  });
});
