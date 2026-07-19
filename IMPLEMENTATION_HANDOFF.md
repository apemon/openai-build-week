# Spec Grill — Implementation Handoff Pack

Status: agreed implementation plan

Date: 2026-07-19

Audience: a separate Codex implementation session
Repository state: planning documentation only; the application has not been implemented

## 1. Executive summary

Spec Grill is a web-based requirements interview room for one Product Manager. It turns a vague spoken or typed request into a traceable, implementation-ready product Specification by asking exactly one high-value question at a time.

The MVP is a controlled hackathon experience, not a meeting integration. It has two visibly distinct modes:

- **Live Mode** processes the PM's real input with genuine OpenAI API calls.
- **Prepared Demo** is a deterministic, offline-capable team-billing walkthrough with static validated snapshots and bundled spoken-prompt audio.

The runtime uses a controlled chained voice architecture:

1. `gpt-realtime-2.1` provides the browser Realtime session, semantic turn detection, and spoken Communicator output.
2. The Realtime session's `gpt-4o-transcribe` input transcription creates an editable Answer Draft.
3. The PM explicitly confirms or edits that draft.
4. A stateless server route sends only confirmed text and the complete current state to `gpt-5.6` with medium reasoning effort and `store: false`.
5. GPT-5.6 is the authoritative Brain. It returns a complete structured Specification revision, readiness assessment, and at most one next Interview Prompt.
6. The response is schema- and semantics-validated before any UI mutation.
7. The detailed prompt is rendered visibly; `gpt-realtime-2.1` speaks the short Brain-approved form.

The PM controls finalization. A final or draft Specification can be downloaded as Markdown at any time.

### Agreed MVP scope

- One solo PM in one English-language browser tab.
- Thirty-minute Live Interview Session with a convergence checkpoint after ten Brain turns.
- Automatic voice-turn detection; no push-to-talk.
- Text composer always available as a first-class path.
- Review gate before any voice transcript reaches the Brain.
- Exactly one active follow-up question.
- Detailed visible prompt, concise spoken prompt, optional schema-rendered Visual Aid.
- Live structured sections:
  - Problem statement
  - Users and jobs-to-be-done
  - Functional requirements
  - Non-functional requirements
  - Assumptions
  - Open Questions
  - Blockers
  - Risks and edge cases
  - Acceptance Criteria
  - Next Actions
- Provenance and status on every substantive Specification Item.
- Categorical Readiness: `draft`, `blocked`, `ready_with_follow_ups`, or `ready`.
- Prompt deferral and correction-through-conversation.
- Reversible finalization within the current tab.
- Local Markdown draft/final export.
- Expiring per-tab reload checkpoint containing confirmed data only.
- Responsive, keyboard-accessible, WCAG 2.2 AA-oriented interface.
- Next.js TypeScript application deployed primarily to Vercel.
- Prepared team-billing demo with seven decisions, validated static snapshots, and bundled audio.
- README and three-minute video storyboard documenting actual Codex contributions and meaningful GPT-5.6 runtime use.

## 2. Explicit non-goals

Do not add any of the following to this MVP:

- Zoom, Google Meet, Microsoft Teams, Daily, Pipecat, telephony, or other meeting integrations.
- Authentication, user accounts, roles within Spec Grill, invitations, or multi-user collaboration.
- Database persistence, saved projects, cross-device history, cloud file storage, or resume after the browser-session expiry.
- Payment processing for Spec Grill. Team billing is demonstration content only.
- Product analytics, telemetry dashboards, distributed tracing, queues, background workers, or an always-on agent process.
- Arbitrary AI-authored HTML, SVG, Mermaid, JavaScript, CSS, or image generation.
- Direct freeform editing of Specification Items.
- Multilingual UI, transcription promises, or translated export.
- Full browser parity for voice. Desktop Chrome is the primary voice target.
- Complex performance optimization, prompt-caching infrastructure, load testing, or a production SLO program.
- Silent fallback from Live AI to prepared content.
- Claims of Zero Data Retention unless the deployed OpenAI project is verified to have it.

## 3. Canonical domain language

The implementation must follow [CONTEXT.md](./CONTEXT.md). Important boundaries are:

- The **Product Manager** is the only MVP user.
- The **Communicator** owns controlled voice interaction and presentation.
- The **Brain** owns analysis, the Specification, Readiness, and next-question choice.
- An **Answer Draft** is editable and unconfirmed; it cannot change the Specification.
- A **Confirmed Answer** is PM-approved and may be sent to the Brain.
- A **Deferred Prompt** creates an unresolved item and suggested follow-up, never an answer.
- A **Blocker** prevents implementation-ready handoff; an **Open Question** does not.
- A **Next Action** has an intended outcome and a PM-confirmed or provisional Decision Owner.
- A **Specification Item** is `confirmed`, `derived`, `proposed`, or `unresolved`, with source-turn references.

Also preserve the architectural decisions in [ADR 0001](./docs/adr/0001-use-realtime-communicator-with-authoritative-gpt-5-6-brain.md), [ADR 0002](./docs/adr/0002-use-direct-realtime-webrtc-behind-an-adapter.md), and [ADR 0003](./docs/adr/0003-keep-the-brain-stateless-and-browser-authoritative.md).

## 4. User flows and screen requirements

### 4.1 Start screen

Show:

- Product name and one-sentence value proposition.
- Two unambiguous choices: `Start live interview` and `Run prepared demo`.
- `Live AI` versus `Prepared demo • no AI call` provenance before the user chooses.
- A short Live Mode privacy notice:
  - Spec Grill does not persist raw audio or session text on its servers.
  - Live audio/text is processed by OpenAI under the deployed project's data controls.
  - Do not enter confidential or regulated information in this hackathon demo.
- `Enable microphone` and `Continue with text only` controls.
- Microphone permission requested only after the explicit enable action.
- A configuration-safe state: if `LIVE_AI_ENABLED` is false or the server lacks valid configuration, Live Mode is visibly disabled while Prepared Demo remains available.

Initial live prompt, visibly identified as app-authored:

> What do you want to build?

The detailed form may invite the PM to describe the request and current pain, but it must remain one decision request. Voice presentation uses the Realtime Communicator; text-only mode shows it without requiring Realtime.

### 4.2 Interview Room

Desktop layout:

- Compact header: mode, Readiness, 30-minute timer, provenance, audio controls, and `Review specification`.
- 40% interaction column:
  - Communicator identity and AI-voice disclosure.
  - Explicit microphone state.
  - Current detailed Interview Prompt.
  - Optional Visual Aid.
  - `Defer` action.
  - Answer composer or Answer Draft review card.
