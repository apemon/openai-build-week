# Spec Grill

Spec Grill is a solo Product Manager requirements interview room. It turns a vague spoken or typed request into a traceable Specification by asking one consequential decision question at a time.

V1 and V2 are implemented. V2 adds reviewed project context and a latency-resilient, Brain-approved lookahead flow without weakening confirmation, provenance, or Live/Prepared separation. See [V2_IMPLEMENTATION_HANDOFF.md](./V2_IMPLEMENTATION_HANDOFF.md) for the delivered scope and acceptance criteria.

V3 is approved but not yet implemented. It adds bounded Interview Windows of up to three pairwise-independent Question Permits, a persistent truthful Brain activity strip, atomic revalidated Decision Batches, and disabled-by-default local Brain-harness experiments. See [V3_IMPLEMENTATION_HANDOFF.md](./V3_IMPLEMENTATION_HANDOFF.md) for the authoritative implementation plan; current runtime behavior remains V2 until that work is delivered.

The MVP has two deliberately separate modes:

- **Live Mode** sends only Product Manager-confirmed text to an authoritative server-side Brain. Voice is optional and every transcription remains an editable Answer Draft until confirmation.
- **Prepared Demo** runs a deterministic eight-turn team-billing walkthrough from validated local snapshots. It makes no OpenAI, transcription, or microphone call at runtime.

Prepared content is always labeled `Prepared demo • no AI call`; it is never substituted into or merged with a Live Specification.

## Architecture and approval boundary

The browser owns the revisioned Interview Session, reducer transitions, short-lived per-tab checkpoint, and Markdown export. Live voice uses native browser WebRTC behind a typed transport. Server routes mint a temporary Realtime credential and run the stateless Brain.

The runtime model boundary is fixed:

- Brain: `gpt-5.6`, medium reasoning, Responses API Structured Outputs, complete confirmed state, `background: true`, and `store: false`.
- Communicator: `gpt-realtime-2.1` over native WebRTC, with semantic VAD configured with `create_response: false`.
- Transcription: `gpt-4o-transcribe`, producing an editable Answer Draft.

Each Brain attempt creates one background Response, then polls while its provider status is `queued` or `in_progress`. The application timeout defaults to five minutes per attempt and can be configured with `OPENAI_BRAIN_TIMEOUT_MS` from 30,000 through the 300,000 millisecond cap. One automatic repair may create a second attempt, so the route declares a 620-second execution budget; deployment requires a hosting plan that supports that duration. A timeout or aborted request preserves the last valid Specification and triggers best-effort cancellation when a provider response ID is available; cancellation failure does not replace the application timeout result or prove that provider execution stopped.

The application—not either model—owns approval and state mutation. Only `Send to Brain`, `Ctrl/Cmd+Enter`, or explicit deferral/resume actions call `/api/brain`. Responses must pass schema and semantic validation before atomically replacing the Specification. Invalid, stale, refused, incomplete, timed-out, or provider-error results preserve the last valid revision.

Before an interview starts, the Product Manager supplies an Initial Prompt and may add pasted Markdown/plain text or one `.md`, `.txt`, `.pdf`, or `.docx` file. The app validates the agreed size, page, and character limits; prepares an editable source-linked Project Context Digest; exposes known coverage gaps; and requires explicit confirmation. Partial extraction additionally requires acknowledgement. The checkpointable digest retains at most eight verbatim, source-linked context statements of at most 750 characters each; unretained source wording remains only in the active tab’s temporary extraction.

The Brain also maintains the validated Question Roadmap. While a Brain revision is in flight, the Communicator may clarify exactly one previously approved dependency-independent Lookahead Question and create a non-authoritative Decision Summary. Confirmed summary wording remains queued until the authoritative revision applies and dependency revalidation succeeds. Stale wording is preserved visibly as `not applied` and never reaches the Brain or Specification.

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
| `BRAIN_DEBUG_LOGS` | Server-only, content-free Brain submission and provider lifecycle trace | `false` |
| `ALLOWED_ORIGIN` | Exact browser origin accepted by guarded routes | `http://localhost:3000` |

