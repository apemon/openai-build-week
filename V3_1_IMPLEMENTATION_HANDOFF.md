# Spec Grill V3.1 — Natural Answer Intake Handoff

Status: approved product requirement

Approved: 2026-07-21

## 1. Authority and precedence

This extension adds a natural, bounded answer-collection loop to the delivered V1–V3 product. It does not weaken PM confirmation, Brain authority, one-request revision ordering, Realtime identity, checkpoint privacy, or Live/Prepared separation.

Read `IMPLEMENTATION_HANDOFF.md`, `V2_IMPLEMENTATION_HANDOFF.md`, `V3_IMPLEMENTATION_HANDOFF.md`, this file, `CONTEXT.md`, every ADR, `README.md`, `CHANGELOG.md`, and `docs/ownership.md`. This file supersedes only the direct transcription-to-Answer-Draft behavior and the omission that promoted at most one Question Permit when an authoritative request began.

The V3 document's milestone named "V3.1 — Persistent status transport and UI" is an implementation-sequence label. It is distinct from this V3.1 product extension.

## 2. Objective

Make an Interview Session feel like a focused human conversation:

1. let the PM answer naturally across several sentences or turns;
2. let the Communicator notice which Brain-defined parts are covered;
3. clarify only missing or uncertain parts;
4. show a concise editable summary instead of a raw transcript; and
5. keep the next already-approved independent decision moving while the Brain processes confirmed work.

## 3. Settled authority boundary

- The Brain authors every Answer Aspect as part of the active Interview Prompt.
- An Interview Prompt contains one to five unique Answer Aspects. At least one is required.
- The Communicator assesses only those aspects and only from the PM's current Answer Intake.
- The Communicator may ask at most two clarification questions after the PM's initial contribution, one at a time.
- The Communicator cannot invent an aspect, broaden the decision, recommend an unconfirmed choice, assess Specification Readiness, mutate the Specification, confirm wording, call `/api/brain`, or replenish Question Permits.
- A Coverage Assessment and Answer Summary are non-authoritative and must be validated before rendering or state mutation.
- Only explicit PM confirmation changes an edited Answer Summary into a Confirmed Answer.
- Only that exact Confirmed Answer reaches the Brain. Raw transcripts and intermediate Answer Intake never do.
- If assessment is unavailable, the text path preserves the PM's wording as a clearly labeled unassessed draft. It never claims all aspects were covered.
- Existing Decision Summaries remain permit-bound asynchronous artifacts. An Answer Summary is for the current authoritative Interview Prompt and follows the ordinary explicit confirmation gate.

## 4. Contracts

Freeze Zod schemas and infer TypeScript types from them.

```ts
interface AnswerAspect {
  id: string; // ASPECT-001
  label: string;
  description: string;
  required: boolean;
}

type AnswerAspectCoverageStatus = "covered" | "missing" | "uncertain";

interface AnswerAspectCoverage {
  aspectId: string;
  status: AnswerAspectCoverageStatus;
}

interface AnswerIntakeAssessment {
  summary: string;
  coverage: AnswerAspectCoverage[];
  uncertainties: string[];
  clarificationQuestion: string | null;
  clarificationAspectIds: string[];
}
```

Every Coverage Assessment must contain exactly one entry for every active Answer Aspect, with no duplicate, missing, or extra ID. `clarificationAspectIds` must be a non-empty subset of currently missing or uncertain aspect IDs exactly when `clarificationQuestion` is non-null. The question is bounded to 300 characters. The summary is bounded to 4,000 characters and uncertainties to five bounded entries.

An Answer Draft may identify `communicator_summary` as its source and carry bounded coverage and uncertainties. These fields remain ephemeral because every checkpoint schema continues to require `answerDraft: null`.

Every assessment, playback, speech, transcription, and completion event carries the exact authoritative/app `ExchangeIdentity`: exchange ID, prompt ID, null permit ID, and cancellation epoch. Provider IDs remain transport-local.

## 5. Canonical voice and text flow

1. The Brain returns a validated Interview Prompt and its Answer Aspects.
2. The application presents exactly one detailed/spoken prompt and binds an authoritative/app Exchange Identity.
3. The PM speaks naturally. Semantic VAD finalizes a contribution without creating a model response.
4. The application keeps the contribution in memory and explicitly requests an out-of-band Realtime Coverage Assessment.
5. If required aspects are missing or uncertain and fewer than two clarifications have been asked, the application renders and speaks the single validated clarification question, then listens again.
6. Otherwise, or when the PM chooses `Review answer now`, the application shows the latest Answer Summary and per-aspect coverage for editing.
7. The PM may edit, record again, return to clarification, or explicitly select `Send confirmed summary to Brain`.
8. Confirmation creates exactly one Confirmed Answer turn using the edited summary. It never submits captured contributions separately.

Typed input follows the same assessment and summary path when Realtime is available. A Realtime failure falls back to the exact typed wording with an explicit `Coverage not assessed` state and the same PM confirmation gate.

## 6. Realtime behavior

