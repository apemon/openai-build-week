import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextIntake } from "@/components/context/ContextIntake";
import { ProjectContextDigestReview } from "@/components/context/ProjectContextDigestReview";
import { PendingWorkReview } from "@/components/final-review/PendingWorkReview";
import { LookaheadPanel } from "@/components/interview/LookaheadPanel";
import { createInitialContextDigest, initialInterviewPrompt } from "@/domain/initial-state";
import type { ActiveLookahead } from "@/domain/types";

const timestamp = "2026-07-20T00:00:00.000Z";

afterEach(cleanup);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function activeLookahead(status: ActiveLookahead["status"] = "summary_draft"): ActiveLookahead {
  return {
    approval: {
      roadmapItemId: "ROADMAP-001",
      prompt: { ...initialInterviewPrompt, id: "PROMPT-LOOKAHEAD", decisionKey: "permissions" },
      approvedAtRevision: 1,
      dependencyVersion: "DEPENDENCY-1",
      independentOfOperation: "answer",
    },
    status,
    clarificationTurns: [{ id: "CLARIFICATION-001", role: "product_manager", text: "Owners manage billing.", createdAt: timestamp }],
    decisionSummary: {
      id: "SUMMARY-001",
      roadmapItemId: "ROADMAP-001",
      text: "Workspace Owners manage billing.",
      uncertainties: [],
      status: status === "queued" ? "confirmed_queued" : "draft",
      approvedAtRevision: 1,
      dependencyVersion: "DEPENDENCY-1",
      confirmedAt: status === "queued" ? timestamp : null,
      staleReason: null,
    },
  };
}

describe("V2 immediate feedback and duplicate-action protection", () => {
  it("locks context preparation immediately after the first activation", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onPrepare = vi.fn(() => pending.promise);
    render(<ContextIntake mode="live" initialValues={{ initialPrompt: "Build team billing." }} onPrepare={onPrepare} />);

    const button = screen.getByRole("button", { name: "Prepare context" });
    await user.dblClick(button);
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Preparing context…" })).toBeDisabled();
    expect(screen.getByText("Input accepted. Validation and extraction are starting.")).toBeInTheDocument();
    pending.resolve();
  });

  it("blocks a partial digest until acknowledgement and locks confirmation once accepted", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onConfirm = vi.fn(() => pending.promise);
    const digest = {
      ...createInitialContextDigest(new Date(timestamp)),
      confirmedAt: null,
      coverage: {
        coveredLocations: ["Initial Prompt", "Page 1"],
        omissions: ["Page 2 contained no recoverable text."],
        warnings: ["Partial extraction"],
        requiresAcknowledgement: true,
      },
    };
    const { rerender } = render(
      <ProjectContextDigestReview
        digest={digest}
        warningAcknowledged={false}
        mode="live"
        onDigestChange={vi.fn()}
        onWarningAcknowledged={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm digest and start interview" })).toBeDisabled();
    expect(screen.getByText("Page 2 contained no recoverable text.")).toBeInTheDocument();

    rerender(
      <ProjectContextDigestReview
        digest={digest}
        warningAcknowledged
        mode="live"
        onDigestChange={vi.fn()}
        onWarningAcknowledged={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await user.dblClick(screen.getByRole("button", { name: "Confirm digest and start interview" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Confirming digest…" })).toBeDisabled();
    pending.resolve();
  });

  it("labels a Decision Summary non-authoritative and queues it only once", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onConfirmSummary = vi.fn(() => pending.promise);
    render(
      <LookaheadPanel
        active={activeLookahead()}
        mode="live"
        onClarification={vi.fn()}
        onRequestSummary={vi.fn()}
        onSummaryChange={vi.fn()}
        onConfirmSummary={onConfirmSummary}
      />,
    );
    expect(screen.getByText("Non-authoritative")).toBeInTheDocument();
    await user.dblClick(screen.getByRole("button", { name: "Confirm and queue pending revalidation" }));
    expect(onConfirmSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Queueing summary…" })).toBeDisabled();
    expect(screen.getByText("Confirmation does not apply this summary to the Specification.")).toBeInTheDocument();
    pending.resolve();
  });

  it("requires explicit acknowledgement before abandoning pending work for Final Review", async () => {
    const user = userEvent.setup();
    const onAbandon = vi.fn();
    render(
      <PendingWorkReview
        pendingRequest={{ requestId: "REQUEST-001", baseRevision: 1, operation: "answer", actionId: "ACTION-001" }}
        activeLookahead={activeLookahead("queued")}
        staleSummaries={[]}
        onAbandonAndReview={onAbandon}
        onKeepWorking={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Abandon pending work and review" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/will be retained as/)).toHaveTextContent("not applied");
    await user.click(screen.getByRole("checkbox"));
    await user.dblClick(button);
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });
});
