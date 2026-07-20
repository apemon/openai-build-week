# Spec Grill V3 — Implementation Handoff

Status: approved product requirement; not yet implemented

Approved: 2026-07-21

Audience: a separate Codex implementation session

## 1. Authority and read order

V3 extends the delivered V1 and V2 product. It does not replace or weaken their security, validation, provenance, Live/Prepared separation, browser-authoritative state, PM-confirmation boundaries, or full-snapshot revision model.

Before changing code, read in this order:

1. `IMPLEMENTATION_HANDOFF.md`
2. `V2_IMPLEMENTATION_HANDOFF.md`
3. This file
4. `CONTEXT.md`
5. Every file in `docs/adr/`
6. `README.md`, `CHANGELOG.md`, and `docs/ownership.md`
7. The current implementation and tests needed to verify existing behavior

`note.md` is the exploration source that led to this handoff. Where it differs from this document, this handoff and the accepted ADRs are authoritative.

## 2. V3 objective

Increase conversational throughput without increasing simultaneous decision load or relaxing Brain authority.

V3 delivers three related improvements:

1. A Bounded Async Interview in which the Brain may approve a small window of pairwise-independent decisions while one authoritative revision runs.
2. Persistent, truthful Brain activity feedback so a long-running request cannot look like a hung interface.
3. Disabled-by-default experimental Brain harnesses and a reproducible local bake-off, including a controlled public-search experiment, without making an unevaluated harness the production default.

V3 is independently shippable on the existing `one_shot` GPT-5.6 Brain. Harness evaluation must not block the Bounded Async Interview or Prepared Demo.

## 3. Settled authority boundaries

- The Brain remains the sole authority for the complete Specification, Readiness, Question Roadmap, dependencies, contradiction classification, stale reasons, Interview Windows, and Question Permits.
- The Communicator presents and clarifies exactly one active permitted decision at a time. It cannot invent, replace, reorder, broaden, or replenish decisions.
- Each Decision Summary remains editable and non-authoritative until the PM confirms it.
- PM confirmation means `Confirmed — awaiting dependency check`, not incorporated into the Specification.
- Individual PM confirmation authorizes later automatic submission only for the exact locked entry after fresh Brain-owned revalidation. It does not authorize changed wording, extra entries, or autonomous confirmation.
- Only one authoritative Brain request may be active in application state.
- A validated complete Brain revision always applies before queued asynchronous work is revalidated or submitted.
- Only individually confirmed and freshly revalidated work may enter a Decision Batch.
- A Decision Batch applies atomically through one complete validated replacement revision. There is no patch merge.
- Batch entries and their provisional turn IDs remain request-local until that validated revision applies; a failed or abandoned batch cannot leak into later full-state requests.
- The last valid Specification remains visible and authoritative during every request, clarification, revalidation, retry, timeout, stream interruption, and failure.
- Voice and text paths enforce the same confirmation, identity, revision-barrier, and staleness rules.
- Best-effort provider cancellation is never a correctness mechanism. Request IDs, base revisions, exchange IDs, permit IDs, monotonic cancellation epochs, and local late-event rejection are.
- Live AI, experimental harness output, frozen evaluation data, and Prepared Demo fixtures remain structurally distinct and visibly identified.

## 4. Canonical V3 user flow

1. The PM completes V2 context preparation and confirms the Project Context Digest.
2. The Brain produces the initial complete Specification, Question Roadmap, next Interview Prompt, and an optional Interview Window.
3. For a direct Confirmed Answer, correction, or ordinary deferral, the application accepts the action idempotently, shows Persistent Brain Status within 250 ms, and starts the sole authoritative Brain request.
4. For a permitted Decision Summary or permitted deferral created while that request runs, PM confirmation moves the job into the Decision Tray as awaiting dependency check; it never starts a second Brain request.
5. While that request runs, the Communicator may sequentially present Question Permits from the previously Brain-approved Interview Window:
   - only one detailed/spoken question is active;
   - clarification stays within that permitted decision;
   - the PM confirms, defers, pauses, or leaves a summary in draft;
   - confirmed work enters the Decision Tray as awaiting dependency check.
6. When the Brain response completes, the application validates and atomically applies its complete revision first.
7. The prior Interview Window expires. The validated Brain output supplies exactly one disposition for every prior permit: either a binding to one fresh permit or dependency invalidation with a concise Brain-owned reason. The application applies those dispositions to active and queued jobs.
8. Dependency-invalidated work becomes Not Applied with a Brain-owned reason. Valid confirmed work becomes ready to apply.
9. The application automatically locks and submits one ordered Decision Batch containing one to three valid confirmed entries. A second PM approval click is not required.
10. Any unfinished or unconfirmed exchange is preserved locally as Revalidation Pending but cannot be confirmed while the batch runs: the prior Brain response could not prove independence from batch contents it had not seen.
11. The batch response applies atomically, yields a fresh Interview Window, and revalidation continues.
12. When permits are exhausted, the Communicator waits. Persistent Brain Status and the last valid Specification remain visible until the Brain issues a fresh window.
13. Final Review preserves V2's explicit abandonment gate for pending work and shows session-local Decision Tray outcomes without exporting non-authoritative wording.

## 5. Interview Window contracts

Freeze shared schemas before parallel implementation. Create Zod schemas first and infer TypeScript types from them.

The conceptual contracts are:

```ts
interface InterviewWindow {
  id: string;
  approvedAtRevision: number;
  dependencyVersion: string;
  independentOfOperation: BrainOperation;
  applicationCap: 1 | 3; // must echo the application-computed requested cap
  permits: QuestionPermit[]; // 0..applicationCap, never more than 3
}

interface QuestionPermit {
  id: string;
  windowId: string;
  roadmapItemId: string;
  prompt: InterviewPrompt;
  ordinal: 1 | 2 | 3;
  approvedAtRevision: number;
  dependencyVersion: string;
  independentOfOperation: BrainOperation;
  invalidationItemIds: string[]; // unique bounded ROADMAP-* IDs
  domainKeys: string[];
}

type InterviewJobStatus =
  | "approved"
  | "presenting"
  | "clarifying"
  | "summary_draft"
  | "paused"
  | "confirmed_queued"
  | "revalidation_pending"
  | "ready_to_apply"
  | "applying"
  | "apply_failed"
  | "applied"
  | "not_applied";

type NotAppliedReason =
  | "dependency_invalidated"
  | "batch_failed"
  | "cancelled"
  | "abandoned"
  | "superseded";

interface InterviewJob {
  id: string;
  exchangeId: string;
  permit: QuestionPermit;
  status: InterviewJobStatus;
  clarificationTurns: ClarificationTurn[];
  decisionSummary: DecisionSummary | null;
  deferral: PermittedDeferral | null;
  confirmedAt: string | null;
  revalidatedAtRevision: number | null;
  revalidatedDependencyVersion: string | null;
  notAppliedReason: NotAppliedReason | null;
  notAppliedExplanation: string | null;
}

type PriorPermitDisposition =
  | {
      priorWindowId: string;
      priorPermitId: string;
      roadmapItemId: string;
      status: "reissued";
      freshPermitId: string;
      revalidatedAtRevision: number;
      dependencyVersion: string;
    }
  | {
      priorWindowId: string;
      priorPermitId: string;
      roadmapItemId: string;
      status: "dependency_invalidated";
      reason: string;
      revalidatedAtRevision: number;
      dependencyVersion: string;
    };

type ExchangeIdentity =
  | {
      kind: "permitted";
      exchangeId: string;
      promptId: string;
      permitId: string;
      cancelEpoch: number;
    }
  | {
      kind: "authoritative_or_app_prompt";
      exchangeId: string;
      promptId: string;
      permitId: null;
      cancelEpoch: number;
    };

type ExternalEvidenceTarget =
  | { kind: "specification_item"; itemId: string }
  | { kind: "prompt_recommendation"; promptId: string };

interface ExternalEvidence {
  id: string; // EVID-001
  title: string;
  url: string; // validated HTTPS public URL
  retrievedAt: string;
  informedTargets: ExternalEvidenceTarget[];
}

interface FrozenExternalEvidence {
  id: string;
  title: string;
  url: string;
  retrievedAt: string;
  factualAbstract: string; // bounded, licensed or application-authored fixture text
  contentHash: string;
}

interface V3BrainModelOutput extends BrainModelOutput {
  interviewWindow: InterviewWindow;
  priorPermitDispositions: PriorPermitDisposition[];
}
```

