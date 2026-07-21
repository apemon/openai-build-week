# Spec Grill

Spec Grill is a solo Product Manager requirements interview room. It turns a vague spoken or typed request into a traceable Specification by asking one consequential decision question at a time.

V1, V2, and the approved V3 extension are implemented. V3 adds Brain-issued Interview Windows of up to three pairwise-independent Question Permits while keeping exactly one active question, Persistent Brain Status from content-free lifecycle events, revision-first revalidation, atomic Decision Batches, bounded confirmed-queue recovery, and disabled-by-default experimental Brain harnesses. See [V3_IMPLEMENTATION_HANDOFF.md](./V3_IMPLEMENTATION_HANDOFF.md) for the settled scope and acceptance criteria.

The approved V3.1 extension replaces direct transcription-to-draft behavior with bounded Answer Intake. Every Brain-authored Interview Prompt defines one to five Answer Aspects; the Communicator assesses only those aspects from at most three temporary Product Manager contributions, may ask at most two scoped clarifications, and produces an editable Answer Summary. Only the exact Product Manager-edited and explicitly confirmed summary reaches the Brain. See [V3_1_IMPLEMENTATION_HANDOFF.md](./V3_1_IMPLEMENTATION_HANDOFF.md).

ADR-0011 adds an opt-in local hackathon Live path that runs the authoritative Brain through the server-side Codex SDK and resumes one locally persisted Codex thread. This is a deliberate exception to the default stateless Brain; it is not a production, hosted-persistence, authenticated-sharing, or privacy-retention design.

The MVP has two deliberately separate modes:

- **Live Mode** sends only Product Manager-confirmed text to an authoritative server-side Brain. Voice is optional; finalized transcription remains temporary Answer Intake until coverage assessment or truthful fallback produces an editable Answer Summary for confirmation.
- **Prepared Demo** runs a deterministic eight-turn team-billing walkthrough from validated local snapshots. It makes no OpenAI, transcription, or microphone call at runtime.

Prepared content is always labeled `Prepared demo • no AI call`; it is never substituted into or merged with a Live Specification.

## Architecture and approval boundary

The browser owns the revisioned Interview Session, reducer transitions, short-lived per-tab checkpoint, and Markdown export. Live voice uses native browser WebRTC behind a typed transport. Server routes mint a temporary Realtime credential and run either the default stateless Brain or the explicitly enabled local hackathon Codex adapter.

The runtime model boundary is fixed:

- Default Brain (`one_shot`): `gpt-5.6`, medium reasoning, Responses API Structured Outputs, complete confirmed state, `background: true`, and `store: false`.
- Local hackathon Brain (`codex_sdk_persistent`): server-side Codex SDK, default model `gpt-5.6-sol`, complete confirmed state, validated structured output, one bounded repair, and one locally persisted thread. It does not make a `store:false` claim.
- Communicator: `gpt-realtime-2.1` over native WebRTC, with semantic VAD configured with `create_response: false`.
- Transcription: `gpt-4o-transcribe`, producing one identity-bound temporary Answer Intake contribution rather than an immediate draft.

In `one_shot`, each Brain attempt creates one background Response, then polls while its provider status is `queued` or `in_progress`. The application timeout defaults to five minutes per attempt and can be configured with `OPENAI_BRAIN_TIMEOUT_MS` from 30,000 through the 300,000 millisecond cap. One automatic repair may create a second attempt, so the route declares a 620-second execution budget; deployment requires a hosting plan that supports that duration. A timeout or aborted request preserves the last valid Specification and triggers best-effort cancellation when a provider response ID is available; cancellation failure does not replace the application timeout result or prove that provider execution stopped.

In `codex_sdk_persistent`, the same `/api/brain` validation and NDJSON boundary applies. Codex runs in an empty temporary working directory with read-only filesystem access, network and public search disabled, no approvals, and an isolated environment. The temporary working directory is removed after each turn. The configured `CODEX_BRAIN_HOME` intentionally remains so the local SDK can resume the thread; interrupted, failed, timed-out, or terminally invalid threads are quarantined for the life of the server process.