- 60% Specification column:
  - Section navigation.
  - Current revision.
  - Changed-item highlights after each validated update.
  - Item status and provenance chips.
- Conversation history in a collapsible drawer, not as a competing permanent column.

Mobile layout:

- Interaction content first.
- Tabs for `Specification` and `History`.
- All actions remain available at a 390 px viewport.
- No horizontal page scrolling.

Do not use fake video tiles or human avatars. A restrained voice-activity visualization is allowed, with an equivalent text state and reduced-motion behavior.

### 4.3 Voice and text interaction flow

The canonical live cycle is:

1. Present the visible detailed prompt.
2. Speak its short Brain-approved form.
3. Keep the microphone track disabled during playback.
4. On playback completion, enable automatic listening.
5. `Answer now` stops playback and starts listening immediately.
6. Semantic VAD detects the PM's completed turn.
7. Show transcript deltas as non-authoritative preview if available.
8. On finalized transcription, disable the microphone track and show an editable Answer Draft.
9. Offer `Send to Brain`, `Record again`, and text editing.
10. Only `Send to Brain` or `Ctrl/Cmd+Enter` creates a Confirmed Answer.
11. Show honest progress while the Brain runs.
12. Atomically replace the Specification only after complete validation.
13. Present the next prompt, or enter Final Review when there is no valuable next question.

Microphone display states:

- `off`
- `listening`
- `speech_detected`
- `transcribing`
- `reviewing_answer`

Text behavior:

- Composer is always visible.
- Focusing or typing pauses microphone capture.
- Typed input uses the same Answer Draft review gate.
- Plain Enter creates a newline; `Ctrl/Cmd+Enter` confirms.
- Maximum 4,000 characters per answer, with a counter near the limit.
- `Resume microphone` returns to automatic voice capture.

### 4.4 Prompt content

One detailed Interview Prompt may contain:

- The single decision question.
- Why the decision matters.
- Confirmed context relevant to the question.
- Decision impact.
- An optional, explicitly labeled AI recommendation only when grounded in confirmed evidence.
- An optional Visual Aid.

If evidence is insufficient, show `No recommendation yet`; do not fill space with weak advice. The spoken prompt is shorter and simpler but asks the same single question. It must not introduce another decision, fact, number, permission, or qualification.

### 4.5 Deferral and correction

- Every prompt offers `Defer`.
- Deferral accepts an optional note, such as an external committee date.
- The note is not interpreted as the missing decision.
- The Brain classifies the item as an Open Question or Blocker and suggests a Next Action and role-based Decision Owner.
- Suggested owners remain `provisional` until the PM confirms or edits them.
- Each Specification Item offers `Correct or challenge`.
- A correction returns to the same voice/text Answer Draft flow and becomes a Confirmed Answer.
- The Brain recomputes the full snapshot; do not allow arbitrary inline Specification editing.

### 4.6 Convergence and Final Review

- The PM may enter Final Review at any time.
- After ten Brain turns, pause and show Readiness with `Continue grilling` and `Review specification`.
- The Brain must not manufacture low-value questions to continue the interview.
- `Finalize specification` stops capture and locks the current revision.
- `Resume grilling` creates a new draft revision while preserving the prior finalized revision in current-tab history.
- `Exit and clear session` is the destructive action and requires confirmation.

Final Review shows:

- Categorical Readiness and evidence.
- Full structured Specification.
- Confirmed/proposed/unresolved distinctions.
- Blockers and Open Questions.
- Editable Next Action owner/outcome fields with explicit confirmation state.
- `Download Markdown`, `Copy Markdown`, `Resume grilling`, and `Exit and clear session`.

### 4.7 Markdown export

Generate Markdown in the browser from the last validated snapshot. Do not call AI to export.

Required export order:

1. Title
2. Export timestamp
3. Live/Demo provenance and model metadata
4. Readiness
5. Problem statement
6. Users and jobs-to-be-done
7. Functional requirements
8. Non-functional requirements
9. Assumptions
10. Risks and edge cases
11. Acceptance Criteria
12. Blockers
13. Open Questions
14. Next Actions

Preserve item IDs, statuses, and source references. Exclude raw conversation and audio. Draft exports must include a prominent draft warning. Demo exports must include `Prepared demo data — not live AI output`.

Filename: `spec-grill-{slug}-{YYYY-MM-DD}.md`.

Use a `text/markdown` Blob, temporary object URL, synthetic download anchor, and immediate URL revocation. `Copy Markdown` is secondary. If clipboard/download APIs fail, show a selectable preview.

## 5. Agent responsibilities and decision logic

### 5.1 Application orchestrator

The application, not either model, owns approval and state transitions.

It must:

- Prevent any unconfirmed transcript from reaching `/api/brain`.
- Mute/disable audio tracks at the agreed phases.
- Reject stale responses by base revision and request ID.
- Validate all provider events used for state changes.
- Preserve the last valid Specification on every error.
- Keep Prepared Demo and Live Mode data entirely separate.

### 5.2 Communicator

Runtime model: `gpt-realtime-2.1`.

Responsibilities:

- Maintain the WebRTC session.
- Support semantic VAD and turn lifecycle events.
- Surface the separate `gpt-4o-transcribe` transcript as an Answer Draft.
- Speak the Brain-approved `spokenQuestion` naturally.
- Respect playback, mute, `Answer now`, and reconnect controls.
- Never update the Specification.
- Never send an answer to the Brain autonomously.
- Never invent or answer stakeholder decisions.

Use an out-of-band Realtime response for speech so it does not pollute the default Realtime conversation:

```json
{
  "type": "response.create",
  "response": {
    "conversation": "none",
    "metadata": {
      "purpose": "speak_brain_prompt",
      "promptId": "prompt-uuid"
    },
    "input": [],
    "output_modalities": ["audio"],
    "instructions": "Say exactly the supplied spoken question naturally, without adding or answering anything."
  }
}
```
The detailed visible prompt is authoritative because model instructions are guidance, not a byte-for-byte speech guarantee. Observe the output transcript for diagnostics, but never let it alter Specification state.

### 5.3 Brain

Runtime model: server-side `gpt-5.6` alias, currently the flagship GPT-5.6 route, with medium reasoning effort. Allow a server-only override but default to `gpt-5.6`. Use the Responses API, Structured Outputs, and `store: false`.

Responsibilities:

- Analyze the complete confirmed conversation and current Specification.
- Detect ambiguity, contradiction, missing decisions, dependencies, risks, and edge cases.
- Maintain every required Specification section.
- Preserve stable IDs and source provenance across revisions.
- Produce test-ready Acceptance Criteria.
- Distinguish `confirmed`, `derived`, `proposed`, and `unresolved`.
- Assess categorical Readiness with evidence.
- Suggest role-based Next Action owners without inventing people or approvals.
- Choose at most one next Interview Prompt.
- Produce both detailed and concise spoken forms of that same question.
- Never expose chain-of-thought. Return only the structured result.

