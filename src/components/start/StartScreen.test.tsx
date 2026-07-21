import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartScreen } from "./StartScreen";

afterEach(cleanup);

describe("StartScreen linked-session notice", () => {
  it("shows an accessible warning without disabling fresh Live or Prepared actions", async () => {
    const user = userEvent.setup();
    const onStartLiveText = vi.fn();
    const onStartPreparedDemo = vi.fn();
    render(<StartScreen liveEnabled linkedSessionNotice="This session is unavailable in this tab." onEnableMicrophone={vi.fn()} onStartLiveText={onStartLiveText} onStartPreparedDemo={onStartPreparedDemo} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This session is unavailable in this tab.");
    await user.click(screen.getByRole("button", { name: "Continue with text only" }));
    await user.click(screen.getByRole("button", { name: "Run prepared demo" }));
    expect(onStartLiveText).toHaveBeenCalledOnce();
    expect(onStartPreparedDemo).toHaveBeenCalledOnce();
  });

  it("renders no empty alert when no linked-session notice exists", () => {
    render(<StartScreen liveEnabled onEnableMicrophone={vi.fn()} onStartLiveText={vi.fn()} onStartPreparedDemo={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Live AI", { exact: true })).toBeInTheDocument();
  });

  it("uses an optional Brain label and truthfully describes local Codex persistence", () => {
    render(<StartScreen liveEnabled brainLabel="Hackathon Codex" onEnableMicrophone={vi.fn()} onStartLiveText={vi.fn()} onStartPreparedDemo={vi.fn()} />);
    expect(screen.getByText("Hackathon Codex", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Live AI", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/does not retain raw audio/)).toHaveTextContent("Confirmed Brain inputs and validated outputs may persist in the local hackathon Codex session until its local session store is cleared.");
    expect(screen.getByText("Do not enter confidential or regulated information in this hackathon demo.")).toBeInTheDocument();
  });
});