Extend `Specification` with a bounded `externalEvidence` collection and `SpecificationItem` with bounded `externalEvidenceIds`. Extend an Interview Prompt recommendation with bounded evidence IDs when search informed it. Every item and recommendation reference must resolve to evidence; every evidence target must resolve back to the named item or prompt recommendation; no unknown/orphan target is allowed. Preserve evidence IDs and meaning across complete revisions while referenced, deduplicate canonical URLs, and reject changed-ID meaning. A search-informed item without an explicit supporting PM-confirmed source remains `proposed`; a later PM-confirmed product decision may retain its evidence references without confirming the separate external factual claim or treating evidence as Confirmed Input. Bound counts and text/URL lengths during the shared contract freeze, and never store full retrieved pages in the Specification.

The application computes `requestedApplicationCap` from its content-free adaptive state and sends it in every Brain request. The returned `InterviewWindow.applicationCap` must echo that value; the Brain may return fewer permits but cannot raise or reset the cap.

Extend the existing Brain output schema atomically: every successful V3 model output contains the complete existing output plus exactly one validated `interviewWindow` and `priorPermitDispositions`. The request supplies the prior Interview Window (or restored permit snapshots) that needs disposition. Brain output supplies `priorPermitDispositions` with exact membership: one result for every unique prior permit and no extra, missing, or duplicate result. A reissued disposition must reference exactly one fresh permit in the new window with the same roadmap item and decision key; the fresh permit supplies the new prompt/version/dependency binding. An invalidated disposition requires a concise Brain-owned reason. The application never infers semantic equivalence from wording or roadmap IDs alone.

The maximum Interview Window size is three. The Brain may return zero, one, two, or three permits. Prepared Demo uses two.

### 5.1 Pairwise independence

Semantic validation must prove all of the following:

- The complete Question Roadmap has only known dependency references, no self-dependencies, and no directed cycle.
- Roadmap item IDs, decision keys, prompt IDs, permit IDs, and ordinals are unique where required.
- Every permit references an unresolved roadmap item and is bound to the returned revision and dependency version.
- No direct or transitive dependency path exists between any two permitted roadmap items.
- Every permit has no unresolved dependencies and is independent of the actual operation that will run concurrently.
- Every `invalidationItemIds` entry is a unique existing `ROADMAP-*` ID, does not name the permit's own roadmap item, and does not name another permitted roadmap item in the same window.
- Every permit and its window bind to the same exact `independentOfOperation`. The application may promote that window only while that exact operation is in flight; any other operation expires it unused.
- `domainKeys` are bounded diagnostics only; matching or distinct domain keys do not prove independence.
- The Communicator cannot change permit order or supply a permit not present in the validated window.

Invalid Interview Windows invalidate the whole Brain output and enter the existing one-repair path. Do not render a partial window.

### 5.2 Window expiry and adaptive cap

Every revision barrier expires the previous Interview Window. Active or queued PM work may continue only by rebasing to a matching fresh permit; unused old permits disappear.

Adaptive shrinking uses the last three eligible terminal PM-engaged Decision Summary jobs. A job is PM-engaged once question presentation begins. Count only:

- `applied`; and
- `not_applied` with reason `dependency_invalidated`.

If two of those last three jobs are dependency-invalidated, set the application cap to one. Permitted deferrals never enter the denominator, even when applied. Also exclude unused permits, pauses, cancellations, abandonment, provider failures, and batch-validation failures.

After shrinking, require two consecutive singleton PM-engaged jobs to apply without dependency invalidation before restoring the application cap to three. The Brain may always issue fewer than the application cap.

Across the frozen evaluation, three-permit windows fail the V3 quality gate when more than 25% of individually confirmed summaries become dependency-invalidated after at least 12 PM-engaged terminal jobs, using the same exclusions.

Checkpoint a content-free adaptive tuple: the last three eligible outcome enums, current application cap, and singleton recovery streak. If that tuple is absent or invalid on reload, conservatively restore cap one and require two successful singleton Decision Summary jobs before returning to cap three.

## 6. Decision lifecycle, batching, and priority

### 6.1 Confirmation and undo

- Confirmation feedback appears within 250 ms and is idempotent.
- Confirmation changes a summary to `Confirmed — awaiting dependency check`.
- Repeated activation cannot create duplicate jobs, turns, or requests.
- `Undo confirmation` is available until Decision Batch creation begins.
- Undo returns the entry to an editable summary draft. If the dependency version changed, revalidate before resuming clarification or permitting another confirmation.
- Batch creation atomically locks all included entries.

### 6.2 Decision Batch

Add a `decision_batch` Brain operation. Remove the V2 assumption that a decision-summary request contains exactly one summary, while retaining backward-safe fixture migration where useful.

Also add a non-mutating `revalidate_restored` operation for reload recovery. It returns only validated prior-permit dispositions against the current revision/roadmap and does not change the Specification or increment its revision. The PM must explicitly select `Revalidate restored decisions`; after successful revalidation, a separate explicit `Submit restored decisions` action locks and sends the batch, preserving the approved rule that reload never auto-submits.

