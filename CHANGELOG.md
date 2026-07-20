# Changelog

## V3 approved plan — not yet implemented

- Approved Bounded Async Interview Windows containing zero to three pairwise-independent Brain-issued Question Permits while preserving exactly one active visible/spoken question and one authoritative Brain request.
- Approved revision-first revalidation, automatic atomic Decision Batches, adaptive window shrinking/re-expansion, truthful Not Applied outcomes, correction priority, pause/deferral/undo behavior, and mid-turn speech/edit preservation.
- Approved Persistent Brain Status with content-free streamed lifecycle events, immediate activity feedback, a 30-second taking-longer threshold, a 10-second unverifiable-activity threshold, explicit retry after stream interruption, reduced-motion behavior, and non-chatty announcements.
- Approved a bounded checkpoint expansion for at most three individually confirmed queued entries; reload always requires fresh dependency revalidation and never auto-submits.
- Approved disabled-by-default `one_shot`, `responses_native`, and local `codex_ephemeral` Brain harness modes plus a separately controlled public-search experiment, visible External Evidence, and reproducible frozen evaluation gates.
- Approved a deterministic V3 Prepared Demo with a user-paced fixture clock, two permits, one valid asynchronous result, one dependency-invalidated Not Applied result, atomic batch application, and no OpenAI/Codex/search/microphone/network dependency.

The complete settled requirements and implementation sequence are in `V3_IMPLEMENTATION_HANDOFF.md`. None of the V3 behavior above is claimed as delivered yet.

## V2 delivered extension

- Added reviewed Project Context Digest intake from Markdown/plain text or one `.md`, `.txt`, `.pdf`, or `.docx` file, with the approved size/page/character limits and actionable invalid, empty, encrypted, corrupt, and over-limit failures.
- Only PM-confirmed digest statements become Confirmed Input. Statements retain source provenance, checkpointable source wording is bounded, extraction gaps stay visible, and partial extraction requires explicit acknowledgement.
- The Brain now maintains a validated prioritized Question Roadmap with dependencies and approves no more than one independent Lookahead Question during an in-flight Brain revision.
- The Communicator can clarify that one decision through voice or text and produce an editable, non-authoritative Decision Summary without autonomous Brain submission.
- PM-confirmed Decision Summaries queue until the authoritative revision applies and dependency revalidation succeeds; stale work is retained as `not applied` and cannot mutate the Specification.
- Added truthful processing stages, immediate duplicate-safe confirmation feedback, and explicit abandonment before Final Review with pending work.
- Original uploads, full extractions, durable provider file objects, multiple-file workflows, databases, and persistent document search remain out of scope and out of checkpoints.
- Extended Prepared Demo to prove context preparation, Lookahead clarification, summary confirmation, progress, and staleness without OpenAI, microphone, network, or user-file dependencies.
- Moved Live Brain work to background Responses with `store: false`, terminal-state polling, a configurable 300-second per-attempt default timeout capped at 300 seconds, and best-effort provider cancellation after timeout or abort. One automatic repair can require a second attempt, so the route declares a 620-second budget that the hosting plan must support. Background polling temporarily stores provider response data for roughly ten minutes even with `store: false`; no live API, deployment-duration, or provider-retention verification is claimed.
- Expanded opt-in, server-only `BRAIN_DEBUG_LOGS` with a content-free provider lifecycle trace for Responses create/retrieve/cancel and local validation. A strict metadata allowlist excludes raw requests/responses, provider IDs, content, parsed output, error/validation wording, Specifications, transcripts, and credentials; deterministic contract tests use leaked-content sentinels rather than live provider calls.
- Added independent contract, reducer, route, accessibility, privacy, reload, provenance, Live/Demo isolation, leaked-secret, and Playwright regression verification. Automated checks use mocks and fake media; live API, physical microphone, deployment, and provider-retention verification remain manual and unverified in this delivery.

The complete approved handoff and acceptance criteria are in `V2_IMPLEMENTATION_HANDOFF.md`.

## V2 feedback and future exploration

- Observed Brain latency still leaves users waiting, and the current progress feedback needs a visible loader or clearer active status so users can distinguish running work from a hung or failed request.
- **Future exploration — asynchronous interview:** investigate whether the Communicator could keep a bounded conversation moving through multiple questions while Brain work runs. This is not delivered V2 behavior: V2 still permits exactly one Brain-approved, dependency-independent Lookahead Question and preserves explicit confirmation, dependency revalidation, and Brain-only Specification authority.
- **Future exploration — Codex harness:** observed Brain output quality was weaker than Codex output, so a Codex harness layer should be evaluated for the next version. No Codex runtime or harness is part of delivered V2.

## V1 delivered features and workflow

### Features

- A solo Product Manager can turn a vague request into a structured, implementation-ready Specification in one browser session.
- Live Mode accepts typed answers or microphone input and uses real OpenAI services for transcription, spoken prompts, and Brain analysis.
- Voice transcripts remain editable Answer Drafts until the Product Manager explicitly sends them to the Brain.
- The Communicator presents exactly one high-value question at a time in a concise spoken form and a more detailed written form, with a Visual Aid when useful.
- The Brain updates the Problem Statement, users and jobs-to-be-done, functional and non-functional requirements, assumptions, open questions, blockers, risks, edge cases, acceptance criteria, and Next Actions.
- A deterministic eight-turn team-billing demo follows the same validated Specification-rendering path without requiring a microphone, network connection, or OpenAI call.
- Live AI and Prepared Demo output are clearly labeled and never combined.
- Sessions can be finalized with unresolved items preserved as Open Questions or Blockers, each paired with a recommended Next Action.
- The completed Specification can be downloaded as a Markdown file.
- Confirmed session state can recover from a page reload in the same browser tab for up to 30 minutes; there is no database or cross-device persistence.

### Workflow

1. The Product Manager chooses Live Mode or the Prepared Demo.
2. They provide an initial product request by typing or speaking.
3. Spoken input is transcribed into an editable Answer Draft; typed input follows the same confirmation boundary.
4. The Product Manager reviews and corrects the draft, then explicitly sends it to the Brain.
5. The Brain validates and incorporates the confirmed answer into the evolving Specification, then selects the single most valuable unresolved question.
6. The Communicator displays the detailed question and speaks a concise version; the Product Manager answers, confirms, or defers it.
7. The interview repeats until the Specification is ready or the Product Manager chooses to end the session.
8. Final Review shows the completed Specification, unresolved follow-up work, and Next Actions before Markdown export.

## V1 feedback

- Brain analysis has noticeable latency, leaving users waiting too long without meaningful progress feedback.
- Some buttons do not provide immediate visual or state feedback after being pressed, which can cause users to click them more than once.
- The initial-input flow should support richer ways to provide context, such as pasting Markdown or uploading a source document.

## Codex session references

- Grilling session V1 — 019f7a40-601f-7c33-925c-c6fd605d3e50
- Implementation V1 — 019f7b62-bd98-7293-aa20-a348a8e4fbfd
- Grilling session V2 — 019f7f47-6e90-7563-a71d-5ba16b1b550c
- Implementation V2 — 019f7f6d-378f-7ff2-8dda-6825ca94114e
