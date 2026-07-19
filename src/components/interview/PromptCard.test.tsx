import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initialInterviewPrompt } from "@/domain/initial-state";
import { PromptCard } from "./PromptCard";

describe("PromptCard controls", () => {
  it("shows Answer now only when the Live voice callback is supplied", async () => {
    const user = userEvent.setup();
    const onAnswerNow = vi.fn();
    const { rerender, unmount } = render(<PromptCard prompt={initialInterviewPrompt} onDefer={() => {}} />);
    expect(screen.queryByRole("button", { name: "Answer now" })).not.toBeInTheDocument();
    rerender(<PromptCard prompt={initialInterviewPrompt} onDefer={() => {}} onAnswerNow={onAnswerNow} />);
    await user.click(screen.getByRole("button", { name: "Answer now" }));
    expect(onAnswerNow).toHaveBeenCalledOnce();
    unmount();
  });

  it("hides Defer when the mode has no deferral operation", () => {
    const { unmount } = render(<PromptCard prompt={initialInterviewPrompt} />);
    expect(screen.queryByRole("button", { name: "Defer" })).not.toBeInTheDocument();
    unmount();
  });

  it("submits an optional deferral note through the deferral boundary", async () => {
    const user = userEvent.setup();
    const onDefer = vi.fn();
    render(<PromptCard prompt={initialInterviewPrompt} onDefer={onDefer} />);
    await user.click(screen.getByRole("button", { name: "Defer" }));
    await user.type(screen.getByLabelText("Optional deferral note"), "Pricing committee meets Friday");
    await user.click(screen.getByRole("button", { name: "Confirm deferral" }));
    expect(onDefer).toHaveBeenCalledWith("Pricing committee meets Friday");
  });
});
