import type { BrainHarness } from "@/domain/brain-harness";
import { brainStreamEnvelopeSchema } from "@/domain/v3-schemas";
import type { ApiError } from "@/domain/types";
import type { BrainLifecycleEvent, BrainStreamEnvelope, V3BrainRequest } from "@/domain/v3-schemas";
import { validateLifecycleSequence } from "@/domain/v3-invariants";

import { BrainRunError } from "./retry-policy";

export const BRAIN_STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";
export const MAX_BRAIN_STREAM_LINE_BYTES = 1_500_000;
export const MAX_BRAIN_STREAM_BYTES = 2_000_000;

const encoder = new TextEncoder();

function terminalError(error: unknown, requestId: string): ApiError {
  const mapped = error instanceof BrainRunError
    ? error
    : new BrainRunError("INTERNAL_ERROR", "The Brain request failed.", true, { cause: error });
  return { error: { code: mapped.code, message: mapped.message, retryable: mapped.retryable, requestId } };
}

/** The schema is a strict allowlist. This function is the sole NDJSON encoder,
 * keeping lifecycle serialization separate from provider/model payloads. */
export function encodeBrainStreamEnvelope(envelope: BrainStreamEnvelope): Uint8Array {
  const validated = brainStreamEnvelopeSchema.parse(envelope);
  const bytes = encoder.encode(`${JSON.stringify(validated)}\n`);
  if (bytes.byteLength > MAX_BRAIN_STREAM_LINE_BYTES) {
    throw new BrainRunError("INTERNAL_ERROR", "The Brain stream line exceeded its safe bound.", true);
  }
  return bytes;
}

export function createBrainNdjsonStream(
  request: V3BrainRequest,
  harness: BrainHarness,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  let totalBytes = 0;
  let closed = false;
  let lastLifecycle: BrainLifecycleEvent | null = null;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (envelope: BrainStreamEnvelope): void => {
        if (closed) throw new Error("Brain stream received an envelope after its terminal envelope");
        const bytes = encodeBrainStreamEnvelope(envelope);
        totalBytes += bytes.byteLength;
        if (totalBytes > MAX_BRAIN_STREAM_BYTES) {
          throw new BrainRunError("INTERNAL_ERROR", "The Brain stream exceeded its safe bound.", true);
        }
        controller.enqueue(bytes);
      };

      try {
        for await (const event of harness.run(request, signal)) {
          if (event.type === "lifecycle") {
            const sequence = validateLifecycleSequence(lastLifecycle, event.event, {
              requestId: request.requestId,
              actionId: request.actionId,
              baseRevision: request.baseRevision,
              cancelEpoch: request.cancelEpoch,
            });
            if (!sequence.valid) {
              throw new BrainRunError("INTERNAL_ERROR", "The Brain lifecycle stream was invalid.", true);
            }
            lastLifecycle = event.event;
            enqueue(event);
            continue;
          }
          if (event.response.requestId !== request.requestId || event.response.baseRevision !== request.baseRevision) {
            throw new BrainRunError("INTERNAL_ERROR", "The Brain result identity was invalid.", true);
          }
          enqueue(event);
          closed = true;
          controller.close();
          return;
        }
        throw new BrainRunError("INTERNAL_ERROR", "The Brain stream ended before a terminal envelope.", true);
      } catch (error) {
        if (closed) return;
        try {
          enqueue({ type: "error", error: terminalError(error, request.requestId) });
          closed = true;
          controller.close();
        } catch (terminalEncodingError) {
          closed = true;
          controller.error(terminalEncodingError);
        }
      }
    },
  });
}

