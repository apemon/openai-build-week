import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ExternalEvidence } from "@/domain/v3-schemas";
import { ExternalEvidenceAppendix, ExternalEvidenceCitations } from "./ExternalEvidence";

const evidence: ExternalEvidence = {
  id: "EVID-001",
  title: "Public billing guidance",
  url: "https://example.com/billing-guidance",
  retrievedAt: "2026-07-21T00:00:00.000Z",
  informedTargets: [{ kind: "specification_item", itemId: "FR-005" }],
};

describe("External Evidence presentation", () => {
  it("uses descriptive safe new-tab links and identifies evidence as non-authoritative", () => {
    render(<><ExternalEvidenceCitations evidence={[evidence]} evidenceIds={[evidence.id]} /><ExternalEvidenceAppendix evidence={[evidence]} /></>);
    const links = screen.getAllByRole("link", { name: /Open external evidence EVID-001/ });
    expect(links[0]).toHaveAttribute("href", "https://example.com/billing-guidance");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByText("https://example.com/billing-guidance")).toHaveLength(2);
    expect(screen.getAllByText("2026-07-21 00:00:00 UTC")).toHaveLength(2);
    expect(screen.getByText(/they are not Confirmed Input/)).toBeInTheDocument();
  });

  it("does not create an anchor for an unsafe URL even if validation was bypassed", () => {
    const { container } = render(<ExternalEvidenceCitations evidence={[{ ...evidence, url: "http://example.com" } as ExternalEvidence]} evidenceIds={[evidence.id]} />);
    expect(within(container).queryByRole("link")).not.toBeInTheDocument();
    expect(within(container).getByText("Unsafe or unavailable URL")).toBeInTheDocument();
    expect(within(container).getByText("EVID-001")).toBeInTheDocument();
  });
});
