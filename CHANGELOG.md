# Changelog

## V2 approved requirement — not yet implemented

- Add a reviewed Project Context Digest from a large Markdown/plain-text editor or one `.md`, `.txt`, `.pdf`, or `.docx` file before the interview starts.
- Treat only PM-confirmed digest statements as Confirmed Input, with source provenance and explicit extraction coverage warnings.
- Have the Brain maintain an internal prioritized Question Roadmap with dependencies and approve no more than one independent Lookahead Question during an in-flight Brain revision.
- Allow the Communicator to clarify that one decision naturally and produce an editable, non-authoritative Decision Summary.
- Queue a PM-confirmed Decision Summary until the authoritative Brain revision applies and dependency revalidation succeeds; quarantine stale work as `not applied`.
- Show truthful topical and processing-stage progress when no safe lookahead exists.
- Keep original uploads, full extractions, durable provider file objects, multiple-file workflows, databases, and persistent document search out of scope.
- Extend Prepared Demo to prove context preparation, lookahead, summary confirmation, progress, and staleness without OpenAI, microphone, or user-file dependencies.

The complete approved handoff and acceptance criteria are in `V2_IMPLEMENTATION_HANDOFF.md`.

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
