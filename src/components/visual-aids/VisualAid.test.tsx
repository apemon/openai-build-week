import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { teamBillingPrompts } from "@/demo/team-billing-snapshots";
import { VisualAid } from "./VisualAid";

describe("VisualAid", () => {
  it("provides a text-equivalent relationship list", () => {
    const aid = teamBillingPrompts[1].visualAid!;
    render(<VisualAid aid={aid} />);
    expect(screen.getByText("Billing roles to clarify")).toBeInTheDocument();
    expect(screen.getByText(/Owner assigns Billing Admin/)).toBeInTheDocument();
  });
});
