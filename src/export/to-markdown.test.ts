import { describe, expect, it } from "vitest";
import { teamBillingSnapshots } from "@/demo/team-billing-snapshots";
import { markdownFilename, specificationToMarkdown } from "./to-markdown";
import { migrateSpecificationToV3 } from "@/domain/v3-invariants";

describe("Specification Markdown export", () => {
  it("uses the required section order and prepared provenance", () => {
    const markdown = specificationToMarkdown(teamBillingSnapshots.at(-1)!, { mode: "demo", finalized: false, exportedAt: new Date("2026-07-20T00:00:00.000Z") });
    expect(markdown).toContain("Prepared demo data — not live AI output");
    expect(markdown).toContain("DRAFT — this Specification has not been finalized");
    const headings = ["## Readiness", "## Problem statement", "## Users and jobs-to-be-done", "## Functional requirements", "## Non-functional requirements", "## Assumptions", "## Risks and edge cases", "## Acceptance Criteria", "## Blockers", "## Open Questions", "## Next Actions"];
    expect(headings.map((heading) => markdown.indexOf(heading))).toEqual([...headings.map((heading) => markdown.indexOf(heading))].sort((a, b) => a - b));
    expect(markdown).not.toContain("We need team billing for our SaaS.");
  });

  it("builds a stable dated filename", () => {
    expect(markdownFilename("Team Billing / SaaS", new Date("2026-07-20T00:00:00.000Z"))).toBe("spec-grill-team-billing-saas-2026-07-20.md");
  });

  it("exports evidence provenance while excluding Decision Tray wording", () => {
    const specification = migrateSpecificationToV3(teamBillingSnapshots.at(-1)!);
    const informed = specification.functionalRequirements.find((item) => item.id === "FR-015")!;
    informed.externalEvidenceIds = ["EVID-001"];
    specification.externalEvidence = [{ id: "EVID-001", title: "Public tax documentation", url: "https://example.com/tax", retrievedAt: "2026-07-21T00:00:00.000Z", informedTargets: [{ kind: "specification_item", itemId: informed.id }] }];
    const markdown = specificationToMarkdown(specification, { mode: "live", finalized: true, experimental: { adapter: "responses_native", publicSearchEnabled: true } });
    expect(markdown).toContain("Local experimental Brain evaluation — not ordinary Live Mode output");
    expect(markdown).toContain("## External Evidence");
    expect(markdown).toContain("Evidence: EVID-001");
    expect(markdown).not.toContain("Decision Tray");
    expect(markdown).not.toContain("Not Applied");
  });
});
