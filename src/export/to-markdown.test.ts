import { describe, expect, it } from "vitest";
import { teamBillingSnapshots } from "@/demo/team-billing-snapshots";
import { markdownFilename, specificationToMarkdown } from "./to-markdown";

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
});
