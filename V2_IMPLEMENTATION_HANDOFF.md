# Spec Grill V2 — Implementation Handoff

Status: approved product requirement; not yet implemented

Approved: 2026-07-20

Audience: a separate Codex implementation session

## 1. Authority and read order

V2 extends the delivered V1; it does not replace or weaken V1's authority, security, validation, provenance, Live/Demo separation, or PM-confirmation boundaries.

Before changing code, read:

1. `IMPLEMENTATION_HANDOFF.md`
2. This file
3. `CONTEXT.md`
4. Every file in `docs/adr/`
5. `README.md` and `CHANGELOG.md`
6. The implementation and tests needed to verify current behavior

The product decisions below are settled. Implementation agents may choose internal data structures and presentation details, but must not reopen these boundaries, weaken them to fit an SDK, or expand the scope.

## 2. V2 objective

Keep the Product Manager meaningfully engaged during Brain latency and allow an Interview Session to begin from rich, reviewed project context without weakening confirmation, provenance, or Specification authority.

## 3. User flow

1. The PM provides a short Initial Prompt plus one optional context source:
   - Markdown or plain text entered in a large editor; or
   - One `.md`, `.txt`, `.pdf`, or `.docx` file.
2. Spec Grill validates and extracts the context before starting the interview.
3. The preparation screen shows an editable Project Context Digest with source references, coverage, omissions, and extraction warnings.
4. The PM explicitly confirms the digest.
5. Only after confirmation does the Brain create the initial Specification and an internal prioritized Question Roadmap with dependencies.
6. After each Confirmed Answer or confirmed Decision Summary:
   - The Brain begins the authoritative revision.
   - The Communicator may present exactly one Brain-approved, dependency-independent Lookahead Question while that request runs.
   - If no safe lookahead exists, the UI shows truthful topical and processing-stage progress.
7. The Communicator may conduct multiple short clarification turns about that one approved decision, then creates one concise, editable Decision Summary.
8. A PM-confirmed Decision Summary waits until the in-flight Brain request completes and the lookahead is revalidated.
9. The cycle continues with at most one active question until Final Review.

The same approval flow must work through voice and the first-class text path.

## 4. Authority and confirmation boundaries

- Explicit statements retained in the PM-confirmed Project Context Digest are Confirmed Input.
- The original document is reference context. Brain interpretations beyond the confirmed digest wording remain `proposed` unless later confirmed by the PM.
- Raw speech, transcript deltas, finalized transcripts, extraction output, clarification exchanges, and unconfirmed Decision Summaries are non-authoritative.
- Only PM-confirmed input may reach the Brain or change the Specification.
- The Communicator may clarify ambiguity, reconcile statements within one approved topic, and request missing detail needed to summarize it.
- The Communicator may not introduce a second roadmap decision, recommend a substantive product answer, plan future questions, assess Readiness, or mutate the Specification.
- The Brain remains authoritative for complete Specification revisions, Readiness, provenance, contradictions, Question Roadmap priorities and dependencies, Lookahead Question approval, and future-question planning.
- The application remains authoritative for approval, queuing, stale-work rejection, and state transitions.
- Every model, extraction, and API result must be validated before rendering or state mutation.
- Invalid or stale output never replaces the last valid Specification.

## 5. Latency-resilient interview requirements

### 5.1 Question Roadmap

The Brain must return and maintain a validated internal roadmap that provides enough structured information to:

- Preserve stable roadmap-item identity when meaning is unchanged.
- Order unresolved decisions by priority.
- Represent dependencies between decisions.
- Identify no more than one item as safe for lookahead during the next Brain request.
- Bind lookahead approval to the Specification revision and dependency state on which it was approved.
- Explain why an item or queued summary became stale without exposing chain-of-thought.

The detailed roadmap and future-question wording remain internal. The PM sees only the current decision area, completed areas, unresolved dependencies, and actual processing stages. Do not show a synthetic completion percentage.

### 5.2 Lookahead and clarification

- A Lookahead Question may be presented only when the preceding validated Brain output explicitly approved it as independent of the next in-flight operation.
- Exactly one Lookahead Question or clarification exchange may be active or queued at a time.
- Clarifications must remain within the approved roadmap decision.
- The exchange ends with one editable Decision Summary rather than a transcript-review requirement.
- If the exchange is still ambiguous, the Decision Summary exposes the uncertainty instead of guessing.
- Confirmation controls must state that a summary may be queued pending revalidation.
- Confirming or retrying an action gives immediate visible state feedback and cannot create duplicate submissions.

### 5.3 Stale work

