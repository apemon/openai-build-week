import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preparedAnswerIntakePrompt, preparedInitialAnswerAssessment } from "@/demo/v3-1-prepared-answer-intake";
import { AnswerIntakeStatus } from "./AnswerIntakeStatus";

afterEach(cleanup);

describe("AnswerIntakeStatus", () => {
  it("presents exact Brain-authored aspect coverage and one bounded clarification accessibly", () => {
    render(<AnswerIntakeStatus prompt={preparedAnswerIntakePrompt} state="clarifying" assessment={preparedInitialAnswerAssessment} contributionCount={1} clarificationCount={1} mode="demo" />);
    expect(screen.getByRole("heading", { name: "One clarification" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brain-authored answer aspects" })).toBeInTheDocument();
    expect(screen.getByText("Product").closest("li")).toHaveTextContent("Covered");
    expect(screen.getByText("Current pain").closest("li")).toHaveTextContent("Missing");
    expect(screen.getByRole("heading", { name: preparedInitialAnswerAssessment.clarificationQuestion! })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Contribution 1 of 3 · Clarification 1 of 2");
    expect(screen.getByText("Prepared demo • no AI call")).toBeInTheDocument();
    expect(screen.getByText(/Captured contributions remain temporary/)).toBeInTheDocument();
  });

  it("does not render partial coverage from an assessment outside the active prompt", () => {
    render(<AnswerIntakeStatus prompt={preparedAnswerIntakePrompt} state="assessing" assessment={{ ...preparedInitialAnswerAssessment, coverage: preparedInitialAnswerAssessment.coverage.slice(0, 1) }} contributionCount={9} clarificationCount={9} mode="live" />);
    expect(screen.getByText("Coverage not assessed")).toBeInTheDocument();
    expect(screen.getAllByText("Not assessed")).toHaveLength(preparedAnswerIntakePrompt.answerAspects.length);
    expect(screen.getByRole("status")).toHaveTextContent("Contribution 3 of 3 · Clarification 2 of 2");
  });

  it("offers early review only through the supplied explicit action", async () => {
    const user = userEvent.setup();
    const onReviewNow = vi.fn();
    render(<AnswerIntakeStatus prompt={preparedAnswerIntakePrompt} state="listening" contributionCount={0} clarificationCount={0} mode="live" onReviewNow={onReviewNow} />);
    await user.click(screen.getByRole("button", { name: "Review answer now" }));
    expect(onReviewNow).toHaveBeenCalledOnce();
  });

  it("uses a compact truthful collecting state without rendering captured wording", () => {
    render(<AnswerIntakeStatus prompt={preparedAnswerIntakePrompt} state="collecting" contributionCount={1} clarificationCount={0} mode="live" />);
    expect(screen.getByRole("heading", { name: "Collecting your answer" })).toBeInTheDocument();
    expect(screen.getByText("Your current contribution remains temporary while transcription finishes.")).toBeInTheDocument();
    expect(screen.queryByText(/Workspace owners cannot/)).not.toBeInTheDocument();
  });

  it("has no serious or critical automated accessibility violations", async () => {
    const { container } = render(<AnswerIntakeStatus prompt={preparedAnswerIntakePrompt} state="clarifying" assessment={preparedInitialAnswerAssessment} contributionCount={2} clarificationCount={1} mode="demo" onReviewNow={vi.fn()} />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });
});
