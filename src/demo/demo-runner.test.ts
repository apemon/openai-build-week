import { describe, expect, it } from "vitest";
import { PreparedDemoRunner } from "./demo-runner";
import { teamBillingDecisions } from "./team-billing-scenario";
import { validateTeamBillingSnapshotsSemantically } from "./validate-team-billing-snapshots";

describe("PreparedDemoRunner", () => {
  it("advances through every prevalidated snapshot without external services", () => {
    expect(validateTeamBillingSnapshotsSemantically()).toEqual({ success: true, snapshotCount: 8 });
    const runner = new PreparedDemoRunner();
    const steps = teamBillingDecisions.map(() => runner.advance("2026-07-20T00:00:00.000Z"));
    expect(steps).toHaveLength(8);
    expect(steps.at(-1)?.nextPrompt).toBeNull();
    expect(steps.at(-1)?.specification.readiness.status).toBe("ready_with_follow_ups");
    expect(runner.complete).toBe(true);
  });

  it("keeps prepared audio local", () => {
    expect(teamBillingDecisions.every((decision) => decision.audioSrc.startsWith("/demo-audio/") && decision.audioSrc.endsWith(".mp3"))).toBe(true);
  });
});