The application—not either model—owns approval and state mutation. Direct answers, corrections, and deferrals require explicit Product Manager confirmation. V3 may automatically submit only an exact locked Decision Batch whose one to three entries were individually confirmed and freshly Brain-revalidated. Responses must pass schema and semantic validation before atomically replacing the Specification. Invalid, stale, refused, incomplete, timed-out, interrupted, or provider-error results preserve the last valid revision.

For the current authoritative prompt, the Brain also authors one to five unique Answer Aspects, including at least one required aspect. The Communicator may classify only those IDs as covered, missing, or uncertain from the current bounded Answer Intake. Coverage must contain each active aspect exactly once. Realtime assessment and clarification playback are identity-bound, out-of-band responses with `conversation: "none"`; they cannot change the Specification or call the Brain. A finalized transcript alone creates no Answer Draft. Assessment completion, early review, or the three-contribution/two-clarification bound produces either a validated Communicator Answer Summary or a clearly labeled unassessed fallback. The Product Manager may edit it, and only `Send confirmed summary to Brain` creates one Confirmed Answer from that exact edited text.

Before an interview starts, the Product Manager supplies an Initial Prompt and may add pasted Markdown/plain text or one `.md`, `.txt`, `.pdf`, or `.docx` file. The app validates the agreed size, page, and character limits; prepares an editable source-linked Project Context Digest; exposes known coverage gaps; and requires explicit confirmation. Partial extraction additionally requires acknowledgement. The checkpointable digest retains at most eight verbatim, source-linked context statements of at most 750 characters each; unretained source wording remains only in the active tab’s temporary extraction.

The Brain also maintains the validated Question Roadmap and may issue zero to three pairwise-independent Question Permits. The Communicator presents and clarifies only one permit at a time and creates an editable, non-authoritative Decision Summary. While the exact authoritative request remains active, confirming or deferring one asynchronous job may promote the next unused ordinal from the same current window; it never creates a second Brain request or presents two questions at once. Confirmed wording waits in the Decision Tray. When the result arrives, the application consults current runtime jobs—including a job promoted after request start—stops or pauses its exchange, applies the complete authoritative revision first, then reissues or dependency-invalidates every prior permit. Only valid confirmed work enters one ordered atomic Decision Batch. Stale wording remains visibly Not Applied and never enters the Specification.

`POST /api/brain` returns validated NDJSON. Content-free lifecycle envelopes are bound to request, action, base revision, cancellation epoch, attempt, and monotonic sequence; they contain no prompt, answer, transcript, Specification, provider ID, credential, or raw error text. One terminal result or error closes the stream. Malformed, content-bearing, mismatched, duplicate, late, or interrupted streams fail closed and require explicit retry.

## Local setup

Prerequisites: a current Node.js release supported by Next.js 16 (Node 20.9 or newer), npm, and current desktop Chrome for the primary voice path.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With the example configuration, Live Mode is visibly disabled and Prepared Demo remains available.

### Environment

| Variable | Purpose | Safe default |
|---|---|---|
| `OPENAI_API_KEY` | Server-only standard project key used by Brain and temporary Realtime credential routes | Empty |
| `OPENAI_BRAIN_MODEL` | Server-only Brain model override | `gpt-5.6` |
| `OPENAI_BRAIN_TIMEOUT_MS` | Server-only timeout for each background Brain attempt, constrained to 30,000–300,000 milliseconds | `300000` |
| `OPENAI_REALTIME_MODEL` | Realtime Communicator model | `gpt-realtime-2.1` |
| `OPENAI_TRANSCRIPTION_MODEL` | Input transcription model | `gpt-4o-transcribe` |
| `LIVE_AI_ENABLED` | Server-side Live kill switch | `false` |
| `OPENAI_BRAIN_HARNESS` | Server-only Brain adapter selector | `one_shot` |
| `BRAIN_EXPERIMENTAL_HARNESSES_ENABLED` | Enables local experimental adapters; never a public UI control | `false` |
| `BRAIN_PUBLIC_SEARCH_ENABLED` | Separately authorizes the local controlled-search experiment | `false` |
| `OPENAI_CODEX_BRAIN_MODEL` | Server-only model for the local persistent Codex adapter | `gpt-5.6-sol` |
| `CODEX_BRAIN_HOME` | Local Codex session-store directory; intentionally retained between dev-server restarts | `.spec-grill-codex` |
| `BRAIN_DEBUG_LOGS` | Server-only, content-free Brain submission and provider lifecycle trace | `false` |
| `ALLOWED_ORIGIN` | Exact browser origin accepted by guarded routes | `http://localhost:3000` |

