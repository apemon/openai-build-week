import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LookaheadPanel } from "./LookaheadPanel";
import { preparedActiveLookahead } from "@/demo/v2-prepared-flow";

describe("LookaheadPanel", () => {
  it("keeps one topic visible and cannot confirm a Decision Summary twice", async () => {
    const user = userEvent.setup();
    let resolveConfirmation!: () => void;
    const confirm = vi.fn(() => new Promise<void>((resolve) => { resolveConfirmation = resolve; }));
    render(<LookaheadPanel active={preparedActiveLookahead} mode="demo" onClarification={vi.fn()} onRequestSummary={vi.fn()} onSummaryChange={vi.fn()} onConfirmSummary={confirm} />);
    expect(screen.getByText("Prepared demo • no AI call")).toBeInTheDocument();
    expect(screen.getByText(/This clarification stays within one approved decision/)).toHaveTextContent("ROADMAP-003");
    const button = screen.getByRole("button", { name: "Confirm and queue pending revalidation" });
    await user.click(button);
    expect(screen.getByRole("button", { name: "Queueing summary…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Queueing summary…" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    resolveConfirmation();
  });
});
