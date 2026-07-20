# Spec Grill V3 Exploration — Grilling Notes

Status: exploration source. The settled decisions and implementation requirements produced from this exploration are authoritative in `V3_IMPLEMENTATION_HANDOFF.md`, `CONTEXT.md`, and ADRs 0004–0010.

## Recommended direction: Bounded Async Interview

V3 should combine two related improvements:

1. Keep the interview moving during Brain work.
2. Improve Brain quality through a measured harness experiment.

The key principle is:

> Increase conversational throughput without increasing simultaneous decision load or relaxing Brain authority.

This direction responds to the V2 feedback in `CHANGELOG.md`:

- Brain latency still leaves the Product Manager waiting.
- Processing needs a persistent, unmistakable active status.
- The Communicator should be evaluated for a bounded multi-question asynchronous interview.
- A Codex harness should be evaluated because observed Codex output was stronger than current Brain output.

## Product model

Replace V2's single Lookahead Question with a Brain-issued `InterviewWindow` containing up to three independent `QuestionPermit` items.

```text
Brain revision N approves up to 3 permits
              |
PM confirms answer ---> Brain revision N+1 starts
              |
              +-- Question 1 -> confirmed summary queued
              +-- Question 2 -> confirmed summary queued
              +-- Question 3 -> confirmed summary queued
                                  |
Brain N+1 applies first ---> revision barrier
                                  |
                     revalidate every queued item
                                  |
                 valid summaries submitted as one batch
                 stale summaries retained as "not applied"
```

Important boundaries:

- Only one question is visible or spoken at a time.
- Every question is authored and approved by the Brain.
- The Communicator may clarify only the active permitted decision.
- Every Decision Summary remains editable and requires individual Product Manager confirmation.
- Confirmed means "queued for validation," not "incorporated into the Specification."
- Only one authoritative Brain request runs at once.
- Complete Specification revisions never merge concurrently.
- A validated revision always applies before queued work is revalidated.
- Invalid or stale work never replaces the last valid Specification.
- Voice and text paths enforce the same authority and confirmation rules.

Start with `approvalWindowSize = 3`, but allow the Brain to return fewer or zero permits. If two of the last three permits become stale, the application should request a window of one until the roadmap becomes less coupled. The cap controls wasted Product Manager effort; correctness still comes from the revision barrier and revalidation.

## Proposed contracts

Conceptually, each permit needs:

```ts
interface QuestionPermit {
  permitId: string;
  windowId: string;
  roadmapItemId: string;
  prompt: InterviewPrompt;
  ordinal: number;
  approvedAtRevision: number;
  dependencyVersion: string;
  invalidationItemIds: string[];
  domainKeys: string[];
}
```

Each asynchronous interview job should have an explicit lifecycle:

```ts
type InterviewJobStatus =
  | "approved"
  | "presenting"
  | "clarifying"
  | "summary_draft"
  | "confirmed_queued"
  | "revalidation_pending"
  | "submitted"
  | "not_applied"
  | "cancelled";
```

Every Realtime, transcription, and summary event should carry `exchangeId`, `permitId`, and `cancelEpoch`. Events that do not match the current identifiers must be ignored.

## Revision barrier and batching

There should be two coordinated lanes:

- One authoritative Brain request in flight.
- One sequential Communicator exchange active, with remaining permits and confirmed summaries held in a bounded browser queue.

When a Brain response completes:

1. Validate and atomically apply its complete Specification revision.
2. Revalidate the active exchange, queued summaries, and unused permits against the new Question Roadmap and dependency version.
3. Rebase still-valid jobs onto fresh permits.
4. Quarantine stale jobs with a concise Brain-owned reason.
5. Submit up to three individually confirmed and revalidated summaries as one ordered Brain operation.
6. Have the Brain process the batch authoritatively and return another complete replacement snapshot plus a new Interview Window.

If summaries contradict each other, preserve both as confirmed sources. The Brain should expose the contradiction as unresolved rather than silently choosing one.

There must never be multiple concurrent authoritative Brain revisions. Complete browser-authoritative snapshots have no safe general merge rule.

## Visible latency experience

The Brain status must remain persistent, including while the Product Manager answers another question.

Example:

> Brain working · Revising Specification · 00:42
> Last lifecycle update 6 seconds ago · Revision 4 remains safely visible

Use only observable states:

- Working
- Taking longer than usual
- Reconnecting
- Needs attention
- Timed out
- Revision applied
- Stopped

Show actual elapsed time and the age of the last verified lifecycle event. Do not show percentages, invented processing stages, or estimated completion times.

The last valid Specification remains visible during every processing and failure state.

## Decision Tray

A compact Decision Tray should distinguish:

- Draft
- Confirmed — awaiting dependency check
- Ready to apply
- Applying
- Applied
- Not applied

Confirmation should visibly complete within 250 ms, be idempotent, and remain undoable until batch submission begins.

Recommended confirmation copy:

> Confirmed — waiting for dependency check

The interface should also provide:

- `Confirm decision and continue`
- `Pause questions`
- `Defer this decision`
- `Undo confirmation` before submission
- `Reuse wording` for stale work

Future questions should expose only topic labels and a count until promoted. The Product Manager should never see a competing questionnaire.

## Mid-turn revision behavior

If a validated Brain revision arrives:

- During prompt playback: stop playback and revalidate before listening.
- While idle or listening without detected speech: disable the microphone and revalidate immediately.
- After speech detection: allow transcription to finish locally so speech is not lost, mark the work `revalidation_pending`, and do not create a confirmable summary until revalidation completes.
- During summary editing: preserve the text, then either rebase the editor or quarantine it as `not applied`.

Best-effort provider cancellation cannot guarantee that execution stopped. Correctness must depend on rejecting late events and stale responses locally.

## Codex harness recommendation

Do not make a persistent Codex runtime the V3 architecture without evidence.

The Codex SDK is intended for coding-focused threads and runs server-side. Persistent Codex threads or an app-server sidecar would conflict with Spec Grill's browser-authoritative state, ephemeral privacy model, and current serverless assumptions.

Run a three-way bake-off:

1. Current one-shot GPT-5.6 Brain.
2. A Responses-native "Codex-inspired" harness:
   - analyst pass;
   - dependency and contradiction critic;
   - Specification synthesis;
   - deterministic semantic validation;
   - one bounded repair.
3. A fresh `codex exec --ephemeral` read-only candidate:
   - same complete confirmed input snapshot;
   - existing JSON output schema;
   - GPT-5.6 with medium reasoning;
   - isolated empty working directory;
   - no network, web, MCP, or unnecessary tools;
   - strict environment allowlist;
   - content-free lifecycle events only;
   - existing Zod, semantic, request ID, and base-revision validation unchanged.

The likely production fit is the Responses-native harness or Agents SDK because Spec Grill needs repeated tool loops, guardrails, approval boundaries, and orchestration rather than a coding workspace.

Only adopt actual Codex execution if it wins a blind quality evaluation and passes deployment, privacy, cancellation, retention, cold-start, schema, and `store: false` verification.

Reject for V3:

- Persistent per-session Codex threads.
- Hidden Codex state competing with the complete browser snapshot.
- A long-lived Codex app-server sidecar without a new architecture decision.
- Unverified Codex child-process or binary assumptions on Vercel.

## Recommended V3 MVP

- Persistent truthful Brain status.
- Actual elapsed time and last lifecycle-event age.
- Brain-approved Interview Windows of at most three pairwise-independent permits.
- Exactly one visible active question.
- Individual editable and confirmable Decision Summaries.
- Up to three confirmed queued summaries.
- Decision Tray with queued, applied, and stale states.
- Revision barrier and complete queue revalidation.
- Atomic batched submission of valid summaries.
- One Brain request in flight.
- Dynamic window shrinking after excessive staleness.
- Pause, defer, undo-before-submission, retry, timeout, and cancellation behavior.
- Deterministic Prepared Demo proving one valid and one stale asynchronous result.
- A frozen evaluation dataset and harness comparison runner.

## Later scope and non-goals

- Larger or continuously replenished interview windows.
- Branching Communicator-authored follow-up trees.
- User-configurable interview pace.
- Blanket confirmation of several decisions.
- Multiple concurrent Brain revisions.
- Parallel voice conversations.
- Background or cross-session work.
- Persistent document or Codex sessions.
- Multi-user collaboration or assignments.
- Notifications outside the active browser tab.
- Unbounded Communicator-led conversation.

## Prepared Demo story

The deterministic V3 Prepared Demo should:

1. Confirm the bundled Project Context Digest.
2. Submit one prepared answer.
3. Show the persistent Brain status during a deliberately long prepared wait.
4. Open a two-item Interview Window.
5. Clarify and confirm the first decision.
6. Continue to the second question while the Brain remains visibly active.
7. Complete and apply the authoritative prepared revision.
8. Revalidate both asynchronous items.
9. Preserve one as valid and quarantine one as `not applied`.
10. Apply the valid prepared batch and proceed to Final Review and Markdown export.

Prepared timing must use deterministic fixture events and must not imply genuine provider activity. The walkthrough must not call OpenAI, request a microphone, use a user-provided file, or mix with Live Mode.

## Evaluation plan