Next-question priority:

1. Contradictions between Confirmed Answers.
2. Decisions blocking the core user journey.
3. Actors, permissions, money, data, and external dependencies.
4. Failure behavior and consequential edge cases.
5. Measurable non-functional expectations.
6. First-release success.
7. Lower-impact polish.

Within a priority, maximize downstream impact and information gain. Do not immediately repeat a Deferred Prompt unless later evidence makes it newly blocking.

### 5.4 Provenance rules

- `confirmed`: directly supported by one or more Confirmed Answers.
- `derived`: logically entailed by confirmed decisions and introduces no new behavior.
- `proposed`: useful model-authored wording or resolution not yet accepted.
- `unresolved`: missing, contradictory, or deferred information.

Every substantive item carries valid source turn IDs. If an Acceptance Criterion introduces a number, permission, state, or behavior not entailed by confirmed decisions, it must be proposed or unresolved.

## 6. Conversation state model

Use a reducer/state machine; do not distribute phase logic across unrelated components.

```ts
type SessionMode = "live" | "demo";

type SessionPhase =
  | "start"
  | "connecting"
  | "presenting_prompt"
  | "listening"
  | "speech_detected"
  | "transcribing"
  | "reviewing_answer"
  | "analyzing"
  | "final_review"
  | "finalized"
  | "recoverable_error";

type ReadinessStatus =
  | "draft"
  | "blocked"
  | "ready_with_follow_ups"
  | "ready";

interface SessionState {
  sessionId: string;
  mode: SessionMode;
  phase: SessionPhase;
  startedAt: string;
  expiresAt: string;
  revision: number;
  turns: ConversationTurn[];
  specification: Specification;
  currentPrompt: InterviewPrompt | null;
  answerDraft: AnswerDraft | null;
  lastFinalizedRevision: number | null;
  provenance: SessionProvenance;
  pendingRequest: { requestId: string; baseRevision: number } | null;
  error: RecoverableError | null;
}
```

Important invariants:

- Only `reviewing_answer` may hold an Answer Draft.
- Microphone capture is enabled only in `listening` or `speech_detected`.
- `analyzing` requires a Confirmed Answer or Deferred Prompt operation.
- A response may apply only when its `baseRevision` equals the current revision and request ID matches.
- Specification replacement is atomic.
- Demo state is never accepted by the Live Brain endpoint.
- Checkpoint only validated revisions, Confirmed Answers, confirmed/provisional Next Actions, and session metadata.
- Never checkpoint raw audio, transcript deltas, unconfirmed drafts, client secrets, or provider event payloads.

Checkpoint to `sessionStorage` after each validated revision. Include a schema version and expiry. Restore only a valid, unexpired same-tab checkpoint; otherwise delete it. Clear on Reset, explicit exit, or expiry.

## 7. Recommended architecture and rationale

### 7.1 Stack

- Current stable Next.js with App Router.
- React and strict TypeScript.
- npm for the empty repository's package manager.
- Tailwind CSS for responsive styling; semantic HTML remains primary.
- `openai` official Node/TypeScript SDK.
- `zod` and `openai/helpers/zod` for Structured Outputs.
- Native browser `RTCPeerConnection`, `MediaStreamTrack`, and Realtime data channel behind `CommunicatorTransport`.
- React `useReducer` plus small context providers; no Zustand/Redux.
- Application-authored React renderers for three diagram types; no general graph/code renderer.
- Vitest and React Testing Library for unit/component tests.
- Playwright plus axe integration for critical browser flows.

### 7.2 Deployment topology

```text
Browser tab
├── React UI and reducer
├── sessionStorage checkpoint
├── Markdown/diagram renderers
├── direct WebRTC ──────────────► OpenAI Realtime
└── HTTPS requests ─────────────► Next.js route handlers on Vercel
                                  ├── mint short-lived Realtime credential
                                  └── validate + call GPT-5.6 Responses API
```

There is no long-running Brain process. The logical Brain persists through the complete state sent on each request. Vercel functions may be different instances on every call.

This design follows OpenAI's guidance that browser Realtime clients use WebRTC, while approval-heavy workflows benefit from explicit speech-to-text, text reasoning, and speech-output control. References: [Voice agents](https://developers.openai.com/api/docs/guides/voice-agents), [Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc), [Realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad), [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model.md).

### 7.3 Realtime session configuration

Use the standard key only in the server route that creates a short-lived client secret. Lock the requested defaults server-side and return only the temporary secret and expiry.

Target session settings:

```json
{
  "type": "realtime",
  "model": "gpt-realtime-2.1",
  "output_modalities": ["audio"],
  "audio": {
    "input": {
      "turn_detection": {
        "type": "semantic_vad",
        "eagerness": "medium",
        "create_response": false,
        "interrupt_response": false
      },
      "transcription": {
        "model": "gpt-4o-transcribe",
        "language": "en"
      }
    },
    "output": {
      "voice": "marin"
    }
  }
}
```

`create_response: false` is essential: VAD may commit a completed user turn, but the Realtime model must not answer or call the Brain before PM confirmation.

Consume and validate only the event subset needed by the app:

- session created/updated/error
- `input_audio_buffer.speech_started`
- `input_audio_buffer.speech_stopped`
- `conversation.item.input_audio_transcription.delta`
- `conversation.item.input_audio_transcription.completed`
- output-audio transcript/done events
- `response.done`

Use `item_id` to reconcile transcript events because completion ordering across turns is not guaranteed.

## 8. Repository structure and major files

Create this structure. Minor colocated test files are allowed, but preserve ownership boundaries.