```ts
interface DecisionBatch {
  id: string;
  actionId: string;
  baseRevision: number;
  dependencyVersion: string;
  createdAt: string;
  lockedAt: string;
  entries: DecisionBatchEntry[]; // 1..3
}

type DecisionBatchEntry =
  | {
      kind: "decision_summary";
      jobId: string;
      exchangeId: string;
      permitId: string;
      roadmapItemId: string;
      permitOrdinal: number;
      confirmedTurnId: string;
      text: string;
      uncertainties: string[];
      confirmedAt: string;
      revalidatedAtRevision: number;
      revalidatedDependencyVersion: string;
    }
  | {
      kind: "deferred_prompt";
      jobId: string;
      exchangeId: string;
      permitId: string;
      roadmapItemId: string;
      permitOrdinal: number;
      confirmedTurnId: string;
      note: string | null;
      confirmedAt: string;
      revalidatedAtRevision: number;
      revalidatedDependencyVersion: string;
    };

interface V3BrainRequestFields {
  actionId: string;
  cancelEpoch: number;
  requestedApplicationCap: 1 | 3;
  priorInterviewWindow: InterviewWindow | null;
  restoredEntriesForRevalidation: RestoredAsyncEntry[]; // non-empty only for revalidate_restored
  decisionBatch: DecisionBatch | null; // non-null iff operation is decision_batch
  externalEvidenceBundle: FrozenExternalEvidence[]; // scored evaluation only; empty in ordinary runtime requests
}
```

Validate operation-conditional fields: `decision_batch` has exactly one non-null 1..3 batch and no restored-revalidation entries; `revalidate_restored` has no batch and one to three restored entries; every other operation has neither. Bind streamed lifecycle events to `actionId`, `cancelEpoch`, request ID, and base revision.

Order entries by permit ordinal, with confirmation time and stable ID as deterministic tie-breakers. The server validates exact batch membership, unique IDs, individual confirmation records, provisional confirmed-turn IDs, fresh revision/dependency bindings, and the 1..3 bound. The model request may use those request-local turn IDs as allowed provenance sources, but they are not appended to `SessionState.turns` until the validated complete batch revision applies. On successful application, append the exact batch turns atomically with the new revision. On failure or abandonment, append none, and exclude them from every later full-state request.

For a permitted deferral with no note, create a canonical application-authored durable turn only on successful batch application, using the exact non-answer marker `Deferred without additional context.` The Brain prompt and validators must treat that marker as absence of a decision, never as PM-authored product content.

After the preceding revision applies and queued entries revalidate, automatically submit the batch. Do not add a second `Apply batch` confirmation.

If the complete batch output is invalid, refused, incomplete, timed out, interrupted, or stale, apply none of it and preserve the last valid Specification. A timeout, stream interruption, rate limit, or retryable provider failure preserves the exact locked batch as `Apply failed — retry available`; explicit retry uses a fresh request ID/cancellation epoch but the same batch ID, entry IDs, confirmation evidence, and content. Late output from an earlier attempt remains stale. Invalid output after the bounded repair, a non-retryable refusal, or explicit PM abandonment makes the entries terminal Not Applied with reason `batch_failed` or `abandoned`, and no request-local turn becomes durable.

### 6.3 Contradictions

If batch entries contradict, preserve every entry as a distinct confirmed source. The Brain must expose an unresolved contradiction, preserve provenance, and prioritize resolving it. It cannot silently choose, merge, downgrade, or discard either statement.

### 6.4 Permitted deferral

`Defer this decision` creates a distinct PM-confirmed deferral with an optional note. It:

- consumes the permit;
- is revalidated and may join a Decision Batch;
- never becomes an answer or Decision Summary;
- becomes an Open Question, Blocker, or Next Action only through a validated Brain revision; and
- does not count as dependency staleness for adaptive shrinking.

### 6.5 Correction priority

`Correct or challenge` preempts the asynchronous lane:

- stop promoting permits;
- preserve confirmed queued wording;
- allow the current authoritative request to finish, fail, or time out rather than trusting cancellation;
- submit the correction as the next authoritative operation; and
- after the correction revision applies, freshly revalidate every queued entry and unused/current permit before resuming.

A PM-confirmed correction waiting behind an in-flight request suppresses automatic Decision Batch creation even when entries become ready. Hold it as a memory-only `pendingCorrection`; submit it first when the current request terminates, then revalidate queued work against the correction revision. The existing checkpoint privacy decision does not persist this pending correction. Final Review requires explicit abandonment; an intervening reload loses it and the restored UI must not claim it was submitted.

## 7. Mid-turn revision behavior and Realtime identity

Every Realtime, transcription, playback, clarification, and summary event used for state mutation carries a validated `ExchangeIdentity`:

- permitted asynchronous exchanges carry immutable browser `exchangeId`, Brain `promptId` and `permitId`, and the session-monotonic browser `cancelEpoch`;
- current authoritative prompts, corrections, and the app-authored initial prompt carry immutable `exchangeId`, `promptId`, `permitId: null`, and `cancelEpoch`; and
- existing provider correlation IDs remain only inside the transport boundary, never as application authority or logs.

Reject an event before state mutation when any application identity is absent or mismatched. Maintain a bounded provider `event_id` deduplication set in the transport. Advance `cancelEpoch` before best-effort provider cancellation or clearing audio.

Required revision races:

- **Prompt playback:** stop playback and microphone activity, then revalidate.
- **Idle/listening before speech:** disable the microphone and revalidate immediately.
- **Fresh identical prompt identity and wording:** resume listening without replay.
- **Changed permit or wording:** present and speak the fresh Brain prompt before listening.
- **After accepted speech start but before finalized transcription:** allow transcription to finish locally, mark it Revalidation Pending, disable confirmation and microphone activity, then revalidate.
- **Valid mid-speech work:** resume the same exchange against a matching fresh permit.
- **Invalid mid-speech work:** retain exact captured wording as copyable Not Applied text; never submit it.
- **Decision Summary editing:** preserve text and disable confirmation while revalidating; rebase the same editor when valid or move the wording to Not Applied with `Reuse wording` when invalid.
- **Pause questions:** stop playback and capture, increment cancellation epoch, prevent next-permit promotion, retain active draft and confirmed queue in memory, do not cancel the Brain request, and require fresh revalidation before resume.

Continue using one Realtime WebRTC session and out-of-band Communicator responses. Do not reconnect for each permit or let Realtime create an autonomous Brain response.

## 8. Persistent Brain Status and lifecycle streaming

### 8.1 Presentation

Render a compact sticky Persistent Brain Status strip immediately below the existing header on every breakpoint, outside mobile Specification/History tabs. It remains visible during:

- active questions and prompt playback;
- listening and transcription;
- clarification and Decision Summary editing;
- Decision Tray review;
- Revalidation Pending work;
- pending Final Review abandonment; and
- request failure/retry states.

The status is non-modal. Do not mark the whole interview `aria-busy` or disable permitted asynchronous controls.

### 8.2 Status model

```ts
type BrainActivityState =
  | "working"
  | "taking_longer"
  | "connection_interrupted"
  | "needs_attention"
  | "timed_out"
  | "revision_applied"
  | "stopped";
```

