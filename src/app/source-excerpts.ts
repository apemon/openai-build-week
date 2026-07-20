import type {
  ExtractedSourceExcerpt,
  QuestionRoadmap,
  TemporaryContextExtraction,
} from "@/domain/types";

const MAX_EXCERPT_CHARACTERS = 4_000;
export const MAX_BRAIN_EXCERPT_CHARACTERS = 24_000;
export const MAX_BRAIN_EXCERPTS = 6;

function terms(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("en")
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 3),
  );
}

function scoreExcerpt(excerpt: ExtractedSourceExcerpt, queryTerms: Set<string>): number {
  const searchable = terms(`${excerpt.reference.heading ?? ""} ${excerpt.reference.location} ${excerpt.text}`);
  let score = 0;
  for (const term of queryTerms) if (searchable.has(term)) score += 1;
  return score;
}

/** Selects a small, source-addressable subset for the current dependency area.
 * The active tab retains the complete extraction; this function never returns
 * more than 24k characters or six excerpts for a routine Brain turn. */
export function selectRelevantSourceExcerpts(
  extraction: TemporaryContextExtraction | null,
  roadmap: QuestionRoadmap,
  currentQuestion: string | null,
): ExtractedSourceExcerpt[] {
  if (!extraction) return [];

  const currentItem = roadmap.items.find((item) => item.id === roadmap.currentDecisionItemId);
  const unresolvedDependencies = roadmap.items.filter((item) => roadmap.unresolvedDependencyIds.includes(item.id));
  const queryTerms = terms([
    currentQuestion ?? "",
    currentItem?.topic ?? "",
    currentItem?.decisionKey ?? "",
    ...unresolvedDependencies.flatMap((item) => [item.topic, item.decisionKey]),
  ].join(" "));

  const ranked = extraction.excerpts
    .map((excerpt, index) => ({ excerpt, index, score: scoreExcerpt(excerpt, queryTerms) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected: ExtractedSourceExcerpt[] = [];
  let characters = 0;
  for (const candidate of ranked) {
    if (selected.length >= MAX_BRAIN_EXCERPTS || characters >= MAX_BRAIN_EXCERPT_CHARACTERS) break;
    const remaining = MAX_BRAIN_EXCERPT_CHARACTERS - characters;
    const text = candidate.excerpt.text.slice(0, Math.min(MAX_EXCERPT_CHARACTERS, remaining)).trim();
    if (!text) continue;
    selected.push({ ...candidate.excerpt, text });
    characters += text.length;
  }
  return selected;
}
