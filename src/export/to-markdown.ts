import type { AcceptanceCriterion, SessionMode, Specification, SpecificationItem } from "@/domain/types";

export interface MarkdownExportOptions {
  exportedAt?: Date;
  mode: SessionMode;
  finalized: boolean;
  brainModel?: string | null;
  realtimeModel?: string | null;
}

const itemSections: readonly [string, keyof Pick<Specification, "problemStatement" | "users" | "jobsToBeDone" | "functionalRequirements" | "nonFunctionalRequirements" | "assumptions" | "risks" | "edgeCases" | "blockers" | "openQuestions">][] = [
  ["Problem statement", "problemStatement"], ["Users and jobs-to-be-done", "users"], ["Functional requirements", "functionalRequirements"], ["Non-functional requirements", "nonFunctionalRequirements"], ["Assumptions", "assumptions"], ["Risks and edge cases", "risks"],
];

function clean(value: string): string { return value.replaceAll("\r", "").replaceAll("\n", " ").trim(); }
function sources(ids: string[]): string { return ids.length ? ids.join(", ") : "none"; }
function renderItem(value: SpecificationItem): string { return `- **${value.id}** [${value.status}] ${clean(value.statement)}  \n  Sources: ${sources(value.sourceTurnIds)}`; }
function renderCriterion(value: AcceptanceCriterion): string {
  const body = value.format === "given_when_then" ? `Given ${clean(value.given ?? "")}; when ${clean(value.when ?? "")}; then ${clean(value.then ?? "")}.` : clean(value.assertion ?? "");
  return `- **${value.id}** [${value.status}] ${body}  \n  Requirements: ${sources(value.requirementIds)} · Sources: ${sources(value.sourceTurnIds)}`;
}
function section(title: string, lines: string[]): string[] { return [`## ${title}`, "", ...(lines.length ? lines : ["_None recorded._"]), ""]; }

export function specificationToMarkdown(specification: Specification, options: MarkdownExportOptions): string {
  const exportedAt = (options.exportedAt ?? new Date()).toISOString();
  const provenance = options.mode === "demo" ? "Prepared demo data — not live AI output" : "Live AI";
  const lines = [`# ${clean(specification.title)}`, "", `Exported: ${exportedAt}`, `Provenance: ${provenance}`];
  if (!options.finalized) lines.push("", "> **DRAFT — this Specification has not been finalized.**");
  if (options.mode === "live") lines.push(`Brain model: ${options.brainModel ?? "not recorded"}`, `Realtime model: ${options.realtimeModel ?? "not recorded"}`);
  lines.push("", "## Readiness", "", `**${specification.readiness.status}**`, ...specification.readiness.evidence.map((value) => `- ${clean(value)}`), "");
  lines.push(...section("Problem statement", specification.problemStatement.map(renderItem)));
  lines.push(...section("Users and jobs-to-be-done", [...specification.users, ...specification.jobsToBeDone].map(renderItem)));
  for (const [title, key] of itemSections.slice(2, 5)) lines.push(...section(title, specification[key].map(renderItem)));
  lines.push(...section("Risks and edge cases", [...specification.risks, ...specification.edgeCases].map(renderItem)));
  lines.push(...section("Acceptance Criteria", specification.acceptanceCriteria.map(renderCriterion)));
  lines.push(...section("Blockers", specification.blockers.map(renderItem)));
  lines.push(...section("Open Questions", specification.openQuestions.map(renderItem)));
  lines.push(...section("Next Actions", specification.nextActions.map((value) => `- **${value.id}** [${value.status}; owner ${value.ownership}] ${clean(value.action)}  \n  Outcome: ${clean(value.intendedOutcome)} · Decision owner: ${value.decisionOwnerRole ?? "to identify"} · Sources: ${sources(value.sourceItemIds)}`)));
  return `${lines.join("\n").trim()}\n`;
}

export function markdownFilename(title: string, exportedAt = new Date()): string {
  const slug = title.toLowerCase().normalize("NFKD").replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 60) || "specification";
  return `spec-grill-${slug}-${exportedAt.toISOString().slice(0, 10)}.md`;
}
