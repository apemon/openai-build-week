import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "@/domain/initial-state";
import { InterviewRoom } from "./InterviewRoom";

afterEach(cleanup);

describe("InterviewRoom session-link placement", () => {
  it("renders an optional session link immediately after the session header", () => {
    render(<InterviewRoom state={{ ...createInitialState("live"), phase: "presenting_prompt" }} remainingLabel="29:00" microphoneState="off" voiceMuted onToggleVoice={vi.fn()} onResumeMicrophone={vi.fn()} onCreateDraft={vi.fn()} onEditDraft={vi.fn()} onConfirmDraft={vi.fn()} onRecordAgain={vi.fn()} onReviewSpecification={vi.fn()} onCorrectItem={vi.fn()} sessionLink={<section aria-label="Live session link">Link card</section>} />);
    const header = screen.getByText("Spec Grill").closest("header");
    const link = screen.getByRole("region", { name: "Live session link" });
    const tabs = screen.getByRole("tablist", { name: "Session details" });
    expect(header).not.toBeNull();
    expect(header!.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