A validated Brain revision always applies before queued lookahead work. After it applies, the application must revalidate the active Lookahead Question and any queued Decision Summary against the new roadmap and dependency version.

- If still valid, the exchange may continue or the confirmed summary may be sent to the Brain next.
- If stale, stop or quarantine it, explain the reason, and never send it to the Brain or apply it to the Specification.
- Preserve stale summaries visibly as `not applied` so the PM may copy or reuse their wording later.

### 5.4 Processing progress

When no lookahead is safe, show honest progress derived from actual application or provider lifecycle events. Progress may describe validation, contradiction review, dependency review, Specification revision, or next-question planning, but must not invent completion, expose chain-of-thought, or imply a result before validation.

## 6. Rich initial project context requirements

### 6.1 Input scope and limits

Support one optional context source in addition to the Initial Prompt.

| Source | V2 limit |
|---|---|
| Markdown/plain-text editor | 100,000 characters |
| `.md` or `.txt` file | 100,000 decoded characters |
| `.pdf` file | 10 MB and 50 pages |
| `.docx` file | 10 MB and 100,000 extracted characters |

- Selecting a second file requires confirmation that it will replace the first.
- Never silently truncate content.
- Unsupported, encrypted, corrupted, empty, or over-limit documents block interview start.
- Offer retry, replacement, removal, or continuation with the Initial Prompt and pasted context only.
- Partial extraction may proceed only when usable content exists, every known gap is identified, and the PM explicitly acknowledges the warning while confirming the edited digest.

The selected formats are supported by current OpenAI file inputs. The product limits are intentionally below the provider's 50 MB per-request limit to control preparation latency and context growth: https://developers.openai.com/api/docs/guides/file-inputs

### 6.2 Preparation and review

- Document processing is a distinct pre-interview preparation phase.
- Do not create the Question Roadmap, begin microphone capture, or start the interview before Project Context Digest confirmation.
- Show extraction state, recovered coverage, source locations, omissions, and actionable failures.
- The digest is editable before confirmation.
- Each retained statement receives stable source provenance to the filename and page, heading, paragraph, or equivalent location when available.

### 6.3 Context use and latency

Preparation produces:

1. A concise PM-confirmed Project Context Digest, with source references, that accompanies Brain requests.
2. A temporary source-addressable extraction held only for the active tab.

The full document must not be resent on every Brain turn. Each turn includes only the confirmed digest and excerpts relevant to current roadmap dependencies, within a bounded context budget.

If reload recovery restores the confirmed digest but the temporary extraction is gone, the interview may continue from the digest. Deep source lookup requires re-uploading the original file.

### 6.4 Privacy and deletion

- Do not create a durable OpenAI Files API object or any other persistent provider file object.
- Original file bytes may exist only for the active preparation request and must be discarded immediately after preparation succeeds or fails.
- The app server must not persist uploaded bytes, extracted text, the digest, or Specification content.
- The active tab may temporarily hold the source-addressable extraction.
- The existing expiring per-tab checkpoint may contain only the confirmed digest, its provenance, filename/type metadata, and extraction warnings—not the original file or full extraction.
- Reset, explicit exit, and expiry clear all app-held document context.
- Standard OpenAI credentials remain server-side.
- Provider calls continue to use `store: false` where applicable.
- Privacy copy must distinguish app deletion from OpenAI processing and possible provider retention. Do not claim Zero Data Retention without verifying the active project: https://developers.openai.com/api/docs/guides/your-data

## 7. Prepared Demo

Prepared Demo must demonstrate both V2 improvements without OpenAI, microphone access, or a user-provided file:

- A bundled sample project document.
- A prevalidated extraction and editable-looking prepared Project Context Digest.
- Explicit prepared confirmation.
- A deterministic processing delay with truthful prepared progress.
- One safe Lookahead Question and clarification-to-summary flow.
- One deterministic stale-lookahead or stale-summary outcome labeled `not applied`.
- Prevalidated roadmap, Specification, and provenance snapshots.

Prepared content remains visibly labeled `Prepared demo • no AI call`. It never enters a Live Mode request or Specification.

## 8. Important failure behavior

