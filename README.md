# Spec Grill

Spec Grill is a solo Product Manager requirements interview room. It turns a vague spoken or typed request into a traceable Specification by asking one consequential decision question at a time.

The MVP has two deliberately separate modes:

- **Live Mode** sends only Product Manager-confirmed text to an authoritative server-side Brain. Voice is optional and every transcription remains an editable Answer Draft until confirmation.
- **Prepared Demo** runs a deterministic eight-turn team-billing walkthrough from validated local snapshots. It makes no OpenAI, transcription, or microphone call at runtime.

Prepared content is always labeled `Prepared demo • no AI call`; it is never substituted into or merged with a Live Specification.

## Architecture and approval boundary

The browser owns the revisioned Interview Session, reducer transitions, short-lived per-tab checkpoint, and Markdown export. Live voice uses native browser WebRTC behind a typed transport. Server routes mint a temporary Realtime credential and run the stateless Brain.

The runtime model boundary is fixed:

- Brain: `gpt-5.6`, medium reasoning, Responses API Structured Outputs, complete confirmed state, and `store: false`.
- Communicator: `gpt-realtime-2.1` over native WebRTC, with semantic VAD configured with `create_response: false`.
- Transcription: `gpt-4o-transcribe`, producing an editable Answer Draft.

The application—not either model—owns approval and state mutation. Only `Send to Brain`, `Ctrl/Cmd+Enter`, or explicit deferral/resume actions call `/api/brain`. Responses must pass schema and semantic validation before atomically replacing the Specification. Invalid, stale, refused, incomplete, timed-out, or provider-error results preserve the last valid revision.

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
| `OPENAI_REALTIME_MODEL` | Realtime Communicator model | `gpt-realtime-2.1` |
| `OPENAI_TRANSCRIPTION_MODEL` | Input transcription model | `gpt-4o-transcribe` |
| `LIVE_AI_ENABLED` | Server-side Live kill switch | `false` |
| `BRAIN_DEBUG_LOGS` | Emit content-free Brain submission metadata to server logs | `false` |
| `ALLOWED_ORIGIN` | Exact browser origin accepted by guarded routes | `http://localhost:3000` |

Keep the standard key in `.env.local` or the deployment provider's encrypted server environment. Never add `NEXT_PUBLIC_` credentials. Use a dedicated OpenAI project with conservative spend and rate limits, and enable Live only for controlled presentation windows.

Set `BRAIN_DEBUG_LOGS=true` locally to trace valid Brain submissions in the server terminal. Each request logs `submitted` and then `succeeded` or `failed`, with request metadata and elapsed time only. Answer text, prompts, transcripts, Specifications, credentials, and provider payloads are never logged.

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

1. keyboard-driven Prepared Demo completion, 390 px layout, and downloaded Markdown;
2. one typed Live turn that cannot reach the mocked Brain before explicit confirmation;
3. receipt, editing, and confirmation of a fake-media transcription;
4. preservation of the last valid Specification after invalid Brain output; and
5. explicit deferral, finalization with follow-ups, stateless resume, and final export.

Axe scans cover Start, Interview, Answer Draft, and Final Review states for critical/serious violations. Unit and integration coverage includes schemas, Brain semantics and route failures, Realtime event ordering/session locks, reducer stale-response behavior, checkpoint sanitization/expiry, visual aids, prepared snapshots, and Markdown export.

Normal CI must not call OpenAI or depend on microphone hardware. Live smoke testing is opt-in and should be run only with the dedicated project explicitly enabled.

## Prepared Demo walkthrough

Choose `Run prepared demo`, then activate `Use prepared answer` for the eight prepared turns. The scenario covers the initial team-billing request followed by permissions, billing basis, seat changes, failed payment, provider choice, measurable success, and tax. The final state is `ready_with_follow_ups` and keeps Finance registration and retention review visible as Next Actions.

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

Do not claim Zero Data Retention solely because the Brain uses `store: false`; verify the active OpenAI project's data controls separately.

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

Spec Grill does not persist raw audio or Interview Session content on its servers. Confirmed revisions may be stored temporarily in the current tab's `sessionStorage` and expire after 30 minutes. Unconfirmed drafts, provider events, client secrets, and raw audio are excluded. Explicit exit/reset and expiry clear app-held checkpoint state.

Live input is processed by OpenAI under the configured project's data controls. Do not enter confidential or regulated information in this hackathon demo.

## Codex contribution record

The implementation was built as four bounded Codex workstreams coordinated by a root integrator:

- **Root integration:** project scaffold, shared Zod contracts, reducer/events/invariants, environment guards, checkpointing, and the application orchestrator.
- **Brain API:** GPT-5.6 prompt and Responses API integration, Structured Outputs, semantic validation, repair retry, request hardening, typed failures, and mocked route coverage.
- **Realtime voice:** native WebRTC adapter, locked semantic-VAD session, transcription event reconciliation, microphone gating, out-of-band prompt speech, credential route, and transport tests.
- **Experience/demo:** responsive three-state UI, review/finalization flows, Visual Aid renderers, deterministic team-billing snapshots, local audio integration/generation tooling, Next Actions, and browser-generated Markdown.
- **Verification/docs:** independent reducer/checkpoint verification, five mocked Playwright critical flows, fake-media transcript boundary, axe/390 px checks, deployment/manual voice guidance, and the demo storyboard.

The contribution record describes repository work, not runtime model output. Prepared Demo snapshots are fixtures, and no live GPT-5.6 result is represented as having been produced during implementation verification.

## MVP limits

There is no authentication, collaboration, database persistence, meeting integration, payment processing, analytics, arbitrary model-authored markup, multilingual mode, or cross-device history. Voice support targets current desktop Chrome; other browsers and mobile fall back to the first-class text path.

See [IMPLEMENTATION_HANDOFF.md](./IMPLEMENTATION_HANDOFF.md), [CONTEXT.md](./CONTEXT.md), and [docs/adr](./docs/adr) for the settled product language and architecture decisions.
