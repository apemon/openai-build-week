import { validateBrainOutput } from "@/agents/brain/semantic-validator";
import { createEmptyQuestionRoadmap, createInitialContextDigest, emptySpecification } from "@/domain/initial-state";
import { preparedTurnAt } from "./team-billing-scenario";
import { teamBillingPrompts, teamBillingSnapshots, validatePreparedSnapshots } from "./team-billing-snapshots";

/** Runs the same semantic validator used for production Brain output. Kept out
 * of the browser runner so Prepared Demo ships only fixture data, not Brain
 * validation implementation. */
export function validateTeamBillingSnapshotsSemantically(): { success: true; snapshotCount: number } {
  validatePreparedSnapshots();
  for (let index = 0; index < teamBillingSnapshots.length; index += 1) {
    const turns = Array.from({ length: index + 1 }, (_, turnIndex) => preparedTurnAt(turnIndex));
    const result = validateBrainOutput(
      {
        schemaVersion: 1,
        sessionId: "SESSION-DEMO-VALIDATION",
        mode: "live",
        requestId: `REQUEST-DEMO-${index}`,
        baseRevision: index,
        operation: "answer",
        turns,
        confirmedContextDigest: createInitialContextDigest(),
        questionRoadmap: createEmptyQuestionRoadmap(index),
        relevantSourceExcerpts: [],
        currentSpecification: index === 0 ? emptySpecification : teamBillingSnapshots[index - 1],
        currentPrompt: teamBillingPrompts[index],
      },
      {
        specification: teamBillingSnapshots[index],
        questionRoadmap: createEmptyQuestionRoadmap(index + 1),
        nextPrompt: teamBillingPrompts[index + 1] ?? null,
        changeSummary: ["Validated deterministic prepared snapshot."],
      },
    );
    if (!result.valid) {
      throw new Error(`Prepared snapshot ${index + 1} failed semantic validation: ${result.errors.join("; ")}`);
    }
  }
  return { success: true, snapshotCount: teamBillingSnapshots.length };
}