- Show active status within 250 ms of accepting a PM action.
- Start one action-level monotonic elapsed timer at acceptance.
- Do not reset elapsed time for provider queuing, processing, response validation, or the single repair attempt.
- Show `Taking longer than usual` after 30 seconds of total elapsed time when lifecycle evidence remains fresh.
- Show the age of the last valid Brain Lifecycle Event.
- Ten seconds without a valid lifecycle event changes status to `Needs attention`, stops active animation, and states that Brain execution cannot currently be verified. This overrides `taking_longer` and does not claim execution stopped.
- A broken stream immediately shows `Connection interrupted · Brain state unknown`, stops active animation, and initiates best-effort abort/cancellation.
- Do not silently restart a broken Brain request. Explicit `Retry` creates a fresh request ID and cancellation epoch; reject all late old events/results.
- `Revision applied` may return to idle after a short non-announced acknowledgement. `Needs attention`, `Connection interrupted`, `Timed out`, and `Stopped` remain visible until explicit Retry, dismiss, or navigation; they cannot auto-idle while PM action is required.
- Never show percentages, estimated completion, invented model stages, chain-of-thought, or a healthy animation when execution cannot be verified.

The visible timer may update once per second but must catch up from monotonic/wall-clock timestamps after background-tab throttling.

### 8.3 Accessibility and motion

- Animation is decorative and `aria-hidden`.
- Under `prefers-reduced-motion`, replace motion with a static status icon while retaining all text and timers.
- Announce only semantic state transitions, including taking longer, connection interrupted, needs attention, timed out, revision applied, and stopped.
- Never announce one-second elapsed or last-event-age ticks.
- Preserve focus on the PM's active work.

### 8.4 Streamed Brain route

Replace the single terminal JSON body from `POST /api/brain` with one same-origin streamed response, recommended as validated NDJSON over `fetch`/`ReadableStream`.

Each line is one of:

```ts
type BrainStreamEnvelope =
  | { type: "lifecycle"; event: BrainLifecycleEvent }
  | { type: "result"; response: BrainResponse }
  | { type: "error"; error: ApiError };

interface BrainLifecycleEvent {
  schemaVersion: 1;
  requestId: string;
  actionId: string;
  baseRevision: number;
  cancelEpoch: number;
  attempt: 1 | 2;
  sequence: number;
  observedAt: string;
  kind:
    | "request_accepted"
    | "provider_queued"
    | "provider_in_progress"
    | "provider_attempt_terminal"
    | "validating_output"
    | "repair_started"
    | "cancellation_requested";
}
```

The exact discriminants may change during the contract freeze, but every lifecycle kind must map to a verified application or provider event. Repeated provider polls may emit fresh evidence even when provider status text is unchanged. `sequence` is globally monotonic across the whole authoritative action and does not reset for attempt two. `provider_attempt_terminal` closes only that provider attempt; it may be followed by local validation and `repair_started`. Only exactly one valid `result` or `error` envelope closes the action stream. EOF before either is `connection_interrupted`.

Lifecycle envelopes must exclude provider response IDs, prompts, answers, summaries, transcripts, Specifications, raw provider events, error/validation wording, credentials, and model-authored content. Use a strict allowlist and content-leak sentinel tests.

Set same-origin and no-store response headers. Bound line and stream sizes. Correctly parse split/coalesced chunks. Reject malformed, content-bearing, mismatched, duplicate, out-of-order, post-cancel-epoch, and post-action-terminal envelopes. A malformed or content-bearing line terminates the stream as compromised, stops healthy animation, and enters `connection_interrupted`/typed recoverable error; never ignore it and continue. Guard failures found before streaming begins return the existing ordinary HTTP JSON `ApiError`. Once streaming begins, terminal failures use one NDJSON `error` envelope.

If the hosting platform cannot reliably stream this contract for the required duration, do not fake lifecycle progress or silently create persistent job storage. Preserve the product behavior and record a new architecture decision before adopting another transport.

## 9. Decision Tray and checkpoint privacy

### 9.1 Decision Tray

The compact Decision Tray distinguishes:

- Draft
- Confirmed — awaiting dependency check
- Revalidation Pending
- Ready to apply
- Applying
- Apply failed — retry available
- Applied
- Not Applied

It provides `Confirm decision and continue`, `Pause questions`, `Resume questions`, `Defer this decision`, `Undo confirmation` before batch lock, and `Reuse wording` for Not Applied work. Future permits expose only topic labels and a count until promoted; never render a competing questionnaire.

Applied and Not Applied outcomes remain in memory through Final Review for the active 30-minute session. A mandatory Not Applied reason produces truthful copy:

- `dependency_invalidated`: the work was rejected before Brain submission after fresh dependency checking;
- `batch_failed`: the Brain may have processed it, but no validated complete revision applied it;
- `cancelled`: the application stopped waiting and attempted cancellation; no validated revision applied the work, and provider execution may have continued;
- `abandoned`: the PM explicitly entered Final Review without applying it; or
- `superseded`: a newer correction or decision replaced its relevance.

### 9.2 Checkpoint expansion

V3 deliberately expands the V2 checkpoint privacy boundary. Checkpoint at most three individually PM-confirmed queued entries, containing only:

- summary/deferral wording;
- stable job, exchange, permit, window, roadmap item, and confirmed turn IDs;
- approval revision and dependency version;
- confirmation record/time; and
- minimal source type needed to restore the queue.

Checkpoint the content-free adaptive tuple described in section 5.2: last three eligible outcome enums, current application cap, and singleton recovery streak. It contains no PM wording.

Never checkpoint drafts, clarification turns, transcripts, raw speech, unused permits, Not Applied wording/history, lifecycle events/timers, provider state/IDs, cancellation state, or search page content.

After reload:

- restore entries as `Confirmed — awaiting dependency check` / Revalidation Pending;
- never auto-submit;
- expose explicit `Revalidate restored decisions`, run the non-mutating `revalidate_restored` operation, then require explicit `Submit restored decisions` after successful revalidation;
- do not restore an active Brain request or healthy activity animation; and
- retain all existing 30-minute expiry, Reset, explicit exit, and malformed-checkpoint cleanup behavior.

Increment the checkpoint schema version and implement explicit migration/rejection tests. Do not partially restore unsafe V2/V3 shapes.

## 10. Markdown export

Keep export authoritative:

- Exclude Decision Tray drafts, confirmed queued wording, Revalidation Pending work, Not Applied wording/history, clarification turns, and lifecycle activity.
- Applied decisions appear through the Specification and existing provenance.
- Preserve existing draft/final and Live/Prepared warnings.
- Add the adapter and public-search-enabled state to explicitly labeled local experimental provenance when applicable.
- Never label local experimental output as ordinary Live Mode output, and never display experimental provenance in Prepared Demo.

Search-informed exported items retain evidence reference IDs. Add an `External Evidence` appendix containing source title, URL, retrieval time, and informed Specification Item IDs. Proposed status remains explicit; evidence does not upgrade authority.

## 11. Experimental Brain harnesses

