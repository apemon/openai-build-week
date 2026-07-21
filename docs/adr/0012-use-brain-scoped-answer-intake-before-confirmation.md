---
status: accepted
---

# Use Brain-scoped Answer Intake before confirmation

Spec Grill V3.1 will replace the direct transcription-to-Answer-Draft path with a bounded Answer Intake. Every Interview Prompt carries one to five Brain-authored Answer Aspects. The Communicator may classify only those aspects as covered, missing, or uncertain from up to three Product Manager voice or text contributions, ask at most one short clarification at a time about explicitly missing or uncertain aspects, and produce one concise editable Answer Summary. It cannot invent an aspect, change the decision, claim Brain validation, confirm wording, or submit to the Brain. Unresolved aspects remain visible when the clarification bound is reached or the Product Manager chooses to review early.

Realtime assessment uses an identity-bound out-of-band `response.create` with `conversation: "none"`, bounded explicit input, text-only output, and correlation metadata. Semantic VAD retains `create_response: false`; the application alone requests assessment or exact clarification playback. Raw Answer Intake remains memory-only and is excluded from Brain requests, checkpoints, logs, exports, and Codex session links. Only the Product Manager-edited and explicitly confirmed Answer Summary becomes a Confirmed Answer.

While an authoritative Brain request runs, the application may promote the next unused permit from the already validated Interview Window after the active asynchronous job is confirmed or deferred. Promotion remains sequential, is allowed only for the exact in-flight operation and cancellation epoch, stops when permits are exhausted or questions are paused, and never creates a second Brain request. A validated revision still applies first and forces fresh revalidation of unfinished work.