Keep the standard key in `.env.local` or the deployment provider's encrypted server environment. Never add `NEXT_PUBLIC_` credentials. Use a dedicated OpenAI project with conservative spend and rate limits, and enable Live only for controlled presentation windows.

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

1. keyboard-driven V2 Prepared Demo preparation, Lookahead clarification, stale-summary quarantine, 390 px layout, and downloaded Markdown;
2. Project Context Digest confirmation, partial-extraction acknowledgement, source provenance, and reload/privacy cleanup;
3. one typed Live turn that cannot reach the mocked Brain before explicit confirmation or submit twice;
4. one-Lookahead clarification-to-summary behavior, dependency revalidation, and stale-work isolation;
5. receipt, editing, and confirmation of a fake-media transcription;
6. preservation of the last valid Specification after invalid Brain output; and
7. explicit deferral, finalization with follow-ups, stateless resume, and final export.

Axe scans cover Start, context review, Interview, Answer Draft, Lookahead, and Final Review states for critical/serious violations. Unit and integration coverage includes context/file limits, partial extraction, schemas, Brain semantics and route failures, provenance, safe provider-trace allowlisting and sentinel exclusion, Realtime event ordering/session locks, duplicate-action protection, reducer ordering and stale responses, checkpoint sanitization/expiry, visual aids, prepared snapshots, and Markdown export.

Normal CI must not call OpenAI or depend on microphone hardware. Live smoke testing is opt-in and should be run only with the dedicated project explicitly enabled.

## Prepared Demo walkthrough

Choose `Run prepared demo`, prepare the bundled `team-billing-project-brief.md`, review its prevalidated Project Context Digest, and select `Confirm prepared digest`. The first revision starts automatically. The permissions step opens one safe billing-basis Lookahead Question with a prepared clarification exchange and editable Decision Summary; confirmation demonstrates deterministic dependency revalidation and preserves the summary as `not applied`. Continue with the remaining prepared answers through seat changes, failed payment, provider choice, measurable success, and tax. The final state is `ready_with_follow_ups` and keeps Finance registration and retention review visible as Next Actions.

The walkthrough makes no `/api/brain`, `/api/realtime`, `/api/context`, OpenAI, microphone, or user-file request. Browser verification asserts those boundaries directly.

The demo uses the same production schemas and Specification rendering path as Live Mode, but not the Live Brain endpoint. Its locally bundled prompt MP3s were generated from each fixture's exact `spokenQuestion` with `gpt-4o-mini-tts` and `marin`; container, duration, and non-silence checks pass. Regenerate them with a dedicated project key when prompts change:

```bash
OPENAI_API_KEY=<configured-locally> npm run generate:demo-audio
```

Do not put the key in the command history on a shared machine; configure it in `.env.local` instead. Manually listen to all eight generated files before presentation to confirm spoken-word delivery. If approved audio cannot play, the walkthrough continues silently.

## Deploy to Vercel

1. Import this repository as a Next.js project and keep the default build command, `npm run build`.
2. Deploy first with `LIVE_AI_ENABLED=false`, an exact production `ALLOWED_ORIGIN`, and no browser-exposed credentials. Verify the Prepared Demo and Markdown download.
3. In the Vercel project's encrypted server environment, add `OPENAI_API_KEY` from a dedicated capped OpenAI project plus the three model variables shown in `.env.example`.
4. Change `LIVE_AI_ENABLED` to `true` only for a controlled Live window and redeploy. Turn it back to `false` after the window.
5. Verify route responses and the browser bundle do not expose the standard key, SDP, transcripts, Specifications, raw audio, or temporary credentials beyond the one credential response that requires them.

