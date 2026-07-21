# Spec Grill

Spec Grill turns an imprecise product request into an implementation-ready specification through a focused AI-led interview.

## Language

**Product Manager**:
The solo person using the MVP to supply known product intent, confirm requirements, and identify decisions that must be taken elsewhere.
_Avoid_: Attendee, participant, Stakeholder

**Decision Owner**:
A person or group outside the MVP Interview Session whose authority or expertise is needed to resolve an Open Question or Blocker.
_Avoid_: User, attendee, approver

**Interview Session**:
One time-bounded browser session in which a Product Manager answers the AI interviewer and develops a single Specification. In hackathon Live Mode it may be bound to one locally persisted Codex Brain Session, but it is not a shared meeting room.
_Avoid_: Meeting, call, workspace

**Codex Brain Session**:
The locally persisted Codex SDK thread used by the hackathon Live Brain across confirmed submissions. Its memory is supporting context; only a validated complete Brain revision may replace the browser's Specification.
_Avoid_: Database, source of truth, shared workspace

**Session Link**:
A local URL that identifies one Codex Brain Session and its matching unexpired browser checkpoint. It is a same-machine hackathon resume aid, not an authenticated, cross-device, or durable sharing link.
_Avoid_: Share link, collaboration link, permanent URL

**Live Mode**:
An Interview Session driven by the Product Manager's real input and genuine AI service calls. Its outputs are identified as live AI results.
_Avoid_: Production mode, normal mode

**Prepared Demo**:
An explicit deterministic walkthrough driven by the prepared team-billing transcript and prevalidated Specification snapshots, without AI or microphone dependencies. Its outputs are always identified as demo data and never mixed into a Live Mode Specification.
_Avoid_: Offline AI, mock AI, fallback AI

**Voice Turn**:
A Product Manager answer captured after the Interview Session begins and automatically bounded when the Product Manager finishes speaking. It does not require push-to-talk, but its transcription must be confirmed before reaching the Brain.
_Avoid_: Recording, voice message, audio clip

**Answer Draft**:
The editable finalized transcription or typed response held by the Communicator for Product Manager review while microphone capture is paused. It is not yet a product decision and is never sent to the Brain automatically.
_Avoid_: Decision, requirement, final answer

**Confirmed Answer**:
An Answer Draft the Product Manager has explicitly approved for submission to the Brain. It is one kind of Confirmed Input; only a validated Brain revision may change the Specification.
_Avoid_: Transcript, message, raw input

**Confirmed Input**:
Product Manager-approved context, answers, corrections, Decision Summaries, or deferrals that have passed every required confirmation and dependency-revalidation gate. Only Confirmed Input may be submitted to the Brain as authoritative product intent, and only a validated complete Brain revision may change the Specification.
_Avoid_: Transcript, draft, extracted text, search result

**Correction**:
A Product Manager-confirmed challenge to an existing Specification statement that the Brain processes as the next authoritative operation after any in-flight request terminates. It pauses asynchronous question promotion and is not a direct edit to the Specification.
_Avoid_: Inline edit, patch, Communicator correction

**Session Data**:
The audio, conversation, context, Decision Tray, and Specification information used within one Interview Session. Spec Grill does not persist it to a database or retain raw audio; the hackathon Live path may retain confirmed Brain inputs and outputs inside its local Codex Brain Session, while the browser checkpoints only validated confirmed state and bounded queued decisions until Reset, finalized exit, or expiry.
_Avoid_: Account data, saved project, recording archive

**Interview Prompt**:
The Communicator's single current question. It has a concise spoken form and a detailed visible form that may include context, a grounded AI recommendation, or a Visual Aid, but both forms ask for the same decision; absent sufficient confirmed evidence, it presents no recommendation.
_Avoid_: Question list, questionnaire, agenda

**Project Context Digest**:
The editable, source-linked distillation of pasted or uploaded project context that becomes Confirmed Input only after Product Manager approval. It preserves explicit source statements without automatically confirming interpretations or the entire source document as requirements.
_Avoid_: File summary, imported specification, confirmed document

**Question Roadmap**:
The Brain's internal, prioritized model of unresolved decisions and their dependencies. It supports future-question planning and safe lookahead selection but is not a questionnaire shown to the Product Manager.
_Avoid_: Question list, interview script, agenda

**Interview Window**:
A bounded set of zero to three pairwise-independent Question Permits issued by the Brain for use while authoritative Brain work continues. It preserves one visible active question and does not expose a questionnaire to the Product Manager.
_Avoid_: Question list, parallel interview, backlog

**Question Permit**:
The Brain's revision-bound and dependency-bound authorization to ask one Question Roadmap decision during an Interview Window. A permit does not authorize the Communicator to invent, replace, reorder, or broaden the decision.
_Avoid_: Communicator question, suggestion, autonomous follow-up

**Interview Job**:
The lifecycle record for one Question Permit as it moves through presentation, clarification, confirmation, dependency revalidation, application, or a terminal Not Applied outcome. Only a job that reached presentation is PM-engaged.
_Avoid_: Question, Brain request, conversation

**Revalidation Pending**:
A non-authoritative asynchronous decision or captured response preserved while its Question Permit is checked against the latest Question Roadmap and dependency state. It cannot be confirmed, submitted, or applied until revalidation succeeds.
_Avoid_: Queued decision, confirmed answer, processing result

**Lookahead Question**:
One Brain-approved Interview Prompt that the Communicator may present from a Question Permit while the Brain processes prior confirmed input because its decision is independent of that work. Its approval is revision- and dependency-bound and may become stale.
_Avoid_: Parallel question, speculative question, next question

