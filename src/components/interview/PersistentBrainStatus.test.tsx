import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { derivePersistentBrainStatus, PersistentBrainStatus, type PersistentBrainActivity } from "./PersistentBrainStatus";

const acceptedAt = "2026-07-21T00:00:00.000Z";

function activity(overrides: Partial<PersistentBrainActivity> = {}): PersistentBrainActivity {
  return { state: "working", actionId: "ACTION-001", acceptedAt, lastLifecycleAt: acceptedAt, lastSequence: 1, ...overrides };
}

describe("PersistentBrainStatus", () => {
  it("uses the action-level 30-second threshold while lifecycle evidence is fresh", () => {
    const result = derivePersistentBrainStatus(activity({ lastLifecycleAt: "2026-07-21T00:00:30.000Z" }), Date.parse("2026-07-21T00:00:30.000Z"));
    expect(result.state).toBe("taking_longer");
    expect(result.elapsedSeconds).toBe(30);
    expect(result.activeAnimation).toBe(true);
  });

  it("gives 10-second lifecycle silence precedence and stops healthy animation", () => {
    const result = derivePersistentBrainStatus(activity(), Date.parse("2026-07-21T00:00:31.000Z"));
    expect(result.state).toBe("needs_attention");
    expect(result.label).toBe("Waiting for verified activity");
    expect(result.detail).toContain("request may still be running");
    expect(result.activeAnimation).toBe(false);
  });

  it("keeps interrupted work visible until an explicit retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<PersistentBrainStatus activity={activity({ state: "connection_interrupted", lastLifecycleAt: "2026-07-21T00:00:05.000Z" })} nowMs={Date.parse("2026-07-21T00:00:12.000Z")} onRetry={retry} />);
    expect(screen.getByLabelText("Persistent Brain Status")).toHaveAttribute("data-state", "connection_interrupted");
    expect(screen.getByText("Connection interrupted · Brain state unknown")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("uses validated fixture timestamps instead of wall time in Prepared Demo", () => {
    const { container } = render(<PersistentBrainStatus activity={activity({ state: "taking_longer", lastLifecycleAt: "2026-07-21T00:00:31.000Z" })} mode="demo" />);
    expect(within(container).getByLabelText("Persistent Brain Status")).toHaveAttribute("data-state", "taking_longer");
    expect(within(container).getByText("31s")).toBeInTheDocument();
    expect(within(container).getByText("0s ago")).toBeInTheDocument();
  });
});