```text
/
├── AGENTS.md
├── .env.example
├── .gitignore
├── CONTEXT.md
├── IMPLEMENTATION_HANDOFF.md
├── README.md
├── package.json
├── package-lock.json
├── next.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── docs/
│   ├── adr/
│   │   ├── 0001-use-realtime-communicator-with-authoritative-gpt-5-6-brain.md
│   │   ├── 0002-use-direct-realtime-webrtc-behind-an-adapter.md
│   │   └── 0003-keep-the-brain-stateless-and-browser-authoritative.md
│   └── demo-video-storyboard.md
├── public/
│   └── demo-audio/
│       ├── 00-initial-request.mp3
│       ├── 01-permissions.mp3
│       ├── 02-pricing-basis.mp3
│       ├── 03-seat-changes.mp3
│       ├── 04-failed-payment.mp3
│       ├── 05-provider.mp3
│       ├── 06-success.mp3
│       └── 07-tax.mp3
├── scripts/
│   └── generate-demo-audio.ts
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── brain/route.ts
│   │   │   └── realtime/session/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── agents/
│   │   ├── brain/
│   │   │   ├── prompt.ts
│   │   │   ├── run-brain.ts
│   │   │   ├── semantic-validator.ts
│   │   │   └── retry-policy.ts
│   │   └── communicator/
│   │       ├── speech-instructions.ts
│   │       └── prompt-presenter.ts
│   ├── components/
│   │   ├── start/StartScreen.tsx
│   │   ├── interview/InterviewRoom.tsx
│   │   ├── interview/PromptCard.tsx
│   │   ├── interview/AnswerDraftCard.tsx
│   │   ├── interview/TextComposer.tsx
│   │   ├── interview/MicrophoneStatus.tsx
│   │   ├── interview/ConversationDrawer.tsx
│   │   ├── specification/SpecificationPanel.tsx
│   │   ├── specification/SpecificationSection.tsx
│   │   ├── specification/ProvenanceChip.tsx
│   │   ├── final-review/FinalReview.tsx
│   │   ├── final-review/NextActionEditor.tsx
│   │   └── visual-aids/
│   │       ├── VisualAid.tsx
│   │       ├── RoleMap.tsx
│   │       ├── ProcessFlow.tsx
│   │       └── StateFlow.tsx
│   ├── demo/
│   │   ├── team-billing-scenario.ts
│   │   ├── team-billing-snapshots.ts
│   │   └── demo-runner.ts
│   ├── domain/
│   │   ├── schemas.ts
│   │   ├── types.ts
│   │   ├── ids.ts
│   │   ├── initial-state.ts
│   │   ├── session-reducer.ts
│   │   ├── session-events.ts
│   │   └── invariants.ts
│   ├── export/
│   │   ├── to-markdown.ts
│   │   ├── download-markdown.ts
│   │   └── copy-markdown.ts
│   ├── lib/
│   │   ├── env.server.ts
│   │   ├── provenance.ts
│   │   ├── request-guards.server.ts
│   │   └── session-checkpoint.ts
│   └── realtime/
│       ├── CommunicatorTransport.ts
│       ├── OpenAIWebRTCTransport.ts
│       ├── realtime-event-schemas.ts
│       ├── realtime-session.ts
│       └── useCommunicator.ts
└── tests/
    ├── fixtures/
    │   ├── brain-valid.json
    │   ├── brain-invalid.json
    │   ├── brain-refusal.json
    │   └── realtime-events.json
    ├── unit/
    ├── integration/
    └── e2e/
        ├── prepared-demo.spec.ts
        ├── live-text.spec.ts
        ├── transcript-review.spec.ts
        ├── recovery.spec.ts
        └── finalization-export.spec.ts
```

## 9. API contracts, TypeScript types, and structured-output schema

Create Zod schemas first and infer TypeScript types from them. Avoid maintaining independent interfaces that can drift. The following is the required conceptual contract; exact Zod syntax may differ.

```ts
type ItemStatus = "confirmed" | "derived" | "proposed" | "unresolved";
type ItemKind =
  | "problem"
  | "user"
  | "job"
  | "functional_requirement"
  | "non_functional_requirement"
  | "assumption"
  | "risk"
  | "edge_case"
  | "open_question"
  | "blocker";

type VisualAid =
  | {
      kind: "role_map";
      title: string;
      nodes: VisualNode[];
      edges: VisualEdge[];
      sourceItemIds: string[];
    }
  | {
      kind: "process_flow";
      title: string;
      nodes: VisualNode[];
      edges: VisualEdge[];
      sourceItemIds: string[];
    }
  | {
      kind: "state_flow";
      title: string;
      nodes: VisualNode[];
      edges: VisualEdge[];
      sourceItemIds: string[];
    };

interface SpecificationItem {
  id: string;                 // e.g. FR-001, NFR-001, RISK-001
  kind: ItemKind;
  statement: string;
  status: ItemStatus;
  sourceTurnIds: string[];
  rationale: string;
}

interface AcceptanceCriterion {
  id: string;                 // e.g. AC-001
  requirementIds: string[];
  status: ItemStatus;
  sourceTurnIds: string[];
  format: "given_when_then" | "measurable_assertion";
  given: string | null;
  when: string | null;
  then: string | null;
  assertion: string | null;
}

interface NextAction {
  id: string;
  sourceItemIds: string[];
  action: string;
  intendedOutcome: string;
  decisionOwnerRole: string | null;
  ownership: "provisional" | "confirmed" | "owner_to_identify";
  status: "open" | "done";
}

interface ReadinessAssessment {
  status: "draft" | "blocked" | "ready_with_follow_ups" | "ready";
  evidence: string[];
  blockerIds: string[];
  openQuestionIds: string[];
}

interface InterviewPrompt {
  id: string;
  decisionKey: string;
  detailedQuestion: string;
  spokenQuestion: string;
  whyItMatters: string;
  confirmedContext: string[];
  decisionImpact: string[];
  recommendation: {
    answer: string;
    rationale: string;
  } | null;
  visualAid: VisualAid | null;
}

interface Specification {
  title: string;
  problemStatement: SpecificationItem[];
  users: SpecificationItem[];
  jobsToBeDone: SpecificationItem[];
  functionalRequirements: SpecificationItem[];
  nonFunctionalRequirements: SpecificationItem[];
  assumptions: SpecificationItem[];
  risks: SpecificationItem[];
  edgeCases: SpecificationItem[];
  openQuestions: SpecificationItem[];
  blockers: SpecificationItem[];
  acceptanceCriteria: AcceptanceCriterion[];
  nextActions: NextAction[];
  readiness: ReadinessAssessment;
}

interface ConversationTurn {
  id: string;
  promptId: string | null;
  type: "confirmed_answer" | "deferred_prompt" | "correction";
  text: string;
  createdAt: string;
}
```

### 9.1 `POST /api/brain`

Request:

```ts
interface BrainRequest {
  schemaVersion: 1;
  sessionId: string;
  mode: "live"; // reject demo
  requestId: string;
  baseRevision: number;
  operation: "answer" | "defer" | "correct" | "resume";
  turns: ConversationTurn[];
  currentSpecification: Specification;
  currentPrompt: InterviewPrompt | null;
}
```

Model Structured Output:

```ts
interface BrainModelOutput {
  specification: Specification;
  nextPrompt: InterviewPrompt | null;
  changeSummary: string[];
}
```

Server response:

