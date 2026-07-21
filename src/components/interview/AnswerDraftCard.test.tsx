import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerAspect, AnswerDraft } from "@/domain/types";
import { AnswerDraftCard } from "./AnswerDraftCard";

afterEach(cleanup);

const aspects: AnswerAspect[] = [
  { id: "ASPECT-001", label: "Product", description: "What should be built.", required: true },
  { id: "ASPECT-002", label: "Pain", description: "What current pain it solves.", required: true },
  { id: "ASPECT-003", label: "Boundary", description: "What is outside the first release.", required: false },
];

function summary(overrides: Partial<AnswerDraft> = {}): AnswerDraft {
  return {
    text: "Build team billing for workspace owners.",
    source: "communicator_summary",
    promptId: "PROMPT-INITIAL",
    transcriptionItemId: null,
    coverage: [
      { aspectId: "ASPECT-001", status: "covered" },
      { aspectId: "ASPECT-002", status: "missing" },
      { aspectId: "ASPECT-003", status: "uncertain" },
    ],
    uncertainties: ["The first-release boundary still needs confirmation."],
    ...overrides,
  };
}

describe("AnswerDraftCard V3.1 presentation", () => {
  it("renders an editable Answer Summary with exact per-aspect coverage and uncertainties", () => {
    render(<AnswerDraftCard draft={summary()} answerAspects={aspects} onChange={vi.fn()} onConfirm={vi.fn()} onRecordAgain={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Answer Summary" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Answer Summary" })).toHaveValue(summary().text);
    expect(screen.getByText("Product").closest("li")).toHaveTextContent("Covered");
    expect(screen.getByText("Pain").closest("li")).toHaveTextContent("Missing");
    expect(screen.getByText("Boundary").closest("li")).toHaveTextContent("Uncertain");
    expect(screen.getByRole("heading", { name: "Uncertainties" })).toBeInTheDocument();
    expect(screen.getByText("The first-release boundary still needs confirmation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send confirmed summary to Brain" })).toHaveClass("min-h-11");
  });

  it("truthfully falls back when coverage is absent or does not exactly match the active aspects", () => {
    const { rerender } = render(<AnswerDraftCard draft={summary({ coverage: undefined, uncertainties: undefined, source: "typed" })} answerAspects={aspects} onChange={vi.fn()} onConfirm={vi.fn()} onRecordAgain={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Coverage not assessed");
    expect(screen.queryByRole("heading", { name: "Answer aspect coverage" })).not.toBeInTheDocument();
    rerender(<AnswerDraftCard draft={summary({ coverage: [{ aspectId: "ASPECT-001", status: "covered" }] })} answerAspects={aspects} onChange={vi.fn()} onConfirm={vi.fn()} onRecordAgain={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Coverage not assessed");
  });

  it("submits only through the explicit confirmation control and exposes optional clarification return", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onReturnToClarification = vi.fn();
    render(<AnswerDraftCard draft={summary()} answerAspects={aspects} onChange={vi.fn()} onConfirm={onConfirm} onRecordAgain={vi.fn()} onReturnToClarification={onReturnToClarification} />);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Return to clarification" }));
    expect(onReturnToClarification).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send confirmed summary to Brain" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