Keep the standard key in `.env.local` or the deployment provider's encrypted server environment. Never add `NEXT_PUBLIC_` credentials. Use a dedicated OpenAI project with conservative spend and rate limits, and enable Live only for controlled presentation windows.

### Local hackathon Codex Brain

This mode is intended only for a local hackathon demonstration. In `.env.local`, set the following values without putting the key in source control or a shell command:

```dotenv
OPENAI_API_KEY=<configured locally>
LIVE_AI_ENABLED=true
OPENAI_BRAIN_HARNESS=codex_sdk_persistent
BRAIN_EXPERIMENTAL_HARNESSES_ENABLED=true
BRAIN_PUBLIC_SEARCH_ENABLED=false
OPENAI_CODEX_BRAIN_MODEL=gpt-5.6-sol
CODEX_BRAIN_HOME=.spec-grill-codex
```

Then start the existing application boundary. The dedicated script supplies the three non-secret Codex adapter flags, so they may either be present in `.env.local` as shown above or supplied by the script:

```bash
npm install
npm run dev:codex
```

No database, KV store, account system, daemon, or additional service is required. After the first validated Live revision, the UI shows a Session Link containing the opaque thread identifier. That link works only on the same machine while the local Codex session store exists and the same browser tab has the matching unexpired checkpoint. Possession of the link is enough to identify that local thread: there is no authentication or authorization layer. It does not provide sharing, cross-browser, cross-device, cross-instance, serverless, or deployment resume.

Prepared Demo remains independent while this flag is enabled: it does not call `/api/brain`, Codex, OpenAI, or the local session store, and it never receives or resumes a Codex thread.

For an opt-in route smoke against the running dev server, use a second terminal:

```bash
RUN_LIVE_AI_SMOKE=true npm run smoke:live:brain
```

The smoke submits a synthetic revision and then resumes the returned thread for a second validated request. It prints only content-free metadata: whether validation and thread resume succeeded, model labels, revision, repair status, whether a next prompt exists, and lifecycle count. It does not print the API key, Codex thread ID, prompt, transcript, or Specification. It consumes real model requests and does not prove provider deletion, retention behavior, or production readiness.

To end an app session, use the app's exit/reset control to clear the tab checkpoint and Session Link. To remove local Codex resume state, stop the dev server and delete the exact directory configured by `CODEX_BRAIN_HOME` (the default is `.spec-grill-codex/`). This local cleanup is not a provider thread-deletion guarantee. Never point `CODEX_BRAIN_HOME` at the repository root, home directory, filesystem root, or any directory containing unrelated data.