Do not claim Zero Data Retention solely because the Brain uses `store: false`; verify the active OpenAI project's data controls separately. OpenAI's [background mode documentation](https://developers.openai.com/api/docs/guides/background) states that response data is temporarily stored to disk for roughly ten minutes to support asynchronous execution and polling, including background requests that use `store: false`.

## Presentation-device voice checklist

Run this manually in current desktop Chrome on the actual presentation hardware. Record the date/browser/device beside the results; do not infer a pass from fake-media tests.

- [ ] Live starts only after the Product Manager selects `Enable microphone` and grants permission.
- [ ] Permission denial preserves state, explains text fallback, and offers a microphone retry.
- [ ] Prompt playback keeps the microphone track disabled; playback completion enables listening.
- [ ] `Answer now` stops prompt playback and starts listening without submitting anything.
- [ ] Semantic VAD tolerates representative pauses and background noise.
- [ ] The finalized transcription receives focus as an editable Answer Draft.
- [ ] Editing and `Send to Brain` submit the edited text exactly once; recording alone submits nothing.
- [ ] `Record again`, voice mute, microphone resume, reconnect, and Live text fallback work.
- [ ] Realtime capacity/rate-limit failure preserves confirmed state and offers retry or explicit Prepared Demo restart.
- [ ] Echo cancellation prevents speaker playback from becoming a Product Manager turn.
- [ ] Standard API key, raw audio, SDP, transcript text, and Specification content do not appear in application logs.

## Privacy and persistence

Spec Grill does not persist raw audio, original uploads, full extractions, or Interview Session content on its servers. Confirmed revisions and the bounded confirmed digest may be stored temporarily in the current tab's `sessionStorage` and expire after 30 minutes. Original file bytes are discarded after the preparation request; temporary source extraction remains only in the active tab and is lost on reload. Unconfirmed drafts, clarification content, queued/stale summaries, provider events, client secrets, and raw audio are excluded from checkpoints. Explicit exit/reset and expiry clear app-held checkpoint state.

After reload, an interview may continue from the confirmed digest. Deep source lookup requires re-uploading the original file.

Live input is processed by OpenAI under the configured project's data controls. The Brain sets `store: false`, but background-mode response data is still temporarily stored for roughly ten minutes to enable polling; this provider-side temporary storage is separate from Spec Grill's app-held checkpoint behavior. Do not enter confidential or regulated information in this hackathon demo.

## Codex contribution record

The implementation was built as four bounded Codex workstreams coordinated by a root integrator:

- **Root integration:** shared V2 contracts, reducer ordering, duplicate-action guards, dependency revalidation, Final Review abandonment, checkpoint sanitization, Live/Demo isolation, and the application orchestrator.
- **Brain API:** validated digest/excerpt consumption, GPT-5.6 Question Roadmap and Lookahead approval output, provenance, semantic validation, repair retry, request hardening, typed failures, and mocked route coverage.
- **Realtime voice:** native WebRTC one-topic clarification, non-authoritative Decision Summary generation, locked semantic-VAD session, transcription reconciliation, microphone gating, out-of-band prompt speech, and text fallback.
- **Experience/demo:** accessible context intake/review, extraction limits and failures, progress/Lookahead/stale-work UI, bounded digest preparation, deterministic V2 fixtures, Visual Aids, local audio, Final Review, and browser-generated Markdown.
- **Verification/docs:** independent context/reducer/privacy verification, mocked V2 Playwright flows, Prepared network/microphone isolation, fake-media transcript boundary, axe/390 px checks, deployment/manual voice guidance, and the demo storyboard.

The contribution record describes repository work, not runtime model output. Prepared Demo snapshots are fixtures. Automated verification uses mocked provider boundaries; live GPT-5.6, physical microphone, deployment, and provider-retention verification are not claimed here.

## MVP limits

There is no authentication, collaboration, database persistence, meeting integration, payment processing, analytics, arbitrary model-authored markup, multilingual mode, or cross-device history. Voice support targets current desktop Chrome; other browsers and mobile fall back to the first-class text path.

See [IMPLEMENTATION_HANDOFF.md](./IMPLEMENTATION_HANDOFF.md), [V2_IMPLEMENTATION_HANDOFF.md](./V2_IMPLEMENTATION_HANDOFF.md), [V3_IMPLEMENTATION_HANDOFF.md](./V3_IMPLEMENTATION_HANDOFF.md), [CONTEXT.md](./CONTEXT.md), [docs/ownership.md](./docs/ownership.md), and [docs/adr](./docs/adr) for the delivered and approved product language, implementation ownership, and architecture decisions.
