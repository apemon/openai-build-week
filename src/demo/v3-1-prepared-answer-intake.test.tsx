import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreparedAnswerIntakeDemo } from "./PreparedAnswerIntakeDemo";
import {
  preparedAnswerClarification,
  preparedAnswerIntakePrompt,
  preparedAnswerSummaryDraft,
  preparedInitialAnswerAssessment,
  validatePreparedAnswerIntakeFixtures,
} from "./v3-1-prepared-answer-intake";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("V3.1 Prepared Answer Intake", () => {
  it("validates multiple aspects, exactly one missing aspect, and one clarification", () => {
    expect(validatePreparedAnswerIntakeFixtures()).toEqual({ success: true, aspectCount: 2, initialMissingCount: 1, clarificationCount: 1 });
    expect(preparedAnswerIntakePrompt.answerAspects).toHaveLength(2);
    expect(preparedInitialAnswerAssessment.coverage.filter((item) => item.status === "missing")).toEqual([{ aspectId: "ASPECT-002", status: "missing" }]);
    expect(preparedInitialAnswerAssessment.clarificationQuestion).toBe(preparedAnswerClarification.question);
  });

  it("walks through missing coverage, one prepared clarification, and an editable production Answer Summary without external calls", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<PreparedAnswerIntakeDemo onConfirm={onConfirm} />);

    expect(screen.getByText("Current pain").closest("li")).toHaveTextContent("Missing");
    await user.click(screen.getByRole("button", { name: "Continue with prepared clarification" }));
    expect(screen.getByRole("heading", { name: preparedAnswerClarification.question })).toBeInTheDocument();
    expect(screen.getByText(preparedAnswerClarification.answer, { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review prepared Answer Summary" }));

    const editor = screen.getByRole("textbox", { name: "Answer Summary" });
    expect(editor).toHaveValue(preparedAnswerSummaryDraft.text);
    await user.clear(editor);
    await user.type(editor, "Build team billing so workspace owners can pay centrally.");
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send confirmed summary to Brain" }));
    expect(onConfirm).toHaveBeenCalledWith("Build team billing so workspace owners can pay centrally.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
