# Spec Grill Agent Guidance

## Mission and authority

Build and verify the Spec Grill MVP described by the repository's planning documents. Read these before changing code, in this order:

1. `IMPLEMENTATION_HANDOFF.md`
2. `CONTEXT.md`
3. Every file in `docs/adr/`

Those documents contain settled product decisions. Do not reopen them, weaken them to fit an SDK, or expand the MVP without an explicit user request.

## YOLO-mode boundary

The user intends to run Codex with `--yolo`. Treat that as permission to execute normal in-scope development actions without repeated approval prompts, including editing repository files, installing project dependencies, running local servers, using browser automation, and running relevant tests.

YOLO mode does not authorize:

- Expanding product scope or ignoring the handoff's non-goals.
- Inventing credentials, stakeholder decisions, test results, or live AI output.
- Creating accounts, accepting legal terms, purchasing services, changing billing, or weakening security controls.
- Publishing secrets or confidential content.
- Destructive changes unrelated to the requested implementation.
- Committing, pushing, opening a PR, or deploying unless the active request or handoff explicitly includes that action.

Do not add repository configuration that turns on YOLO mode for other users. Runtime permissions are selected by the person starting Codex.

## Human-action blockers

Proceed autonomously while any safe, in-scope implementation or verification work remains. Stop only when completion genuinely requires an action or decision that Codex cannot perform.

Examples include:

- Creating or obtaining an OpenAI API key.
- Entering a secret into local or Vercel environment settings.
- Logging into or creating an external provider account when no authenticated session exists.
- Selecting a paid plan, accepting terms, changing billing, or configuring DNS.
- Granting a physical browser/OS microphone permission that automation cannot provide.
- Making a product decision not resolved by the handoff.

Before stopping, finish all work that can be completed with mocks, Prepared Demo, local fixtures, and non-live tests. A missing OpenAI key must not block the deterministic app, schemas, mocked flows, tests, build, or documentation.

When blocked, do not ask the user to paste a secret into chat. Provide exactly:

```text
BLOCKED ON HUMAN
Action: <one concrete action the human must perform>
Where: <exact UI, command, or environment setting>
Why: <what verification or deliverable this unblocks>
Resume with: <the exact next command/check Codex will run afterward>
```

Then stop. Do not substitute prepared data into Live Mode or claim the blocked verification passed.

## Team and ownership

The root implementation agent should create the four-agent team defined in `IMPLEMENTATION_HANDOFF.md`:

- `brain-api`
- `realtime-voice`
- `experience-demo`
- `verification-docs`

Use task-appropriate available models. Prefer stronger reasoning for architecture, GPT-5.6 integration, Realtime behavior, and final integration; Terra/Luna-class variants are suitable for bounded UI, fixture, documentation, and test tasks.

Freeze shared schemas, reducer events, API contracts, and transport interfaces before parallel edits. Do not let agents edit the same shared file concurrently. Module owners fix findings in their owned files; the root agent owns cross-module integration.

## Hard implementation constraints

- Runtime Brain: server-side `gpt-5.6`, medium reasoning, Responses API Structured Outputs, full confirmed state, and `store: false`.
- Runtime Communicator: `gpt-realtime-2.1` over native browser WebRTC.
- Realtime semantic VAD uses `create_response: false` and cannot call the Brain autonomously.
- `gpt-4o-transcribe` creates the editable Answer Draft.
- Only explicit PM confirmation calls `/api/brain`.
- Validate every AI/API response before rendering or state mutation.
- Standard OpenAI credentials remain server-side.
- Live AI and Prepared Demo data never mix.
- Preserve the last valid Specification on every failure.
- Do not add auth, meeting integrations, collaboration, databases, payments, analytics, arbitrary model-authored markup, or multilingual scope.

## Secrets and external services

- Never read, print, log, commit, or expose API keys, temporary Realtime secrets, raw audio, SDP, transcripts, or Specifications.
- Commit only `.env.example`; keep `.env.local` and other secret files ignored.
- If `OPENAI_API_KEY` is absent, keep Live Mode visibly disabled and continue with mocks and Prepared Demo.
- Use a dedicated, capped OpenAI project and `LIVE_AI_ENABLED` as described in the handoff.
- Do not claim Zero Data Retention unless the active OpenAI project is verified to have it.

## Verification and definition of done

Implement by the dependency-ordered milestones in `IMPLEMENTATION_HANDOFF.md`. Keep the repository runnable after each milestone.

Before declaring completion, run the actual repository equivalents of:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Also verify Prepared Demo without OpenAI or microphone access, inspect for leaked secrets, exercise the agreed failure paths, and update README/video documentation with work actually completed. Live API and physical microphone checks may be marked blocked only through the human-action protocol above.
