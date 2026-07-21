# Spec Grill V3 manual verification

Automated tests use mocked provider boundaries, fake media, deterministic Prepared fixtures, and synthetic evaluation sessions. Record a date, browser/version, device, environment, and evidence link for every manual pass. Do not infer a pass from automation.

## Presentation-device voice

- [ ] Live starts only after explicit microphone enablement and browser permission.
- [ ] Prompt playback disables capture; playback completion enables listening.
- [ ] `Answer now` stops playback and starts listening without Brain submission.
- [ ] Semantic VAD tolerates representative pauses and background noise.
- [ ] Final transcription becomes an editable Answer Draft and recording alone sends nothing.
- [ ] Mid-speech revision preserves local transcription behind Revalidation Pending.
- [ ] Changed/stale permits disable confirmation and preserve copyable Not Applied wording.
- [ ] Pause/resume, reconnect, record again, mute, and Live text fallback preserve confirmed state.
- [ ] Echo cancellation prevents prompt audio becoming a Product Manager turn.
- [ ] Logs contain no raw audio, SDP, transcripts, summaries, Specifications, provider IDs, or credentials.

## Live GPT-5.6 and streaming

- [x] Dedicated capped OpenAI project configured server-side; Live explicitly enabled for the 2026-07-21 local smoke.
- [x] Ordinary Live used `one_shot`, requested `gpt-5.6`, actual `gpt-5.6-sol`, medium reasoning, Structured Outputs, `background: true`, and `store: false` in the 2026-07-21 local smoke.
- [ ] No input reaches `/api/brain` before the required Product Manager confirmation.
- [ ] Persistent status appears immediately and each visible stage maps to a validated lifecycle event.
- [ ] A representative action stays connected beyond 30 seconds and shows `Taking longer than usual` without timer reset across repair.
- [ ] Ten seconds of lifecycle silence shows `Needs attention` and stops healthy animation.
- [ ] Stream interruption shows `Connection interrupted · Brain state unknown`; only explicit Retry starts a new identity.
- [ ] Late events/results from an old request/cancellation epoch are ignored.
- [ ] A valid complete revision applies before asynchronous jobs revalidate or batch.
- [ ] Retryable batch failure preserves the exact locked batch; terminal failure appends no provisional turns.

## Deployment and retention

- [ ] Target host supports the declared 620-second route duration and streams NDJSON without buffering or premature EOF.
- [ ] Prepared Demo works on the deployed origin with Live disabled.
- [ ] Exact production `ALLOWED_ORIGIN` is configured and no standard key appears in browser bundles or responses.
- [ ] Hosting logs contain only the documented content-free allowlist.
- [ ] Active OpenAI project retention controls were checked separately; record the result without inferring Zero Data Retention from `store: false`.

## Experimental local evaluation

- [ ] `one_shot` and search-disabled defaults are confirmed with environment flags absent.
- [ ] Ordinary Live rejects `codex_ephemeral`.
- [ ] Local Codex runs in a fresh empty directory, ephemeral/read-only mode, strict environment allowlist, and without repository rules or arbitrary MCP servers.
- [ ] Generated artifacts contain synthetic inputs only and remain under `.brain-evaluation-artifacts/`.
- [ ] Public search remains disabled unless five-query/five-source enforcement and explicit processing acknowledgement are both verified.
- [ ] Any bake-off report records hashes, versions, flags, model IDs, host metadata, three repetitions per fixture/candidate, blind labels, and human scoring separately.

## Current delivery status

- Automated mocks/fixtures: verified by the repository test commands.
- Live OpenAI Brain: one local confirmed-snapshot NDJSON smoke passed on 2026-07-21 (revision 1, one bounded repair, 30 lifecycle events); Realtime session issuance returned 200 with the secret-bearing body discarded.
- Physical microphone/playback: not verified in this delivery.
- Deployment and target-host stream duration: not verified in this delivery.
- Provider retention/ZDR: not verified in this delivery.
- Live Codex/public-search bake-off and human scoring: not performed.