```ts
interface BrainResponse {
  schemaVersion: 1;
  requestId: string;
  baseRevision: number;
  revision: number; // server assigns baseRevision + 1
  provenance: {
    source: "live_ai";
    agent: "brain";
    requestedModel: string;
    actualModel: string;
    validatedAt: string;
    repairAttempted: boolean;
  };
  output: BrainModelOutput;
}
```

Use `openai.responses.parse` with `zodTextFormat`. Validate the request before the API call, parse Structured Output, then run the same Zod `safeParse` plus semantic validation before returning. Handle refusal, incomplete response, empty parsed output, timeout, and provider error explicitly.

Semantic validation must enforce:

- Existing IDs retain meaning and category.
- IDs are unique and match their category pattern.
- Every source turn and requirement reference exists.
- Exactly zero or one `nextPrompt` exists.
- `spokenQuestion` and `detailedQuestion` each contain one decision question.
- A recommendation is null without sufficient confirmed sources.
- Visual Aid has at most eight nodes and ten edges, with valid references.
- Acceptance Criterion field shape matches its format.
- `derived` items introduce no new decision behavior.
- Readiness blocker/open-question IDs exist and agree with the section contents.
- No Demo provenance or prepared scenario marker appears in Live output.

On validation failure, perform one automatic repair request containing compact validation errors. Do not mutate UI state. After a second failure, return a typed recoverable error and preserve the confirmed turn for manual retry.

### 9.2 `POST /api/realtime/session`

Request:

```ts
interface RealtimeSessionRequest {
  schemaVersion: 1;
  sessionId: string;
}
```

Response:

```ts
interface RealtimeSessionResponse {
  schemaVersion: 1;
  clientSecret: string;
  expiresAt: string;
  configuration: {
    realtimeModel: "gpt-realtime-2.1" | string;
    transcriptionModel: "gpt-4o-transcribe" | string;
    voice: string;
  };
}
```

Return no standard API key, full provider payload, or internal error details. The short-lived credential is still sensitive and must never be logged or checkpointed.

### 9.3 Typed error envelope

Both routes return:

```ts
interface ApiError {
  error: {
    code:
      | "LIVE_DISABLED"
      | "INVALID_REQUEST"
      | "MODEL_TIMEOUT"
      | "MODEL_REFUSAL"
      | "INVALID_MODEL_OUTPUT"
      | "REALTIME_UNAVAILABLE"
      | "RATE_LIMITED"
      | "INTERNAL_ERROR";
    message: string;
    retryable: boolean;
    requestId: string;
  };
}
```

## 10. GPT-5.6 integration and secure environment

Runtime Brain call requirements:

- Model: `process.env.OPENAI_BRAIN_MODEL ?? "gpt-5.6"`.
- Responses API.
- `store: false`.
- Medium reasoning effort.
- Structured Outputs from the shared Zod schema.
- Full confirmed conversation and current Specification sent on each turn.
- One automatic validation-repair retry.
- Application timeout around 30 seconds; preserve state on timeout.
- Do not use Conversations API or `previous_response_id` as authoritative state.
- Do not request or surface chain-of-thought.

`.env.example`:

```dotenv
OPENAI_API_KEY=
OPENAI_BRAIN_MODEL=gpt-5.6
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
LIVE_AI_ENABLED=false
ALLOWED_ORIGIN=http://localhost:3000
```

Optional local-only audio-generation settings may be documented separately, but never use `NEXT_PUBLIC_` for credentials.

Security requirements:

- Standard OpenAI key exists only in `.env.local`/Vercel server environment.
- `.env*` secret files are gitignored; only `.env.example` is committed.
- Mint short-lived Realtime credentials server-side.
- Validate Origin, method, content type, body size, schema version, 30-minute session expiry, and Live kill switch.
- Use a dedicated OpenAI project key with conservative project spend/rate limits.
- Do not log raw audio, transcript content, prompt content, specifications, client secrets, SDP, or API keys.
- Prepared Demo remains usable when Live is disabled.
- Enable Live on the public deployment only during controlled presentation/judging windows.

Privacy copy must distinguish app storage from provider processing. `store: false` is not a Zero Data Retention claim. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

## 11. Prepared Demo scenario

Prepared Demo is a deterministic fixture runner. It performs no microphone, Realtime, transcription, Brain, or TTS request.

User experience:

- Persistent amber `Prepared demo • no AI call` badge.
- Play the bundled local audio for each prompt when available.
- Show `Use prepared answer` for each turn.
- Advance to the next prevalidated Specification snapshot.
- If audio playback fails, continue silently.
- Do not accept arbitrary input as though it were analyzed by AI.
- Never transfer a Demo snapshot into Live Mode.

Canonical transcript:

Initial PM input:

> We need team billing for our SaaS.

1. **Permissions**
   - Workspace Owner creates billing, changes plan, assigns Billing Admins, and cancels.
   - Billing Admin updates payment/billing details and views/downloads invoices.
   - Member has no billing access.
   - Owner must transfer ownership before removal while billing is active.
2. **Billing basis**
   - Monthly per active seat in USD on one team plan.
   - Owner and Billing Admin count as seats.
   - Suspended and unaccepted invited users do not count.
   - No usage, annual, volume-discount, or fixed-plan variants.
3. **Seat changes**
   - Invite is free until acceptance.
   - Acceptance adds a prorated seat immediately.
   - Removal/suspension revokes access immediately.
   - Billing reduction applies next renewal with no mid-cycle refund.
   - UI shows current active and scheduled renewal seat counts.
4. **Failed payment**
   - Seven-day fully usable grace period.
   - Owner/Billing Admin receive in-app and email notices.
   - Provider retries during grace.
   - Successful payment restores/clears status automatically.
   - After seven days, workspace is read-only but billing controls remain usable.
   - No automatic data deletion.
   - After 30 days unpaid, subscription cancels; retention policy is handled separately.
5. **Provider**
   - Stripe Billing, Checkout, Customer Portal, and server-verified webhooks.
   - App authorization precedes hosted session creation.
   - Server-only Price IDs and webhook secrets.
   - Coupons, credits, multiple currencies, manual invoices, and alternative providers excluded.
6. **First-release success**
   - 90% of pilot Owners self-serve without support.
   - No seat/subscription mismatch remains unresolved beyond 15 minutes.
   - 99% of Stripe-confirmed changes appear within 60 seconds.
   - Members fail every billing authorization test.
   - Payment repair restores access within 60 seconds.
   - No critical billing/authorization defect remains at pilot completion.
7. **Tax**
   - Stripe Tax automatic calculation based on billing location.
   - Finance configures registrations before launch as a confirmed Next Action.