### 11.1 Adapter and flags

Freeze one authoritative adapter contract so UI/reducer behavior is independent of the implementation:

```ts
type BrainHarnessMode = "one_shot" | "responses_native" | "codex_ephemeral";

interface BrainHarness {
  run(input: ValidatedBrainInput, signal: AbortSignal): AsyncIterable<BrainHarnessEvent>;
}
```

Recommended server-only environment controls:

```dotenv
OPENAI_BRAIN_HARNESS=one_shot
BRAIN_PUBLIC_SEARCH_ENABLED=false
```

`one_shot` remains the default. Do not use `NEXT_PUBLIC_` flags or expose a public mode selector. `responses_native` may run only with the fixed Live Brain model/security boundary. `codex_ephemeral` is accepted only by the local evaluation runner (or an explicitly development-only experimental shell), and the ordinary Live route rejects it until a later promotion ADR. Local experimental UI/export provenance discloses the adapter and search state without labeling the result as ordinary Live Brain output.

### 11.2 Candidates

1. `one_shot`: current GPT-5.6 medium-reasoning background Responses implementation with Structured Outputs, one bounded repair, and `store: false`.
2. `responses_native`: GPT-5.6 medium-reasoning analyst pass, dependency/contradiction critic, Specification synthesis, deterministic semantic validation, and one bounded repair. Every provider pass uses Structured Outputs where applicable and `store: false`; internal pass output is non-authoritative and never renders.
3. `codex_ephemeral`: fresh local Codex execution receiving the same complete confirmed snapshot and output schema.

All candidates must produce the same complete Brain output contract and pass the same Zod, semantic, request-ID, base-revision, provenance, revision-barrier, and full-snapshot validation. No candidate may introduce hidden durable state.

Every Responses API call made by `one_shot` or `responses_native` uses `store: false`; internal passes remain bounded inside the one authoritative application request and require explicit timeout/execution-budget verification. A `codex_ephemeral` run remains local evaluation-only unless its provider retention and `store: false` behavior can be verified rather than inferred.

### 11.3 Codex isolation

Each `codex_ephemeral` run uses:

- a fresh empty temporary directory;
- an ephemeral session (`codex exec --ephemeral` or current documented equivalent);
- read-only sandbox;
- no repository files;
- no inherited user/project configuration or rules;
- no persistent Codex thread or app-server;
- no arbitrary MCP servers;
- a strict environment allowlist;
- the same confirmed input snapshot and schema supplied to other candidates; and
- structured output that still passes production validators.

Use the current official Codex documentation when implementing exact CLI/SDK flags: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) and [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode). The Codex SDK is intended for coding-focused threads; V3 therefore keeps this candidate local and evaluation-only unless a later promotion decision verifies product fit, packaging, sandboxing, retention, cancellation, and deployment.

Do not install or expose `grill-with-docs`, repository skills, or project instructions inside the candidate. Those are development workflows and would bias the comparison.

### 11.4 Controlled public search

Harness selection and search authorization are separate server-only controls, both default off/safe. When enabled for exploratory local `codex_ephemeral` runs:

- permit at most five search queries and five opened public sources per authoritative Brain request;
- use read-only public search only;
- exclude authenticated/private sources, connectors, arbitrary MCP servers, and side effects;
- never expose secrets or full private context in a query;
- search only for external facts or alternatives, never stakeholder decisions;
- validate and bound every retrieved result before model use; and
- treat page content as untrusted prompt-injection input.

Search-derived claims remain External Evidence. Every informed recommendation or proposed Specification Item displays source title, HTTPS URL, retrieval time, and evidence ID. Search cannot independently create `confirmed` or `derived` content.

If the current Codex execution surface cannot provide controlled search without inheriting broader network/tool access, keep search disabled. Do not weaken the isolation boundary merely to satisfy the experiment.

`BRAIN_PUBLIC_SEARCH_ENABLED=true` is valid only with the local `codex_ephemeral` evaluation runner; reject the configuration for `one_shot` and `responses_native`. Before a local search-enabled run, disclose that PM-derived queries and retrieved public pages are processed by the configured search/Codex provider under its verified retention controls and require explicit acknowledgement. Never log raw queries or results, regardless of whether they appear sensitive.

Use a provider-hosted search capability so the application does not directly fetch arbitrary result URLs. Direct app URL fetching is forbidden in V3; adding it later requires redirect limits, URL-credential rejection, private/reserved-address and DNS-rebinding protection, content-type/byte/time limits, and a new security review. Render external links with safe new-tab behavior such as `noopener noreferrer` where applicable.

For scored harness comparison, disable live network search, freeze retrieved evidence as a validated `ValidatedBrainInput.externalEvidenceBundle`, and provide the identical bundle to every candidate. Evaluate live-search behavior in a separate, explicitly labeled run so one candidate's network access cannot bias the blind quality comparison.

### 11.5 Harness promotion gate

V3 implementation is complete without promoting an experimental adapter.

An experimental candidate is automatically disqualified by any invented-decision, authority, provenance, privacy, security, or Live/Prepared-isolation violation.

Otherwise promotion requires:

- at least 24 frozen sessions;
- one blinded PM rating per session for each of two separate five-point rubrics: question quality and Specification completeness;
- at least 18 non-tied session comparisons per rubric, with ties and invalid/missing candidate output counted as non-wins rather than removed from the denominator after the 18-comparison minimum is met;
- at least 60% wins against `one_shot` separately on both rubrics;
- first-pass schema and semantic validity no worse than `one_shot`;
- at least five percentage points absolute improvement in dependency/stale-classification accuracy and at least 0.25 points improvement on a frozen five-point Acceptance Criterion testability rubric, with no authority metric regression;
- end-to-end p95 latency no worse than 2x `one_shot` on matched sessions and environment;
- successful cancellation/late-output rejection, retention, sandbox, environment, packaging, cold-start, and target-host verification; and
- a separate explicit decision/ADR before changing the default.

Tokens and estimated cost are recorded when available but are informational for this hackathon, not a promotion gate. Spend remains controlled through the dedicated capped OpenAI project and disabled-by-default flags.

Compute latency from at least three repetitions per fixture per candidate in the same environment. Report warm and cold runs separately and use nearest-rank p95 on the matched action samples. Before running, freeze the rubric wording, random seed, label map, prompt/schema/evidence hashes, SDK/CLI versions, requested and actual model IDs, flags, runner commit, timestamps, and host/hardware metadata. Keep the label map blinded until human scoring is complete.

V3 implementation Definition of Done requires the fixtures, runner, deterministic technical scorers, gate computation, and documentation. It does not require completing a live Codex/OpenAI bake-off, obtaining 24 human ratings, or promoting a candidate; those remain opt-in local/human evaluation.