**Clarification Exchange**:
A natural voice or text exchange in which the Communicator resolves ambiguity within one active Brain-approved decision without changing topics or making product decisions.
_Avoid_: Brain turn, side conversation, follow-up interview

**Decision Summary**:
The concise, editable statement produced after a Clarification Exchange. It is non-authoritative until the Product Manager explicitly confirms it and it passes fresh Question Permit, revision, and dependency revalidation before Brain submission.
_Avoid_: Transcript, Answer Draft, Communicator decision

**Decision Batch**:
An ordered set of one to three individually confirmed and freshly revalidated asynchronous decisions submitted together for one authoritative Brain revision. The batch applies atomically and preserves each decision as a separate provenance source, including when decisions contradict.
_Avoid_: Bulk confirmation, merged answer, concurrent revision

**Decision Tray**:
The visible session-local view of asynchronous Interview Jobs as Draft, awaiting dependency check, ready to apply, applying, applied, or Not Applied. Applied and Not Applied outcomes remain through Final Review within the active Interview Session, but the tray is not part of the authoritative Specification or its Markdown export.
_Avoid_: Specification section, questionnaire, persistent work queue

**Stale Lookahead**:
A Lookahead Question or queued Decision Summary whose approval no longer matches the latest validated Question Roadmap or dependency state. It receives a dependency-invalidated Not Applied outcome and cannot change the Specification.
_Avoid_: Failed answer, rejected decision, deferred prompt

**Not Applied**:
A terminal Interview Job outcome stating that its wording did not change the Specification because dependencies invalidated it, its batch failed, the application stopped waiting and attempted cancellation, the PM abandoned it, or newer work superseded it. Its required reason distinguishes work the Brain never received from work it may have processed without producing an applied revision; it never claims provider execution stopped.
_Avoid_: Rejected decision, failed answer, stale

**Deferred Prompt**:
A Product Manager-confirmed decision to leave an Interview Prompt or permitted asynchronous decision unanswered for later resolution, optionally with a note. When created during an Interview Window it is freshly dependency-revalidated and may join a Decision Batch, but only the Brain may turn it into an Open Question, Blocker, or Next Action; it never becomes a Confirmed Answer.
_Avoid_: Skipped answer, implicit decision

**Visual Aid**:
An optional schema-driven diagram that clarifies the actors, relationships, flow, or states relevant to the current Interview Prompt. It is application-rendered and never arbitrary model-authored executable markup.
_Avoid_: AI image, generated HTML, generated SVG

**Communicator**:
The interviewing agent that presents one Interview Prompt at a time in accessible spoken and visible forms without inventing Product Manager decisions.
_Avoid_: Host, assistant, moderator

**Brain**:
The analysis agent that maintains the Specification, identifies its most important unresolved issue, and supplies the next Interview Prompt to the Communicator.
_Avoid_: Interviewer, narrator

**Specification**:
The structured, evolving statement of the product problem, requirements, assumptions, risks, open questions, and acceptance criteria produced during an Interview Session.
_Avoid_: Notes, transcript, summary

**Readiness**:
The Brain's evidence-based assessment of a Specification as `draft`, `blocked`, `ready_with_follow_ups`, or `ready`. It is categorical rather than a synthetic percentage and never prevents the Product Manager from finalizing with unresolved work visible.
_Avoid_: Completion score, confidence score, progress percentage

**Persistent Brain Status**:
The continuously visible, truthful state of authoritative Brain work, including its elapsed time and the age of its last verified lifecycle activity. It distinguishes active, delayed, interrupted, failed, applied, and stopped work without invented percentages, stages, or completion estimates.
_Avoid_: Spinner, loader, progress percentage, estimated completion

**Brain Lifecycle Event**:
A content-free, request-bound observation that advances Persistent Brain Status without carrying Product Manager input, model output, provider identifiers, or Specification content. It is operational evidence rather than a product decision or partial Brain result.
_Avoid_: Progress estimate, partial answer, model reasoning

**External Evidence**:
A source-titled, URL-linked, retrieval-dated public reference found through controlled search and shown wherever it informs a recommendation or proposed Specification content. It is supporting context, never Confirmed Input, and cannot independently make an item `confirmed` or `derived`.
_Avoid_: Confirmed fact, imported requirement, hidden research

**Specification Item**:
One traceable statement within a Specification, carrying source-turn references and a status of `confirmed`, `derived`, `proposed`, or `unresolved`. Only the Product Manager can authorize a product decision as `confirmed`; `derived` content must be logically entailed by confirmed decisions.
_Avoid_: Fact, AI answer, bullet

**Acceptance Criterion**:
A uniquely identified, source-linked, test-ready condition that demonstrates a requirement is satisfied. Behavioral criteria use Given/When/Then; non-functional criteria use measurable assertions, and unresolved behavior remains visibly provisional.
_Avoid_: Requirement, test case, success metric

**Open Question**:
An unresolved issue that should be answered but does not prevent the current Specification from being handed to implementation.
_Avoid_: Blocker, prompt, concern

**Blocker**:
An unresolved decision, dependency, or validation need that prevents the Specification from being implementation-ready.
_Avoid_: Open Question, risk, bug

**Next Action**:
A concrete follow-up after the Interview Session, with an intended outcome, that resolves or reduces an Open Question or Blocker. The Brain may suggest a role-based Decision Owner, but ownership remains provisional until the Product Manager confirms it.
_Avoid_: Requirement, task, reminder