Use 20–30 frozen, non-sensitive sessions covering:

- Contradictions.
- Deferrals and corrections.
- Provenance and item statuses.
- Stable IDs.
- Roadmap dependencies and lookahead approval.
- Stale work.
- Readiness calibration.
- Risks and edge cases.
- Test-ready Acceptance Criteria.

Compare the current Brain, Responses-native harness, and ephemeral Codex candidate blindly.

Measure:

- First-pass schema and semantic validity.
- Repair rate.
- Invented-decision violations.
- Provenance and status violations.
- Stable-ID preservation.
- Dependency and stale-classification accuracy.
- Acceptance Criterion testability.
- Blind Product Manager preference for question quality and Specification completeness.
- p50 and p95 total latency.
- Time to first truthful activity event.
- Product Manager idle time compared with V2.
- Stale-summary and wasted-question rates.
- Tokens and cost.
- Cancellation and late-output rejection.
- Filesystem, environment, log, and provider-retention leakage.
- Cold-start, package-size, and Vercel execution behavior.

A harness must not ship merely because it resembles Codex. It must materially improve blind quality without weakening any invariant.

## Proposed acceptance criteria

- Brain activity becomes visibly active within 250 ms of confirmation.
- Status remains visible during questions, clarification, summary review, and mobile tab changes.
- Every displayed processing stage corresponds to a verified application or provider event.
- Timeout, abort, offline, and failure cannot be mistaken for active processing.
- The last valid Specification remains visible throughout processing and failures.
- An Interview Window contains no more than three permits.
- Every permit is Brain-approved, revision-bound, dependency-bound, independent of the in-flight operation, and declared pairwise independent.
- Exactly one detailed question is active and exposed to the Communicator.
- The Communicator cannot invent, reorder, or add decisions.
- Raw clarification content and unconfirmed summaries cannot reach the Brain.
- Every queued summary has an explicit Product Manager confirmation record.
- Confirmation feedback appears within 250 ms and repeated activation cannot duplicate work.
- A validated authoritative revision applies before asynchronous work is revalidated or submitted.
- Stale drafts and summaries never mutate the Specification and remain available for reuse.
- Only individually confirmed and successfully revalidated summaries enter a batch.
- Batch application is atomic; invalid output preserves the prior Specification.
- No more than one Brain request is in flight.
- Voice and text paths enforce identical confirmation and revalidation rules.
- The 390 px layout exposes status, the active question, and the Decision Tray without horizontal scrolling.
- Reduced-motion and screen-reader behavior communicates status without relying on animation.
- Prepared Demo proves long-running status, two-question progress, batching, one stale outcome, and final export without AI, network, microphone, or user-file dependencies.

## Product decisions to grill

Recommended starting positions are included, but these should be challenged before implementation:

1. **Maximum permits:** three; Prepared Demo uses two.
2. **Adaptive window:** shrink to one after two stale jobs among the last three; expand only through a later Brain-approved window.
3. **Queue persistence:** checkpoint only bounded, Product Manager-confirmed summary wording—not drafts or clarification transcripts.
4. **Batch failure:** apply nothing unless the complete returned revision validates.
5. **Mid-speech response:** finish transcription locally, then revalidate before summary confirmation.
6. **Contradictory summaries:** preserve both as confirmed sources and expose an unresolved contradiction.
7. **Undo boundary:** permit undo until batch submission starts.
8. **Harness choice:** evaluate before freezing the production adapter.
9. **Codex adoption:** use only a fresh ephemeral run unless a separate architecture decision approves durable state.
10. **Staleness tolerance:** determine what stale-summary rate makes a window of three harmful rather than helpful.

## Hard tradeoffs to challenge

- A permit approved from revision N cannot be guaranteed valid after later answers introduce new contradictions or dependencies. Stale work is intrinsic.
- The Communicator cannot safely invent replacement questions, so the interview must wait when permits run out.
- A finite permit window cannot hide an arbitrarily long Brain request.
- Batching improves throughput but delays incorporation of individually confirmed summaries.
- More harness passes may improve quality while worsening latency and cost.
- Multiple authoritative Brain calls would require a merge coordinator or a different persistence architecture.
- Preserving confirmed queued summaries across reload expands V2's checkpoint contents and requires an explicit privacy decision.
- Literal Codex execution may reproduce Codex quality, but its coding focus and runtime packaging may be a poor product/deployment fit.

## Current official references

- Codex SDK: https://learn.chatgpt.com/docs/codex-sdk
- Codex non-interactive mode: https://learn.chatgpt.com/docs/non-interactive-mode
- Agents SDK selection guidance: https://developers.openai.com/api/docs/guides/agents#choose-the-agents-sdk-when