Final prepared Readiness: `ready_with_follow_ups`, with Finance registration configuration and any agreed security/legal validation shown as transparent Next Actions rather than invented approvals.

Static fixture requirements:

- Every snapshot passes the production Zod and semantic validators.
- Snapshots demonstrate provenance status changes, requirements, risks, at least one useful Visual Aid, and concrete Acceptance Criteria.
- Demo audio text exactly matches each fixture's `spokenQuestion`.
- Audio is labeled prepared AI voice and committed so playback requires no live API.

## 12. Failure and fallback behavior

| Failure | Required behavior |
|---|---|
| Live disabled or key missing | Disable Live visibly; Prepared Demo remains available. |
| Microphone denied/unavailable/disconnected | Preserve state, switch to text, show `Try microphone again`; do not reprompt automatically. |
| Realtime credential/session fails | Retry/reconnect; keep confirmed local state; continue text-only if Brain works. |
| Realtime transcription fails | Keep raw audio unpersisted; offer `Record again` or typed Answer Draft; do not submit guessed text. |
| Spoken prompt fails | Keep detailed prompt visible and permit text/`Answer now`; label voice unavailable. |
| Brain timeout/provider error | Preserve confirmed turn and last valid Specification; offer retry. |
| Brain refusal/incomplete/invalid schema | One automatic repair retry, then typed recoverable error; render no invalid fields. |
| Stale Brain response | Discard by request/base revision; do not overwrite newer state. |
| sessionStorage invalid/expired | Delete checkpoint and start clean; never partially restore. |
| Markdown download/clipboard fails | Show selectable Markdown preview. |
| Live API failure | Offer retry or explicit `Restart in prepared demo`; never blend prepared output into Live. |
| Prepared audio fails | Continue deterministic text walkthrough silently. |

Realtime model capacity is an expected recoverable external error, not evidence that app context is full.

## 13. Accessibility, privacy, and browser requirements

Accessibility target: WCAG 2.2 AA on the critical path.

Required:

- Complete keyboard operation and visible focus.
- Correct labels, names, roles, and error associations.
- 44 px minimum pointer targets where practical.
- Contrast-compliant text and controls.
- Status conveyed with text/icons, not color alone.
- `prefers-reduced-motion` support.
- Persistent microphone and voice mute controls.
- Text equivalents for all audio and Visual Aids.
- Visual Aid accessible summary/list in DOM.
- Polite live-region announcements for prompt ready, transcript ready, validated update, and recoverable error.
- Do not announce every streaming transcript delta.
- Focus moves deliberately to Answer Draft and new prompt headings.
- No automatic microphone permission request or capture before consent.

Browser support:

- Primary: current desktop Chrome, demoed at 1280×720 or larger.
- Required text path: current desktop Edge and Safari.
- Responsive: usable down to 390 px.
- Voice on Edge/Safari, Firefox, and mobile is best-effort with immediate text fallback.
- Manual test echo cancellation, speaker playback, `Answer now`, and semantic VAD on the actual presentation device.

Privacy:

- Spec Grill app servers do not persist raw audio or session content.
- Confirmed revisions may live temporarily in expiring per-tab `sessionStorage`.
- Live data is processed by OpenAI under the project retention policy.
- Warn against confidential or regulated demo content.
- Do not claim ZDR without verification.

## 14. Milestones and definitions of done

### Milestone 0 — Foundation and contracts

Dependencies: none.

Deliver:

- Next.js strict TypeScript scaffold with npm.
- Shared Zod schemas/types, semantic-validator skeleton, IDs, initial state, and reducer events.
- Environment validation and Live kill switch.
- Test runners configured.

Definition of done:

- Install, lint, typecheck, unit-test placeholder, and production build commands run.
- Invalid fixtures fail validation; a minimal valid empty Specification passes.
- No secret appears in the browser bundle.

### Milestone 1 — Deterministic product shell and Demo Mode

Dependencies: Milestone 0.

Deliver:

- Three screen states and responsive layout.
- State reducer, checkpoint/restore, Final Review, Markdown export.
- Three Visual Aid renderers.
- Full prepared team-billing fixtures and local audio integration.

Definition of done:

- Prepared Demo completes without network or microphone.
- Every snapshot validates with the production schema.
- Draft/final Markdown downloads contain correct labels and sections.
- Keyboard-only prepared flow works.

### Milestone 2 — GPT-5.6 Brain

Dependencies: Milestone 0; integrate against Milestone 1 mocks.

Deliver:

- Brain prompt, `responses.parse` call, server request guards, schema validation, semantic validation, one-repair retry, typed errors, and provenance.
- Mock adapter for deterministic UI testing.

Definition of done:

- A confirmed typed answer produces a validated atomic revision and one next prompt.
- Invalid/refused/timed-out/stale responses never mutate visible state.
- Request uses runtime `gpt-5.6`, medium reasoning, Structured Outputs, and `store: false`.

### Milestone 3 — Realtime Communicator

Dependencies: Milestone 0; may proceed in parallel with Milestones 1 and 2 behind interfaces.

Deliver:

- Short-lived credential route.
- Native WebRTC transport adapter and validated event handling.
- Semantic VAD, `create_response: false`, `gpt-4o-transcribe`, transcript review, microphone track gating, out-of-band speech, reconnect, and `Answer now`.

Definition of done:

- Real microphone produces a reviewable Answer Draft without automatic Brain submission.
- The mic is disabled during speech/review/analyzing phases.
- A validated spoken prompt plays; text remains usable on Realtime failure.
- Standard API key is absent from browser/network responses.

### Milestone 4 — Integrated Live interview

Dependencies: Milestones 1–3.

Deliver:

- Full live voice and text cycles.
- Deferral, correction, convergence checkpoint, readiness, reversible finalization, provenance, and change highlighting.

Definition of done:

- Real seed request reaches the Brain only after PM confirmation.
- At least three consecutive turns preserve IDs and provenance.
- Voice failure degrades to Live text without switching data sources.
- PM can defer, correct, finalize, resume, and export.

### Milestone 5 — Resilience and accessibility

Dependencies: Milestone 4.

Deliver:

- All failure states, permission guidance, focus/live regions, reduced motion, mobile layout, and request hardening.

Definition of done:

- WCAG-oriented automated checks pass with documented manual exceptions.
- Mic denial, Realtime failure, invalid Brain output, stale response, expired checkpoint, and export fallback are verified.
- No invalid AI output renders.

### Milestone 6 — Verification, docs, and deployment

Dependencies: Milestone 5.

Deliver:

- Tests below, README, `.env.example`, Vercel instructions, actual Codex contribution record, and three-minute storyboard.

Definition of done:

- Lint, typecheck, unit/integration tests, Playwright critical suite, and production build pass.
- Optional live smoke passes when explicitly enabled with a real key.
- Manual Chrome voice checklist passes on presentation hardware.
- Vercel deployment shows Prepared Demo with Live disabled by default and can enable Live via server environment.
- No secret or prepared/live provenance ambiguity exists.

## 15. Test and verification plan

### Unit tests

- Every Zod schema accepts valid fixtures and rejects malformed data.
- Semantic validation covers duplicate/changed IDs, missing sources, bad readiness, multiple questions, invalid derivation, and diagram limits.
- Reducer rejects illegal transitions and stale responses.
- Checkpoint excludes drafts/secrets and expires correctly.
- Markdown section order, statuses, provenance, escaping, and filenames.
- Visual Aid fallback and accessible summaries.

### Integration tests

- Brain route with mocked OpenAI success, refusal, timeout, malformed output, repair success, repair failure, and rate limit.
- Realtime event parser with ordered and out-of-order transcript fixtures.
- Live UI against mocked Brain and Communicator transports.
- Demo fixture validation uses the same production code path.

### Playwright critical suite

Keep the suite intentionally small:

1. Complete Prepared Demo and verify downloaded Markdown.
2. Complete one mocked typed Live turn.
3. Receive, edit, and confirm a mocked transcription before Brain submission.
4. Recover from invalid Brain output without losing the last valid Specification.
5. Defer a prompt, finalize with follow-ups, resume, and export.

Use fake media only for UI/state plumbing. Do not make normal CI depend on OpenAI or physical audio.

### Accessibility verification

- axe scans for Start, Interview, Answer Draft, and Final Review states.
- Keyboard-only full Prepared Demo.
- Screen-reader spot-check for prompt, microphone status, transcript readiness, validation success, errors, and diagram alternatives.
- Contrast and reduced-motion review.

### Live and manual verification

- Opt-in live API smoke behind an explicit environment flag; never run by default.
- Desktop Chrome microphone permission allow/deny/retry.
- Real semantic turn completion with pauses and background noise.
- `Answer now`, echo cancellation, prompt playback completion, mic enable timing, reconnect, and text fallback.
- Representative ten-turn Brain run records latency; eight-second p95 is a design target, not a hackathon release gate.
- Test one capacity/rate-limit failure and explicit Prepared Demo restart.

### Required final commands

Use actual scripts defined in `package.json`; the intended gate is:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

## 16. Key risks and recommended resolutions

| Risk | Resolution |
|---|---|
| Realtime transcript differs from native model understanding | Treat `gpt-4o-transcribe` output as an editable draft; only confirmed text is authoritative. |
| VAD cuts off pauses or reacts to noise | Start semantic VAD at medium eagerness, preserve `Record again`, and test on presentation hardware. |
| No exact browser event proves remote audio has audibly drained | Keep mic disabled through `response.done` plus a short tested guard interval; provide `Answer now`; verify whether a documented playback event becomes available during implementation. |
| Realtime model adds words while speaking | Keep visible Brain prompt authoritative, instruct exact delivery with no context, cap response, observe transcript, and never use spoken output to mutate state. |
| Model IDs drift across full snapshots | Prompt to preserve IDs; enforce category/source/uniqueness semantics; use repair retry; reject drift. |
| Full-state requests grow | Bound the session to 30 minutes, checkpoint at ten turns, cap arrays/text lengths in schema, and avoid raw transcript/provider events. Do not add a database prematurely. |
| GPT-5.6 latency/capacity | Show honest progress, use medium effort, timeout safely, retain confirmed turn, retry, and keep Prepared Demo deterministic. |
| Vercel serverless instance changes | Keep Brain stateless and browser-authoritative; never rely on process memory. |
| Public endpoint can consume API budget | Live kill switch, controlled judging window, dedicated capped OpenAI project, origin/body/session guards. |
| `store: false` misunderstood as no provider retention | Use accurate privacy language and verify project ZDR separately if required. |
| Browser/mic incompatibility | Chrome primary, text always available, explicit permission/reconnect guidance. |
| Demo voice depends on an API | Commit prepared audio and continue silently if playback fails. |
| Scope expansion into real meeting/billing product | Enforce explicit non-goals and reject new integrations/auth/persistence in this implementation session. |

No product decisions remain open. Implementation-time verification is still required for current package versions, current Realtime event shapes, Vercel execution limits, and actual playback timing; use official documentation and preserve the agreed behavior if APIs have evolved.

## 17. Small Codex agent team

The root Codex agent is the integrator and creates four focused subagents. Agents may use task-appropriate available GPT variants: use the strongest reasoning model for cross-cutting architecture and difficult Realtime work; Terra/Luna-class variants are acceptable for bounded fixtures, UI, documentation, and tests. Runtime product models remain fixed as specified above.

### Root Integrator — `spec-grill-lead`

- **Role:** architecture owner, contract owner, integration, scope control, final verification.
- **Owned files:** root configs, `src/app/layout.tsx`, `src/app/page.tsx`, cross-module interfaces only when agreed, integration wiring.
- **Dependencies:** none initially; consumes every agent deliverable.
- **Deliverables:** scaffold, shared contracts frozen before parallel work, integration commits, final build/deploy verification.
- **Acceptance:** no overlapping ownership, no scope drift, all required commands pass, live/demo provenance remains correct.

### Agent 1 — `brain-api`

- **Role:** authoritative GPT-5.6 Brain and server validation.
- **Owned files:** `src/agents/brain/**`, `src/app/api/brain/route.ts`, Brain fixtures/tests, relevant portions of `src/domain/schemas.ts` coordinated with lead.
- **Dependencies:** lead-provided schema/interface freeze.
- **Deliverables:** prompt, Responses API call, Structured Outputs, semantic validation, repair retry, typed errors, model provenance.
- **Acceptance:** unconfirmed/demo input rejected; valid response is complete and atomic; invalid/refused/stale response cannot mutate state; `gpt-5.6` and `store: false` verified.

### Agent 2 — `realtime-voice`

- **Role:** Realtime Communicator transport and microphone lifecycle.
- **Owned files:** `src/realtime/**`, `src/agents/communicator/**`, `src/app/api/realtime/session/route.ts`, Realtime fixtures/tests.
- **Dependencies:** lead-provided transport interface and session events.
- **Deliverables:** secure credential minting, native WebRTC, VAD, transcription, audio playback, mic gating, reconnect, `Answer now`, mock transport.
- **Acceptance:** no standard key in client; no automatic response/Brain call; reviewed transcript boundary holds; text fallback survives transport failure.

### Agent 3 — `experience-demo`