Use current Agents SDK guidance for the Responses-native experiment and evaluation/orchestration patterns: [Agents SDK starting points](https://developers.openai.com/api/docs/guides/agents#choose-your-starting-point). Do not make the Agents SDK, Codex SDK, or Codex CLI a production dependency merely because it exists.

## 12. Frozen evaluation dataset

Commit at least 24 synthetic or deliberately non-sensitive session fixtures plus scoring rubrics. Never derive them from captured Live Interview Sessions, transcripts, uploads, Specifications, provider logs, or user documents.

Cover:

- contradictions;
- corrections and deferrals;
- provenance/status boundaries;
- stable ID preservation;
- roadmap DAGs and pairwise independence;
- valid and stale Interview Jobs;
- Readiness calibration;
- risks and edge cases;
- test-ready Acceptance Criteria;
- search-informed proposed evidence; and
- failure/cancellation/late-output paths.

Blind outputs with seeded randomized candidate labels. Commit only synthetic inputs, rubrics, source metadata, and licensed bounded excerpts or application-authored factual abstracts under a designated evaluation-fixture directory. Generated synthetic candidate Specifications and reports belong only in a designated gitignored evaluation-artifact directory with a validated schema; Live content is forbidden there. Store aggregate scores and content-free run metadata separately from candidate outputs. Add sentinel scans for both committed fixtures and generated reports. Do not add runtime session capture as an evaluation feature.

Measure:

- first-pass schema/semantic validity and repair rate;
- invented-decision, authority, provenance, and privacy violations;
- stable-ID preservation;
- dependency and stale-classification accuracy;
- pairwise permit independence;
- Acceptance Criterion testability;
- blind PM preference;
- p50/p95 action latency and time to first truthful lifecycle event;
- PM idle time versus V2;
- dependency-stale confirmed-summary rate and stale-before-confirmation rate;
- cancellation and late-output rejection;
- cold-start, package, filesystem, environment, log, and provider-retention behavior; and
- tokens and estimated cost as informational metrics.

## 13. Prepared Demo

Extend the deterministic team-billing Prepared Demo without external/provider/search calls, user files, microphone access, or Realtime. Bundled same-origin application and static assets remain allowed.

The V3 sequence must:

1. Confirm the bundled Project Context Digest.
2. Submit one prepared answer.
3. Show sticky Prepared Brain Status immediately.
4. Open a two-permit Interview Window.
5. Clarify and confirm the first prepared decision.
6. Clarify and individually confirm the second permitted decision while prepared Brain work remains visibly active.
7. Apply the prepared authoritative revision first.
8. Revalidate both asynchronous jobs.
9. Preserve one valid result and mark one dependency-invalidated result Not Applied with `Reuse wording`.
10. Automatically submit the one valid prepared Decision Batch.
11. Apply the prepared batch revision and continue to Final Review and Markdown export.

Use a clearly labeled, user-paced deterministic fixture clock. Prepared actions advance validated fixture lifecycle events and displayed elapsed time, including the 30-second `Taking longer` transition, without imposing a real 30-second wait or implying provider activity.

Prepared provenance remains `Prepared demo • no AI call`. It never displays experimental harness/search provenance and never calls `/api/brain`, `/api/realtime`, `/api/context`, OpenAI, Codex, search, or a microphone.

## 14. Failure behavior

| Failure or race | Required behavior |
|---|---|
| Invalid Interview Window or permit | Reject the complete Brain output; one repair attempt; preserve the last valid Specification. |
| Coupled permits | Reject the complete output; never render a partial window. |
| Duplicate confirmation | Apply immediate idempotent feedback; create no duplicate job, turn, batch entry, or request. |
| Revision during playback/listening | Stop audio/mic and revalidate before resuming. |
| Revision during speech/transcription | Finish transcription locally behind Revalidation Pending; never allow confirmation before revalidation. |
| Revision during summary editing | Preserve text, disable confirmation, then rebase or mark Not Applied. |
| Permit exhausted | Wait with truthful status; Communicator invents no replacement. |
| Retryable batch timeout/interruption/rate limit/provider failure | Apply nothing; preserve the exact locked batch as `Apply failed — retry available`; explicit Retry uses a fresh request identity and the same immutable batch. |
| Terminal batch validation failure/refusal/abandonment | Apply nothing; append no provisional turn; mark every entry Not Applied with `batch_failed` or `abandoned`. |
| Contradictory batch entries | Preserve both sources and expose an unresolved contradiction. |
| Lifecycle envelope invalid/content-bearing | Terminate the compromised stream, retain the last valid Specification, show `Connection interrupted · Brain state unknown` or the typed recoverable error, and never render the rejected content. |
| Lifecycle silence for 10 seconds | `Needs attention`; stop active animation; state is unverifiable. |
| Stream disconnect | `Connection interrupted · Brain state unknown`; best-effort cancel; explicit Retry only. |
| Timeout/abort/cancel failure | Preserve state; reject late output locally; never claim provider execution stopped. |
| Reload with confirmed queue | Restore only bounded confirmed entries as awaiting dependency check; require explicit `Revalidate restored decisions`, then explicit `Submit restored decisions`; never auto-submit. |
| Search failure | Continue without search-derived claims or return a typed experimental-harness failure; never fabricate evidence. |
| Unsafe or invalid search result | Exclude it; render no citation; preserve prior valid state. |
| Experimental harness unavailable | Typed recoverable error or explicit switch back to `one_shot`; never substitute Prepared data. |
| PM enters Final Review with pending work | Show pending Decision Tray and require explicit abandonment. |
| Late event after finalization/abandonment | Reject by request/exchange/permit/cancel epoch. |

## 15. Accessibility, privacy, and security additions

- Maintain WCAG 2.2 AA-oriented V1/V2 behavior.
- At 390 px, show header, Persistent Brain Status, active question, and Decision Tray without horizontal page scrolling.
- Do not make timer text a chatty live region.
- Keep at least 44 px practical targets for Confirm, Pause, Defer, Undo, Retry, and Reuse wording.
- Status meaning cannot rely on color or animation.
- External Evidence links require descriptive accessible names and safe HTTPS handling.
- Never render arbitrary retrieved markup; display application-authored citation components only.
- Never log or checkpoint raw search queries/results. Content-free counts/timing may be measured.
- Never include API keys, Codex credentials/state, provider IDs, prompts, answers, summaries, Specifications, search page content, or raw errors in lifecycle events/logs.
- Keep experimental flags server-side; distinguish local experimental evaluation from ordinary Live Mode and Prepared Demo, and require the approved search-processing acknowledgement before a local search-enabled run.
- Preserve all V1/V2 upload deletion, provider retention, and no-ZDR-claim constraints.

## 16. Acceptance criteria

- An Interview Window contains zero to three permits and never exceeds the current application cap.
- Every displayed permit passes deterministic roadmap-DAG, pairwise independence, operation, revision, dependency, and invalidation-reference validation.
- Every prior permit receives exactly one Brain disposition, and every reissue points to exactly one compatible fresh permit; the application never invents a disposition.
- Exactly one detailed/spoken question is active.
- The Communicator cannot invent, reorder, broaden, or replenish decisions.
- Confirmation feedback appears within 250 ms and repeated activation creates no duplicate state or request.
- Persistent Brain Status remains visible during every active question, clarification, summary edit, mobile tab change, and pending Final Review state.
- `Taking longer than usual` appears at 30 seconds of total action time without resetting for repair.
- Ten seconds without verified lifecycle activity becomes `Needs attention`; animation stops.
- Every lifecycle display maps to a validated observable event; no percentage, ETA, or invented stage appears.
- Reduced-motion and screen-reader behavior communicates status without timer-tick announcements.
- A validated authoritative revision applies before asynchronous work is revalidated or batched.
- Old permits expire at every revision barrier.
- Mid-speech and mid-edit work is preserved locally but cannot be confirmed until fresh revalidation.
- Only individually PM-confirmed, freshly revalidated entries enter a 1..3 Decision Batch; this exact locked batch is the sole exception to requiring another confirmation immediately before `/api/brain` submission.
- Decision Batch submission is automatic after revalidation and atomic on application.
- A retryable application failure preserves the exact locked batch for explicit Retry; a terminal failure appends no provisional turn and produces a truthful Not Applied reason.
- Undo is available only before batch lock.
- Contradictory confirmed entries remain distinct and produce an unresolved contradiction.
- Not Applied outcomes carry a truthful required reason and support wording reuse.
- Adaptive shrinking and re-expansion follow the exact rolling rules, exclusions, checkpoint tuple, and conservative invalid/missing-tuple recovery.
- Three-permit quality fails when dependency-invalidated confirmed summaries exceed 25% after the specified minimum of 12 eligible jobs.
- A reload restores at most three confirmed queued entries and never drafts, transcripts, lifecycle state, or automatic submission; revalidation and submission are two explicit PM actions.
- Decision Tray work is absent from Markdown; External Evidence provenance is retained where applicable.
- Experimental harness and search provenance is visible only in the explicitly labeled local evaluation surface, never as ordinary Live Mode or Prepared Demo provenance.
- Local public search is separately acknowledged, never logs raw queries/results, and enforces at most five queries and five opened public sources per request.
- `codex_ephemeral` is rejected by the ordinary Live route until a later promotion ADR.
- `one_shot` remains the default and V3 can ship without promoting another candidate.
- Frozen evaluation uses at least 24 synthetic/non-sensitive sessions and applies the confirmed quality/latency gates.
- Prepared Demo proves status, two permits, two sequential decisions, revision-first revalidation, one valid batch entry, one Not Applied outcome, and final export without external/provider/search calls, OpenAI, Codex, microphone, or user-file input.
- All V1 and V2 critical tests continue to pass.

## 17. Dependency-ordered implementation sequence

### Milestone V3.0 — Shared contract freeze

Root integrator owns this milestone before parallel edits.

Deliver:

- Interview Window, Question Permit, Interview Job, Decision Batch, Not Applied reason, Brain Lifecycle Event, activity status, External Evidence, Specification/evidence linkage, and checkpoint schemas.
- Reducer events and invariant table.
- Brain streaming envelope and adapter interfaces.
- Realtime exchange/permit/cancel-epoch contract.
- Exact ownership map and V2 fixture migration approach.

Definition of done:

- Shared Zod contracts compile and have focused valid/invalid tests.
- No module owner needs to edit a shared contract independently.
- Existing V1/V2 schemas and fixtures have an explicit compatibility/migration path.

### Milestone V3.1 — Persistent status transport and UI

Dependencies: V3.0.

Deliver:

- content-free streamed Brain route;
- browser stream parser and lifecycle reducer;
- sticky status UI, timers, threshold precedence, retry, accessibility, and reduced motion;
- deterministic mocked lifecycle fixtures.

Definition of done:

- status appears within 250 ms and persists across async UI states;
- malformed/content-bearing/out-of-order/late events are rejected;
- 30-second and 10-second thresholds pass fake-clock tests;
- stream disconnect never looks healthy or auto-restarts work.

### Milestone V3.2 — Window, queue, and batching

Dependencies: V3.0 and V3.1 contracts.

Deliver:

- Brain Window generation and semantic validation;
- reducer queue, adaptive cap, expiry/rebase, automatic Decision Batch submission, correction priority, deferral, undo, and Not Applied reasons;
- Decision Tray and Final Review integration;
- bounded checkpoint migration.

Definition of done:

- deterministic graph validation rejects every coupled-window fixture;
- one request/revision barrier invariant holds under races;
- batch membership and confirmation evidence are exact;
- checkpoint privacy and restore revalidation pass.

### Milestone V3.3 — Realtime mid-turn safety

Dependencies: V3.0 and V3.2 reducer states.

Deliver:

- exchange/permit/cancel-epoch propagation;
- provider event deduplication;
- protected mid-speech transcription;
- playback/listening/editing revision matrix;
- pause/resume and sequential permit promotion.

Definition of done:

- late same-topic provider events cannot bind to a newer exchange;
- speech is preserved without becoming prematurely confirmable;
- microphone and playback gates satisfy every revision race.

### Milestone V3.4 — Prepared Demo

Dependencies: V3.1–V3.3.

Deliver:

- two-permit prepared window;
- user-paced deterministic lifecycle clock;
- two sequential prepared decisions;
- one valid and one Not Applied result;
- automatic prepared batch and final export.

Definition of done:

- no external/provider/search call, OpenAI, Codex, microphone, context route, or user file is used after app load; bundled same-origin application/static assets are allowed;
- status and accessibility behavior use the production rendering path;
- browser tests are deterministic and fast.

### Milestone V3.5 — Experimental harnesses and evidence

Dependencies: V3.0 adapter and validated one-shot parity.

Deliver:

- `one_shot`, `responses_native`, and local `codex_ephemeral` adapters;
- separate server-only harness/search flags;
- Codex isolation runner;
- controlled search, External Evidence validation/UI/export, and frozen evidence bundles;
- at least 24 evaluation fixtures, blind runner, rubrics, and aggregate reporting.

Definition of done:

- default behavior remains `one_shot`;
- normal CI never requires Codex, public search, OpenAI, or a key;
- isolated local Codex mode is opt-in and content-safe;
- no experimental adapter is promoted automatically;
- evaluation gates and disqualifiers are computed reproducibly.

### Milestone V3.6 — Integrated verification and docs

Dependencies: V3.1–V3.5.

Deliver:

- unit/integration/Playwright race and privacy matrix;
- 390 px, axe, reduced-motion, keyboard, and screen-reader checks;
- README, CHANGELOG, ownership, environment, local harness, manual verification, and storyboard updates based only on completed work.

Definition of done:

- required commands pass;
- V1/V2 regressions pass;
- Prepared Demo is offline-capable;
- Live/Codex/search/physical-microphone checks are reported honestly and never inferred from mocks.

## 18. Team ownership

Preserve the existing four-agent team. The root freezes shared contracts and owns cross-module ordering.

### Root integrator

Owns:

- `src/domain/**` shared V3 schemas/types/reducer/events/invariants;
- `src/realtime/CommunicatorTransport.ts`;
- `src/app/SpecGrillApp.tsx`, `src/app/brain-client.ts`, and integration wiring;
- `src/lib/session-checkpoint.ts` and schema migration;
- root configuration and cross-module contract changes.

### `brain-api`

Owns:

- `src/agents/brain/**`;
- `src/app/api/brain/**`;
- Window planning/validation, Decision Batch request validation, streamed lifecycle emission, adapters, search evidence validation, harness runners, evaluation fixtures owned by the module, and Brain tests.

It consumes but does not independently edit frozen shared contracts.

### `realtime-voice`

Owns:

- `src/realtime/**` except the shared transport interface;
- `src/agents/communicator/**`;
- `src/app/api/realtime/**`;
- exchange/permit/cancel-epoch propagation, provider event deduplication, mid-turn race behavior, pause/resume, and Realtime tests.

### `experience-demo`

Owns:

- `src/components/**`;
- `src/demo/**`;
- `src/export/**`;
- Persistent Brain Status presentation, Decision Tray, External Evidence rendering, Prepared V3 fixture flow, responsive/accessibility component behavior, and owned tests.

### `verification-docs`

Owns:

- cross-module tests under `tests/**` excluding module-owned fixtures;
- test configuration;
- `README.md`, `.env.example`, `CHANGELOG.md`, `docs/demo-video-storyboard.md`, and manual checklists;
- independent lifecycle privacy, checkpoint, race, accessibility, Prepared isolation, harness evaluation, and leaked-content verification.

Module owners fix findings in their files. The root resolves shared-contract and orchestration findings. Do not let agents concurrently edit the same shared file.

## 19. Verification plan

### Contract and reducer tests

- Window size/cap, uniqueness, pairwise DAG independence, invalidation cross-reference, revision/dependency binding, and expiry.
- Job lifecycle and exactly one active visible question.
- Adaptive shrink/re-expand windows and exclusions.
- Confirmation idempotence, undo boundary, exact batch membership/order, atomic failure, and contradiction preservation.
- Revision-first revalidation under response races.
- Mid-playback, idle, speech, transcription, summary-edit, pause, correction, and finalization races.
- Request/exchange/permit/cancel-epoch and provider-event dedup rejection.
- Exact prior-permit disposition membership/reissue binding and roadmap DAG/cycle rejection.
- Retryable exact-batch preservation versus terminal Not Applied behavior.
- Checkpoint inclusion/exclusion, adaptive tuple fallback/recovery, version migration, explicit reload revalidation and submission, expiry, reset, and exit.

### Lifecycle integration tests

- Partial/coalesced NDJSON chunks.
- Valid repeated provider status events with monotonic sequence.
- Malformed/content-bearing/provider-ID envelopes.
- Compromised-stream termination rather than continuing after a malformed/content-bearing line.
- Duplicate, out-of-order, mismatched, post-terminal, post-cancel, and late events.
- Repair attempt on one continuous action timer.
- 30-second taking-longer threshold and 10-second needs-attention precedence.
- Disconnect, explicit retry, timeout, cancellation failure, and late final response.

### UI/accessibility tests

- Sticky status in every async phase and mobile tab.
- Decorative active animation and reduced-motion static equivalent.
- Semantic live-region announcements only.
- Decision Tray statuses/actions, Not Applied truthfulness, Reuse wording, and Final Review abandonment.
- Pause/Resume controls and visible Revalidation Pending behavior.
- External Evidence visible citations and Markdown appendix.
- 390 px layout with no horizontal page scroll and practical pointer targets.

### Harness tests

- Adapter parity on the same validated input/output contracts.
- Codex empty/read-only/ephemeral environment and strict env allowlist.
- No repository/project skill/config inheritance.
- Search disabled by default; explicit processing acknowledgement and five-query/five-source caps when enabled.
- Untrusted search-content handling and authority status enforcement.
- Raw search query/result log and checkpoint sentinels.
- Frozen identical evidence for scored candidates.
- Automatic disqualifiers, 60% non-tie preference threshold, 2x p95 latency ceiling, and informational cost output.
- No normal test invokes OpenAI, Codex, public search, microphone hardware, or external user files.

### Playwright critical additions

1. Persistent status survives active question, clarification, summary editing, and mobile tab changes.
2. Two-permit Prepared Demo produces one applied and one Not Applied result, then exports.
3. Duplicate confirmation and undo-before-lock behavior.
4. Revision arrival during playback, speech, and summary editing.
5. Stream silence/disconnect/explicit retry while the last Specification remains visible.
6. Reload restores only bounded confirmed queue wording and requires revalidation.
7. Experimental provenance and External Evidence remain confined to the labeled local evaluation surface; ordinary Live rejects `codex_ephemeral`, and Prepared Demo makes no forbidden call.

## 20. Explicit non-goals

- More than three permits or continuously replenished windows.
- More than one active visible/spoken question.
- Communicator-authored or reordered decisions.
- Multiple concurrent authoritative Brain revisions or client-side snapshot merge.
- Blanket confirmation of several decisions.
- Automatic restart after a broken Brain stream.
- Durable/background/cross-session queues, notifications, or workers.
- Persistent Codex threads, Codex app-server sidecars, or hidden harness state.
- Public/user-selectable harness or search controls.
- Authenticated/private web search, private connectors, arbitrary MCP, or browsing with secrets.
- Installing planning skills into the runtime harness.
- Capturing Live sessions to build evaluation data.
- Exporting Decision Tray or Not Applied wording as Specification content.
- Weakening any V1/V2 auth, storage, upload, model, confirmation, provider-key, or Live/Prepared boundary.

## 21. Required final verification

Run the actual repository scripts:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Also verify:

- Prepared Demo completes with external network blocked and without OpenAI, Codex, search, microphone, or user files; bundled same-origin assets may load.
- V1/V2 critical flows still pass.
- No secret, provider ID, content-bearing lifecycle data, transcript, draft/clarification text, unallowlisted summary, raw search query/result/page content, or Codex state leaks into browser logs, server logs, checkpoints, artifacts, or bundles. Checkpoints may contain only the existing confirmed Specification/digest allowlist plus the bounded confirmed queued entries and content-free adaptive tuple approved in section 9.2. The only evaluation-artifact exception is synthetic/non-sensitive candidate output written to the designated gitignored evaluation-artifact directory; Live content is forbidden there.
- Feature flags default to `one_shot` and search disabled.
- Local Codex/search evaluation is opt-in and results are reported as experimental.
- Physical microphone, live OpenAI, target-host streaming duration, and provider-retention checks are claimed only when actually performed; otherwise use the existing human-action blocker protocol.

No V3 product decisions remain open. Exact component layout, internal filenames, NDJSON parser library choice, fixture wording, and adapter class organization are implementation choices only when they preserve every requirement and acceptance criterion above.
