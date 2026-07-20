import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectContextDigestReview } from "./ProjectContextDigestReview";
import type { ProjectContextDigest } from "@/domain/types";

const digest: ProjectContextDigest = {
  id: "DIGEST-TEST",
  initialPrompt: "Build billing.",
  statements: [{ id: "CTX-001", statement: "Build billing.", sourceReferences: [{ sourceId: "SOURCE-INITIAL", location: "Initial Prompt", page: null, heading: null, paragraph: 1 }] }],
  sources: [{ id: "SOURCE-INITIAL", kind: "initial_prompt", filename: null, mimeType: "text/plain", sizeBytes: null, characterCount: 14, pageCount: null }],
  coverage: { coveredLocations: ["Initial Prompt"], omissions: ["Page 2 contained no recoverable text."], warnings: ["One page was blank."], requiresAcknowledgement: true },
  confirmedAt: null,
};

describe("ProjectContextDigestReview", () => {
  it("requires warning acknowledgement and gives duplicate-safe immediate confirmation feedback", async () => {
    const user = userEvent.setup();
    let resolveConfirmation!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { resolveConfirmation = resolve; }));
    const onAcknowledged = vi.fn();
    const { rerender } = render(<ProjectContextDigestReview digest={digest} warningAcknowledged={false} mode="live" onDigestChange={vi.fn()} onWarningAcknowledged={onAcknowledged} onConfirm={onConfirm} />);
    expect(screen.getByRole("button", { name: "Confirm digest and start interview" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(onAcknowledged).toHaveBeenCalledWith(true);
    rerender(<ProjectContextDigestReview digest={digest} warningAcknowledged mode="live" onDigestChange={vi.fn()} onWarningAcknowledged={onAcknowledged} onConfirm={onConfirm} />);
    const button = screen.getByRole("button", { name: "Confirm digest and start interview" });
    await user.click(button);
    expect(screen.getByRole("button", { name: "Confirming digest…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Confirming digest…" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolveConfirmation();
  });
});