- **Role:** accessible responsive product UI, deterministic demo, diagrams, and export.
- **Owned files:** `src/components/**`, `src/demo/**`, `src/export/**`, `public/demo-audio/**`, UI/component tests.
- **Dependencies:** lead's schemas/reducer interfaces; works initially with mocks.
- **Deliverables:** three screens, layout, all prompt/draft/final states, three diagram renderers, team-billing fixtures, local audio, Markdown actions.
- **Acceptance:** Prepared Demo works without AI/mic, every fixture validates, 390 px layout and keyboard path work, labels never imply live AI.

### Agent 4 — `verification-docs`

- **Role:** independent verification, accessibility, documentation, and demo evidence.
- **Owned files:** `tests/**`, `playwright.config.ts`, `vitest.config.ts`, `README.md`, `.env.example`, `docs/demo-video-storyboard.md`.
- **Dependencies:** stable mocks from all agents, then integrated app.
- **Deliverables:** unit/integration/E2E gates, manual checklist, setup/deployment docs, actual Codex contribution record, three-minute storyboard.
- **Acceptance:** required commands pass; failure paths and exports are asserted; README claims only completed work; live smoke is opt-in.

### Integration order

1. Root creates scaffold, schemas, reducer interfaces, route contracts, mocks, and file ownership map.
2. Brain, Realtime, and Experience agents work in parallel behind frozen interfaces.
3. Root integrates deterministic Demo/UI first.
4. Root integrates Brain API with typed text flow.
5. Root integrates Realtime transport and transcript review.
6. Verification agent runs against integrated app and reports actionable failures.
7. Owning agent fixes its module; root resolves only cross-module issues.
8. Root performs final security, provenance, scope, build, browser, and Vercel verification.

Agents must not concurrently edit the same shared file. Changes to frozen contracts require a root-approved interface update before dependent work continues.

## 18. Ready-to-paste kickoff prompt

Copy everything inside the following block into the next Codex implementation session:

```text
Build Spec Grill in this repository from the agreed planning documents. Begin by
reading AGENTS.md and following it, then read IMPLEMENTATION_HANDOFF.md completely,
CONTEXT.md, and every file in docs/adr/. Treat them as authoritative. Do not
reopen settled product decisions or expand the MVP.

The user will run this session with Codex YOLO permissions. Use that autonomy for
normal in-scope local work: edit files, install project dependencies, run local
servers, use browser automation, and execute verification without repeatedly
asking for permission. YOLO is execution permission, not authorization to expand
scope, invent secrets or decisions, purchase services, create accounts, weaken
security, or publish changes beyond the request.

Proceed while any safe in-scope work remains. If completion genuinely requires a
human-only action such as obtaining/configuring an OpenAI key, authenticating an
external account, accepting terms, selecting a paid plan, configuring DNS, or
granting a physical microphone permission, finish all mock/demo/non-live work
first. Then stop using the exact BLOCKED ON HUMAN format in AGENTS.md. Never ask
the user to paste a secret into chat, silently substitute prepared data into Live
Mode, or claim the blocked verification passed.

Create a small Codex agent team immediately:

1. brain-api — owns the GPT-5.6 Brain, /api/brain, Structured Outputs,
   semantic validation, repair retry, fixtures, and related tests.
2. realtime-voice — owns native Realtime WebRTC, the temporary credential route,
   semantic VAD, gpt-4o-transcribe Answer Drafts, microphone gating, prompt audio,
   reconnect, mocks, and related tests.
3. experience-demo — owns the three-screen responsive UI, accessibility,
   schema-rendered diagrams, deterministic team-billing demo, bundled audio,
   Final Review, and Markdown export.
4. verification-docs — owns unit/integration/Playwright verification,
   accessibility checks, README, environment/deployment instructions, actual
   Codex contribution documentation, and the three-minute video storyboard.

Act as the root integrator. Freeze shared Zod schemas, reducer events, API
contracts, transport interfaces, and file ownership before parallel work. Do not
allow agents to edit the same shared files concurrently. Assign task-appropriate
available models: use the strongest reasoning model for cross-cutting integration
and difficult Realtime work; GPT-5.6 Terra/Luna-class variants are acceptable for
bounded UI, fixtures, docs, and tests. These implementation-agent choices must not
change the runtime product models.

Preserve these hard runtime boundaries:

- Runtime Brain is server-side gpt-5.6 with medium reasoning, Responses API
  Structured Outputs, full confirmed state, and store:false.
- Runtime Communicator uses gpt-realtime-2.1 over native browser WebRTC.
- Realtime semantic VAD has create_response:false; it may not call the Brain.
- gpt-4o-transcribe creates an editable Answer Draft.
- Only explicit PM confirmation calls /api/brain.
- Every AI/API response is typed and validated before rendering or state mutation.
- The Brain returns a complete revision, not a patch, and at most one question.
- Standard OpenAI credentials remain server-side; the browser receives only a
  short-lived Realtime credential.
- Live AI and Prepared Demo data must never mix or look alike.
- No invalid response may replace the last valid Specification.

Implement incrementally by the dependency-ordered milestones in the handoff.
Start with contracts and a deterministic demo shell, then Brain, then Realtime,
then full integration and resilience. Keep the repository runnable after each
milestone. Use mocks so UI and tests do not require OpenAI. Do not add meeting
integrations, authentication, collaboration, database persistence, payments,
analytics, arbitrary model-authored markup, multilingual support, or other
non-goals.

Use the current stable Next.js/React/TypeScript ecosystem and verify exact OpenAI
API shapes against official documentation if they have changed. If an API detail
differs, preserve the agreed product behavior and approval boundaries. Never hide
or weaken a requirement merely to make an SDK easier to use.

Before declaring completion:

- verify Prepared Demo works without microphone or OpenAI calls;
- verify a real typed and voice Live turn reaches GPT-5.6 only after review;
- verify transcript editing, deferral, correction, readiness, reversible
  finalization, Next Actions, diagrams, provenance, and Markdown download;
- verify mic denial, Realtime failure, invalid/refused/stale Brain responses,
  expired checkpoints, and explicit Demo restart;
- run lint, strict typecheck, unit/integration tests, the small Playwright suite,
  accessibility checks, and a production build;
- run the opt-in live smoke only when a key and permission are explicitly
  available;
- manually verify Chrome microphone/playback behavior on the demo device;
- inspect the client bundle and network responses for leaked secrets;
- update README and the video storyboard with what Codex actually built and
  verified, not merely what was planned;
- report exact commands, results, remaining risks, and deployment steps.

Do not stop at scaffolding. Finish and verify the complete agreed MVP while a
safe in-scope implementation or validation step remains.
```
