import type { BrainErrorCode } from "./retry-policy";
import type { BrainOperation } from "@/domain/types";

type BrainSubmissionBase = {
  requestId: string;
  operation: BrainOperation;
  baseRevision: number;
  turnCount: number;
  requestedModel: string;
};

type BrainSubmissionEvent =
  | (BrainSubmissionBase & { event: "submitted" })
  | (BrainSubmissionBase & {
      event: "succeeded";
      elapsedMs: number;
      revision: number;
      actualModel: string;
      repairAttempted: boolean;
    })
  | (BrainSubmissionBase & {
      event: "failed";
      elapsedMs: number;
      errorCode: BrainErrorCode;
      retryable: boolean;
      status: number;
    });

export function logBrainSubmission(event: BrainSubmissionEvent): void {
  if (process.env.BRAIN_DEBUG_LOGS !== "true") return;

  console.info(
    "[spec-grill:brain]",
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    }),
  );
}