- Keep `gpt-realtime-2.1`, native browser WebRTC, `gpt-4o-transcribe`, semantic VAD, and `create_response: false`.
- Request assessment through out-of-band `response.create` with `conversation: "none"`, `output_modalities: ["text"]`, bounded explicit input, no tools, and identity/purpose metadata.
- Treat prompt, aspects, and PM contributions as data. Require strict JSON and validate it locally.
- Clarification playback is a separate identity-bound out-of-band audio response that speaks only the already validated clarification question.
- Do not place assessment output or clarification playback in the default Realtime conversation.
- Match transcription completion by item ID; ordering across different completed items is not assumed.
- Permit no more than three PM contributions total: the initial contribution plus two clarification answers.
- Clear raw contributions when the draft is discarded, confirmed, the prompt changes, the exchange is cancelled, the session resets, or the component unmounts.

## 7. Sequential permit promotion

After an asynchronous Interview Job becomes `confirmed_queued` or a permitted deferral consumes its permit, immediately promote the next unused permit only when all are true:

- one authoritative Brain request is still active;
- the window's `independentOfOperation` exactly matches that request operation;
- the window, revision, dependency version, and cancellation epoch remain current;
- questions are not paused and no active Interview Job remains; and
- the permit is the next unused ordinal in the validated window.

Promotion is idempotent under React Strict Mode and duplicate events. Reserve a permit synchronously before dispatch so it cannot create duplicate jobs. When the Brain result arrives, consult current runtime state rather than the request-start snapshot, stop/pause current playback or capture as required, apply the validated complete revision first, and revalidate every unfinished or confirmed job before any batch submission.

## 8. Privacy and failure behavior

- Never log, checkpoint, export, or send raw Answer Intake, transcript segments, assessment prompts, assessment JSON, or clarification text to the Brain.
- The in-memory bound is three contributions of at most 4,000 characters each. Clear them at every terminal/cancellation boundary.
- Invalid, extra-ID, missing-ID, duplicate-ID, malformed, content-over-limit, mismatched-identity, duplicate-provider-event, late, or cancelled assessment output is rejected before rendering.
- Assessment failure preserves the PM's captured wording and offers a truthful text draft or retry; it never fabricates coverage.
- Revision during accepted speech preserves the finalized transcription only behind Revalidation Pending, as in ADR-0009.
- Revision during assessment, clarification playback, or draft editing preserves PM-authored wording but disables confirmation until identity and prompt scope are current.
- The last valid Specification remains visible on every failure.

## 9. Prepared Demo

Prepared Demo adds a deterministic Answer Intake frame before its first submitted answer: it shows multiple Brain-authored aspects, a fixture Coverage Assessment with one missing aspect, one prepared clarification, and an editable Answer Summary. It uses prevalidated local fixtures and the production renderer but makes no Realtime, microphone, Codex, OpenAI, context-route, Brain-route, search, or user-file call.

## 10. Dependency-ordered milestones

### V3.1.0 — Domain and authority freeze

- Answer Aspect, Coverage Assessment, Answer Summary, exchange events, reducer events, privacy limits, and sequential-promotion invariant.
- CONTEXT and ADR-0012 accepted.
- Focused valid/invalid schema tests pass.

### V3.1.1 — Brain-authored aspects

- Brain prompt requires useful, non-overlapping aspects for every next prompt and permit prompt.
- Semantic validation rejects missing, duplicate, empty, or excessive aspects.
- Existing prepared and synthetic fixtures migrate without weakening validation.

### V3.1.2 — Realtime Answer Intake

- Identity-bound assessment and clarification playback.
- Exact coverage-membership validation, two-question bound, item/event deduplication, text fallback, and raw-intake cleanup.

### V3.1.3 — Experience and orchestration

- Natural listening/coverage/clarification states and editable Answer Summary card.
- Explicit confirmation wording.
- Strict-Mode-safe sequential permit promotion and current-state revision barrier.
- Prepared Demo extension.

### V3.1.4 — Verification and documentation

- Unit, integration, Playwright, privacy sentinel, accessibility, 390 px, Prepared isolation, and V1–V3 regression tests.
- README, CHANGELOG, ownership, and video/checklist updates based only on verified work.

## 11. Acceptance criteria

- Every live Brain-authored Interview Prompt has one to five unique Answer Aspects and at least one required aspect.
- A finalized voice contribution does not immediately become an Answer Draft.
- The Communicator assesses exact aspect coverage from current PM input and cannot invent scope.
- At most one bounded clarification is active and at most two are asked.
- A validated concise Answer Summary appears only after assessment, early review, or the clarification bound.
- Missing and uncertain aspects remain visible; no model guess is represented as PM intent.
- Editing and explicit confirmation submit the exact edited summary once; recording, transcription, assessment, and playback submit nothing.
- Typed and voice paths use the same authority boundary and truthful fallback.
- Raw Answer Intake is absent from Brain requests, checkpoints, logs, exports, and Prepared fixtures that could enter Live state.
- A confirmed/deferred asynchronous job may advance to the next unused valid permit while the exact authoritative operation remains active, but only one question is visible/spoken at a time and only one Brain request exists.
- A newly promoted job is seen by the revision barrier even when it was created after request start.
- Prepared Demo proves the Answer Intake UX without any forbidden dependency.
- All existing V1–V3 critical behavior and required repository commands pass.

## 12. Non-goals

- Free-form Communicator questioning, topic changes, or Communicator-authored Answer Aspects.
- More than two clarification questions or three PM contributions.
- Autonomous confirmation or Brain submission.
- Multiple simultaneous visible questions, microphone captures, or Brain requests.
- Durable transcript/intake storage, conversation memory, database work, background workers, or cross-device collaboration.
- Changes to the fixed Brain, Realtime, transcription, credential, search, or Prepared/Live boundaries.