Set `BRAIN_DEBUG_LOGS=true` only in the server environment during controlled troubleshooting. In addition to content-free submission lifecycle records, it emits a safe provider trace prefixed `[spec-grill:brain:provider]`. The trace follows the official [Responses background lifecycle](https://developers.openai.com/api/docs/guides/background): `create`, `retrieve` polling, best-effort `cancel`, plus local `validate`. Records identify request/response/error direction, attempt 1 or 2, nonnegative sequence, and only the relevant status, model, background/store/reasoning/schema configuration, timing, item counts, token-usage totals, application error code, or whether a provider response ID was available.

The trace uses a strict metadata allowlist. It never serializes raw requests or responses, input/body/content, output or parsed output, provider response IDs, exception messages, validation text, prompts, answer text, transcripts, Specifications, credentials, or temporary client secrets. Keep `BRAIN_DEBUG_LOGS=false` outside a short diagnostic window; it is server-only and must never be renamed with a `NEXT_PUBLIC_` prefix. On hosted deployments these records enter the hosting platform's server-log system, so restrict log access and retention even though the records are content-free.

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npx playwright install chromium # once per machine
npm run test:e2e
npm run build
```

The normal test suite uses mocked provider boundaries and requires neither an OpenAI key nor physical audio. The intentionally small Playwright suite verifies:

1. keyboard-driven V3.1 Prepared Answer Intake, two sequential permitted decisions, revision-first revalidation, one Applied/one Not Applied outcome, 390 px layout, and downloaded Markdown;
2. Project Context Digest confirmation, partial-extraction acknowledgement, source provenance, and reload/privacy cleanup;
3. one typed Live turn that cannot reach the mocked Brain before explicit confirmation or submit twice;
4. one-Lookahead clarification-to-summary behavior, dependency revalidation, and stale-work isolation;
5. fake-media transcription that remains temporary until exact Answer Aspect coverage produces an editable Communicator summary, followed by exact edited-summary confirmation;
6. preservation of the last valid Specification after invalid Brain output; and
7. explicit deferral, finalization with follow-ups, reload recovery, and final export;
8. Persistent Brain Status and Decision Tray behavior across the prepared async sequence; and
9. reload recovery that makes no automatic request and requires separate `Revalidate restored decisions` and `Submit restored decisions` actions.

Axe scans cover Start, context review, Answer Intake, Answer Summary, permitted-question/Decision Tray, Persistent Brain Status, and Final Review states for critical/serious violations. Unit and integration coverage includes exact Answer Aspect membership, finalized-transcript gating, early-review/late-assessment safety, raw-intake privacy sentinels, sequential permit promotion/current-job revision barriers, lifecycle split/coalesced parsing, batch ordering/atomicity, checkpoint sanitization/migration, adaptive caps, Realtime identity races, 24 synthetic evaluation fixtures, safe harness defaults, V1–V3 regressions, visual aids, prepared snapshots, and Markdown export.

Normal CI must not call OpenAI or depend on microphone hardware. Live smoke testing is opt-in and should be run only with the dedicated project explicitly enabled.

## Prepared Demo walkthrough

Choose `Run prepared demo`, prepare the bundled `team-billing-project-brief.md`, review its prevalidated Project Context Digest, and select `Confirm prepared digest`. The V3.1 frame shows multiple Brain-authored Answer Aspects, one missing aspect, one prepared clarification, and an editable Answer Summary; confirm that summary to start the user-paced fixture clock. The demo then opens a two-permit Interview Window, presents each permitted decision sequentially, shows its clarification exchange and editable Decision Summary, and requires individual confirmation. It advances beyond 30 fixture seconds without a real wait, applies the authoritative revision first, revalidates both jobs, keeps one Ready to Apply, marks the other dependency-invalidated Not Applied with `Reuse wording`, automatically applies the one-entry prepared Decision Batch, and enters Final Review.

The walkthrough makes no `/api/brain`, `/api/realtime`, `/api/context`, OpenAI, Codex, public-search, microphone, or user-file request. Browser verification asserts those boundaries directly.

The demo uses the same production schemas and Specification rendering path as Live Mode, but not the Live Brain endpoint. Its locally bundled prompt MP3s were generated from each fixture's exact `spokenQuestion` with `gpt-4o-mini-tts` and `marin`; container, duration, and non-silence checks pass. Regenerate them with a dedicated project key when prompts change:

```bash
OPENAI_API_KEY=<configured-locally> npm run generate:demo-audio
```

Do not put the key in the command history on a shared machine; configure it in `.env.local` instead. Manually listen to all eight generated files before presentation to confirm spoken-word delivery. If approved audio cannot play, the walkthrough continues silently.

## Experimental Brain evaluation

The safe/default Live adapter is `one_shot`. `responses_native` and `codex_ephemeral` require the server-only experimental flag and run only through the local evaluation surface with explicitly experimental provenance; the ordinary Live route rejects both. The separate `codex_sdk_persistent` hackathon exception may run through the ordinary Live route only when `BRAIN_EXPERIMENTAL_HARNESSES_ENABLED=true`. Both Codex adapters use a fresh empty temporary working directory, read-only execution, a strict environment allowlist, no repository or project instructions, and validated structured output; only the persistent adapter retains its isolated Codex session store. Public search remains disabled because the current runner cannot enforce the required five-query/five-source caps; the implementation rejects enabling it instead of weakening isolation.

The frozen bake-off contains 24 synthetic, non-sensitive sessions and reproducible rubric/gate code. Generated candidate output belongs only in the gitignored `.brain-evaluation-artifacts/` directory. No live bake-off, human scoring, adapter promotion, or provider-retention conclusion is included in the automated delivery.

## Deploy to Vercel

1. Import this repository as a Next.js project and keep the default build command, `npm run build`.
2. Deploy first with `LIVE_AI_ENABLED=false`, an exact production `ALLOWED_ORIGIN`, and no browser-exposed credentials. Verify the Prepared Demo and Markdown download.
3. In the Vercel project's encrypted server environment, add `OPENAI_API_KEY` from a dedicated capped OpenAI project plus the three model variables shown in `.env.example`.
4. Change `LIVE_AI_ENABLED` to `true` only for a controlled Live window and redeploy. Turn it back to `false` after the window.
5. Verify route responses and the browser bundle do not expose the standard key, SDP, transcripts, Specifications, raw audio, or temporary credentials beyond the one credential response that requires them.

The `codex_sdk_persistent` path is local-hackathon-only and is not covered by these Vercel deployment steps. Keep `OPENAI_BRAIN_HARNESS=one_shot` and `BRAIN_EXPERIMENTAL_HARNESSES_ENABLED=false` for this deployment recipe; no cross-instance persistence or production-readiness claim is made for local Codex threads.

For the default `one_shot` deployment, do not claim Zero Data Retention solely because the Brain uses `store: false`; verify the active OpenAI project's data controls separately. OpenAI's [background mode documentation](https://developers.openai.com/api/docs/guides/background) states that response data is temporarily stored to disk for roughly ten minutes to support asynchronous execution and polling, including background requests that use `store: false`.

## Presentation-device voice checklist

Run this manually in current desktop Chrome on the actual presentation hardware. Record the date/browser/device beside the results; do not infer a pass from fake-media tests.

- [ ] Live starts only after the Product Manager selects `Enable microphone` and grants permission.
- [ ] Permission denial preserves state, explains text fallback, and offers a microphone retry.
- [ ] Prompt playback keeps the microphone track disabled; playback completion enables listening.
- [ ] `Answer now` stops prompt playback and starts listening without submitting anything.
- [ ] Semantic VAD tolerates representative pauses and background noise.
- [ ] A finalized transcription starts `Assessing answer coverage` and does not immediately create an Answer Draft or Brain request.
- [ ] Coverage shows every Brain-authored Answer Aspect exactly once and never adds a new aspect.
- [ ] A clarification is spoken only for a missing or uncertain aspect; no more than two clarifications or three contributions are accepted.
- [ ] `Review answer now` preserves captured wording truthfully; a late assessment cannot replace an already reviewable draft.
- [ ] The editable Answer Summary receives focus and keeps missing/uncertain aspects visible.
- [ ] Editing and `Send confirmed summary to Brain` submit that exact edited summary once; recording, transcription, assessment, and playback submit nothing.
- [ ] `Record again`, return to clarification, voice mute, microphone resume, reconnect, and truthful `Coverage not assessed` fallback work.
- [ ] If a validated revision arrives during accepted speech, assessment, playback, or editing, preserved wording is visibly Revalidation Pending and cannot be confirmed against stale scope.
- [ ] Realtime capacity/rate-limit failure preserves confirmed state and offers retry or explicit Prepared Demo restart.
- [ ] Echo cancellation prevents speaker playback from becoming a Product Manager turn.
- [ ] Standard API key, raw audio, SDP, transcript text, and Specification content do not appear in application logs.

## Privacy and persistence

In default `one_shot` mode, Spec Grill does not persist raw audio, original uploads, full extractions, or Interview Session content on its servers. Confirmed revisions, the bounded confirmed digest, and at most three individually confirmed queued Decision Summaries/deferrals may be stored temporarily in the current tab's `sessionStorage` and expire after 30 minutes. Original file bytes are discarded after preparation; temporary source extraction remains only in the active tab and is lost on reload. Raw Answer Intake, transcript segments, assessment prompts/JSON, Answer Drafts, Answer Summaries before confirmation, Answer Intake clarifications, Decision Summary clarification turns, lifecycle/provider state, Not Applied history, client secrets, raw audio, and search content are excluded from checkpoints and export. Raw intake and intermediate assessment/clarification content are also excluded from Brain requests and application logs. Restored decisions never auto-submit: revalidation and submission are two explicit actions. Explicit exit/reset and expiry clear app-held checkpoint state.

The local `codex_sdk_persistent` hackathon path is an explicit exception: the isolated `CODEX_BRAIN_HOME` retains the Codex thread needed for same-machine resume, while the browser checkpoint stores its opaque thread ID. Do not treat the Session Link as a secret-sharing or authentication mechanism. The app makes no `store:false`, Zero Data Retention, provider-cancellation, provider thread-deletion, cross-instance durability, or production privacy claim for this mode. Deleting the local store only removes local resume state.

After reload, an interview may continue from the confirmed digest. Deep source lookup requires re-uploading the original file.

Live input is processed by OpenAI under the configured project's data controls. In `one_shot`, the Brain sets `store: false`, but background-mode response data is still temporarily stored for roughly ten minutes to enable polling; this provider-side temporary storage is separate from Spec Grill's app-held checkpoint behavior. The persistent Codex path makes neither that storage claim nor a provider-retention claim. Do not enter confidential or regulated information in this hackathon demo.

## Codex contribution record

The implementation was built as four bounded Codex workstreams coordinated by a root integrator:

- **Root integration:** frozen V3/V3.1 contracts, single-request/revision ordering, sequential permit promotion, current-job revision barriers, queue and batch orchestration, adaptive caps, explicit reload gates, checkpoint sanitization, and Live/Prepared isolation.
- **Brain API:** streamed content-free lifecycle delivery, Brain-authored Answer Aspect validation, Interview Window and exact disposition validation, GPT-5.6 one-shot and responses-native adapters, local Codex evaluation isolation, the opt-in persistent Codex SDK hackathon adapter, evaluation fixtures/gates, repair, and typed failures.
- **Realtime voice:** exchange/permit/cancellation identity, bounded Answer Intake assessment and clarification playback, exact coverage validation, raw-intake cleanup, bounded provider-event deduplication, mid-turn revalidation safety, microphone gating, and text fallback.
- **Experience/demo:** Answer Intake and editable Answer Summary presentation, Persistent Brain Status, Decision Tray, one-active-question presentation, local-only Session Link presentation, External Evidence rendering/export, V3.1 Prepared fixtures, Visual Aids, local audio, Final Review, and browser-generated Markdown.
- **Verification/docs:** independent Answer Intake authority/privacy, sequential-promotion barrier, NDJSON privacy, batch atomicity, checkpoint/reload, safe and experimental harness defaults, persistent-thread limitation documentation, axe/390 px, Prepared isolation, V1–V3 regression, and browser verification plus this documentation.

The contribution record describes repository work, not Prepared fixture output. Automated verification uses mocked provider boundaries. On 2026-07-21, the opt-in local smoke validated a live requested `gpt-5.6` / actual `gpt-5.6-sol` revision through the V3 NDJSON route, and the live Realtime session endpoint returned 200 while its secret-bearing body was discarded. The Product Manager reported that V3.1 Chrome microphone capture works, then encountered coverage-assessment formatting failure. A content-free live diagnostic reproduced one schema-valid assessment object wrapped in model prose; the transport now extracts only one object, revalidates its strict schema and exact aspect membership, and performs one bounded repair before truthful fallback. Advanced voice/media races, deployment, and provider-retention verification are not claimed here.

## MVP limits

There is no authentication, collaboration, database persistence, meeting integration, payment processing, analytics, arbitrary model-authored markup, multilingual mode, or cross-device history. The hackathon Session Link is a local resume pointer, not authenticated collaboration or durable history. Voice support targets current desktop Chrome; other browsers and mobile fall back to the first-class text path.

Authoritative read order: [IMPLEMENTATION_HANDOFF.md](./IMPLEMENTATION_HANDOFF.md), [V2_IMPLEMENTATION_HANDOFF.md](./V2_IMPLEMENTATION_HANDOFF.md), [V3_IMPLEMENTATION_HANDOFF.md](./V3_IMPLEMENTATION_HANDOFF.md), [V3_1_IMPLEMENTATION_HANDOFF.md](./V3_1_IMPLEMENTATION_HANDOFF.md), [CONTEXT.md](./CONTEXT.md), every record in [docs/adr](./docs/adr), this README, [CHANGELOG.md](./CHANGELOG.md), and [docs/ownership.md](./docs/ownership.md).
