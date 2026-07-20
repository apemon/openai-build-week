export const EVALUATION_RUBRICS = Object.freeze({
  questionQuality: [
    "1 — asks an irrelevant, coupled, or authority-violating question",
    "2 — asks a weak or poorly grounded question",
    "3 — asks one relevant decision with limited downstream value",
    "4 — asks one well-grounded, high-information decision",
    "5 — asks the highest-value independent decision with precise context",
  ],
  specificationCompleteness: [
    "1 — omits core decisions or invents authority",
    "2 — captures fragments but leaves major unmarked gaps",
    "3 — captures the core with visible unresolved work",
    "4 — is traceable, comprehensive, and implementation-oriented",
    "5 — is complete, calibrated, contradiction-safe, and handoff-ready",
  ],
  acceptanceCriterionTestability: [
    "1 — vague or not testable",
    "2 — partially observable but materially ambiguous",
    "3 — testable with minor interpretation",
    "4 — specific, observable, and directly linked to requirements",
    "5 — precise Given/When/Then or measurable assertion with clear provenance",
  ],
});

