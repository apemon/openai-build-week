import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { preparedV3DraftJobs, preparedV3RevalidatedJobs } from "@/demo/v3-prepared-flow";
import { DecisionTray } from "./DecisionTray";
import { InterviewWindowQuestion } from "./InterviewWindowQuestion";

describe("V3 asynchronous interview presentation", () => {
  it("renders one active question and only topic/count information for future permits", () => {
    render(<InterviewWindowQuestion activeJob={preparedV3DraftJobs[0]} futureTopics={[{ permitId: preparedV3DraftJobs[1].permit.id, topic: "Seat changes" }]} mode="demo" />);
    expect(screen.getByRole("heading", { name: preparedV3DraftJobs[0].permit.prompt.detailedQuestion })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Clarification exchange" })).toBeInTheDocument();
    expect(screen.getByText(/Use active seats billed monthly in USD/)).toBeInTheDocument();
    expect(screen.getByText("1 future permitted topic")).toBeInTheDocument();
    expect(screen.getByText("Seat changes")).toBeInTheDocument();
    expect(screen.queryByText(preparedV3DraftJobs[1].permit.prompt.detailedQuestion)).not.toBeInTheDocument();
  });

  it("explains dependency invalidation and supports wording reuse", async () => {
    const user = userEvent.setup();
    const reuse = vi.fn();
    render(<DecisionTray jobs={preparedV3RevalidatedJobs} activeJobId={null} onReuse={reuse} />);
    expect(screen.getByText("Ready to apply")).toBeInTheDocument();
    expect(screen.getByText("Not Applied")).toBeInTheDocument();
    expect(screen.getByText("Dependency checking rejected this work before Brain submission.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reuse wording" }));
    expect(reuse).toHaveBeenCalledWith(preparedV3RevalidatedJobs[1].decisionSummary?.text);
  });

  it("shows immediate confirmation feedback and ignores repeated activation", async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const confirm = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(<DecisionTray jobs={[preparedV3DraftJobs[0]]} activeJobId={preparedV3DraftJobs[0].id} onConfirm={confirm} />);
    await user.click(screen.getByRole("button", { name: "Confirm decision and continue" }));
    const pending = screen.getByRole("button", { name: "Confirming decision…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(confirm).toHaveBeenCalledTimes(1);
    resolve();
  });
});
