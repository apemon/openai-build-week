import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionLinkCard } from "./SessionLinkCard";

const sessionUrl = "https://example.test/?thread=0199a213-81c0-7800-8aa1-bbab2a035a53";
const threadId = "0199a213-81c0-7800-8aa1-bbab2a035a53";
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("SessionLinkCard", () => {
  it("labels the local-only boundary and displays only a bounded session ID", () => {
    const { container } = render(<SessionLinkCard sessionUrl={sessionUrl} threadId={threadId} expiresAt="2026-07-21T00:30:00.000Z" onCopy={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Hackathon Codex session" })).toBeInTheDocument();
    expect(screen.getByText("Resumes on this machine only while the matching browser checkpoint and local Codex session exist.")).toBeInTheDocument();
    expect(screen.getByText("0199a213…035a53")).toBeInTheDocument();
    expect(screen.queryByText(threadId)).not.toBeInTheDocument();
    expect(screen.getByText("Expires 2026-07-21 00:30:00 UTC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy session link" })).toHaveClass("min-h-11");
    expect(container.querySelector('a[href^="codex://"]')).not.toBeInTheDocument();
  });

  it("copies the exact session URL and announces success", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<SessionLinkCard sessionUrl={sessionUrl} threadId={threadId} expiresAt="2026-07-21T00:30:00.000Z" />);
    await user.click(screen.getByRole("button", { name: "Copy session link" }));
    expect(writeText).toHaveBeenCalledWith(sessionUrl);
    expect(screen.getByRole("status")).toHaveTextContent("Session link copied.");
  });

  it("uses the supplied copy boundary and reports failure without exposing an error", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockRejectedValue(new Error("provider details must stay hidden"));
    render(<SessionLinkCard sessionUrl={sessionUrl} threadId={threadId} expiresAt="invalid" onCopy={onCopy} />);
    await user.click(screen.getByRole("button", { name: "Copy session link" }));
    expect(onCopy).toHaveBeenCalledWith(sessionUrl);
    expect(screen.getByRole("status")).toHaveTextContent("Could not copy session link.");
    expect(screen.queryByText(/provider details/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy session link" })).toBeEnabled();
  });
});
