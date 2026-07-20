import { describe, expect, it } from "vitest";
import { derivePersistentBrainStatus } from "@/components/interview/PersistentBrainStatus";
import {
  PREPARED_V3_ACTION_STARTED_AT,
  PreparedV3DemoRunner,
  preparedV3DecisionBatch,
  preparedV3Frames,
  preparedV3FinalMarkdown,
  preparedV3InterviewWindow,
  preparedV3LifecycleEvents,
  preparedV3RevalidatedJobs,
  validatePreparedV3Fixtures,
} from "./v3-prepared-flow";

describe("V3 Prepared Demo fixtures", () => {
  it("uses a validated two-permit window and sequential user-paced frames", () => {
    expect(validatePreparedV3Fixtures()).toEqual({ success: true, frameCount: preparedV3Frames.length });
    expect(preparedV3InterviewWindow.permits).toHaveLength(2);
    const opened = preparedV3Frames.find((frame) => frame.stage === "window_opened")!;
    expect(opened.jobs).toHaveLength(1);
    expect(opened.interviewWindow!.permits).toHaveLength(2);
    const runner = new PreparedV3DemoRunner();
    const stages = [runner.current.stage];
    while (!runner.complete) stages.push(runner.advance().stage);
    expect(stages).toEqual(preparedV3Frames.map((frame) => frame.stage));
  });

  it("simulates the greater-than-30-second transition without a real wait", () => {
    const frame = preparedV3Frames.find((candidate) => candidate.stage === "taking_longer")!;
    const status = derivePersistentBrainStatus({ state: frame.activityState, actionId: "ACTION-PREPARED-V3-ANSWER", acceptedAt: PREPARED_V3_ACTION_STARTED_AT, lastLifecycleAt: frame.lastLifecycleAt, lastSequence: preparedV3LifecycleEvents.at(-2)!.sequence }, Date.parse(PREPARED_V3_ACTION_STARTED_AT) + frame.elapsedMs);
    expect(status.state).toBe("taking_longer");
    expect(status.elapsedSeconds).toBe(31);
  });

  it("applies the authoritative revision first, invalidates one job, and batches exactly the valid entry", () => {
    const appliedRevision = preparedV3Frames.findIndex((frame) => frame.stage === "authoritative_revision_applied");
    const revalidated = preparedV3Frames.findIndex((frame) => frame.stage === "jobs_revalidated");
    const batch = preparedV3Frames.findIndex((frame) => frame.stage === "batch_auto_submitted");
    expect(appliedRevision).toBeLessThan(revalidated);
    expect(revalidated).toBeLessThan(batch);
    expect(preparedV3RevalidatedJobs.map((job) => job.status)).toEqual(["ready_to_apply", "not_applied"]);
    expect(preparedV3DecisionBatch.entries).toHaveLength(1);
    expect(preparedV3DecisionBatch.entries[0].jobId).toBe(preparedV3RevalidatedJobs[0].id);
    expect(preparedV3Frames.at(-1)?.exportReady).toBe(true);
    expect(preparedV3Frames.at(-1)?.exportMarkdown).toBe(preparedV3FinalMarkdown);
    expect(preparedV3FinalMarkdown).toContain("Prepared demo data — not live AI output");
    expect(preparedV3FinalMarkdown).not.toContain("Not Applied");
    expect(preparedV3FinalMarkdown).not.toContain(preparedV3RevalidatedJobs[1].decisionSummary!.text);
  });
});