| Failure | Required behavior |
|---|---|
| Unsupported, encrypted, corrupt, empty, or over-limit context | Block interview start; offer retry, replacement, removal, or pasted-context fallback. |
| Partially readable context | Show exact known coverage gaps; require explicit acknowledgement before digest confirmation. |
| Extraction or digest output fails validation | Render no invalid content; preserve user input and allow retry or removal. |
| Temporary extraction is lost after reload | Continue from the confirmed digest; require re-upload for deep source lookup. |
| No safe lookahead exists | Show actual topical and processing-stage progress. |
| Realtime fails during clarification | Preserve confirmed state and editable summary content; continue through text. |
| Brain finishes while lookahead work is active | Apply the validated Brain revision first, then revalidate the lookahead. |
| Lookahead or queued summary is stale | Quarantine as `not applied`; explain why; never submit or mutate the Specification. |
| Brain output is invalid, refused, timed out, or stale | Preserve the last valid Specification and confirmed input; offer the existing safe retry path. |
| PM enters Final Review with pending work | Review the last valid Specification; finalization requires explicit abandonment of pending work. |
| Late response arrives after abandonment/finalization | Reject it as stale. |
| Live V2 flow fails | Offer Live retry or an explicit new Prepared Demo session; never blend modes. |

## 9. Acceptance criteria

- The preparation screen accepts exactly the agreed editor/file inputs and rejects every agreed invalid or over-limit case before interview start.
- No extracted statement affects the Specification or Question Roadmap before PM confirmation.
- The confirmed digest preserves statement-level source provenance and identified coverage gaps.
- Confirmation controls show visible state feedback within 250 ms and repeated activation produces no duplicate submission.
- During every Brain request, the PM sees either exactly one safe lookahead or meaningful processing progress within one second.
- A clarification exchange cannot move to a second roadmap decision.
- Raw speech, transcripts, clarification content, and unconfirmed Decision Summaries cannot reach the Brain.
- A queued Decision Summary reaches the Brain only after PM confirmation and successful dependency revalidation.
- Stale prompts and summaries never change the Specification.
- The Brain remains the sole source of Specification, Readiness, contradiction, provenance, and roadmap revisions.
- The full source document is not included in routine per-turn Brain requests.
- The last valid Specification survives extraction, Realtime, Brain, validation, timeout, duplicate-action, and stale-response failures.
- Voice and text paths satisfy the same confirmation and stale-work boundaries.
- Prepared Demo proves the V2 preparation, lookahead, summary, progress, and staleness flows without network, OpenAI, microphone, or user-file dependencies.
- Live and Prepared Demo content remain visibly and structurally separate.
- Existing V1 critical flows continue to pass.

Before declaring implementation complete, run the actual repository equivalents of:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Also verify the new limits, partial-extraction acknowledgement, summary confirmation, duplicate-action protection, one-lookahead invariant, stale revalidation, reload behavior, privacy cleanup, Prepared Demo, and leaked-secret checks.

## 10. Explicit non-goals

- Multiple context files, folders, ZIP archives, file merging, source ordering, or conflict-priority management.
- Saved document libraries, vector databases, persistent file search, cloud file storage, or background ingestion.
- Authentication, collaboration, meeting integrations, or cross-device recovery.
- Communicator-authored requirements, recommendations, Readiness, roadmap changes, or Specification revisions.
- Automatic acceptance of an entire uploaded document as confirmed requirements.
- Direct editing of Specification Items.
- Silent fallback from Live AI to prepared data.
- Changes to the settled runtime models or standard-key security boundary merely to support V2.

## 11. Suggested implementation sequence and ownership

Use the existing four-agent team and ownership boundaries from V1. Freeze new shared schemas, reducer events, request contracts, and transport interfaces before parallel edits.

1. **Root integrator:** freeze Project Context Digest, source provenance, Question Roadmap, Lookahead Question, Decision Summary, queue/staleness, and preparation-phase contracts.
2. **`brain-api`:** implement validated digest consumption, roadmap/dependency planning, lookahead approval, source-excerpt budgeting, and stale-reason output.
3. **`realtime-voice`:** implement one-topic clarification exchanges and non-authoritative Decision Summary generation without autonomous Brain calls.
4. **`experience-demo`:** implement intake/preparation/review/progress UI, document limits and failures, queue/stale presentation, and deterministic V2 Prepared Demo fixtures.
5. **Root integrator:** integrate authoritative request ordering, dependency revalidation, duplicate-action protection, Final Review abandonment, checkpoint sanitization, and Live/Demo isolation.
6. **`verification-docs`:** add contract, reducer, integration, browser, accessibility, privacy, and regression verification; update documentation only with work actually completed.

Module owners fix findings in their owned files. The root agent owns cross-module ordering and contract changes. Do not allow concurrent edits to shared contracts.

## 12. Unresolved product decisions

None. Exact internal schemas, extraction libraries, excerpt-selection algorithm, UI copy, and visual layout are implementation choices only when they preserve every requirement and acceptance criterion above.
