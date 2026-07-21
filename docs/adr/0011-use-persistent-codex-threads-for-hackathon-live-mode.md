---
status: accepted
---

# Use persistent Codex threads for hackathon Live Mode

For the hackathon build, Spec Grill will run the authoritative Live Brain through the server-side Codex SDK and resume one locally persisted Codex thread across confirmed Brain submissions. This deliberately supersedes ADR-0003's stateless Brain and ADR-0004's evaluation-only Codex boundary for the hackathon path because a visible resumable agent session is more valuable for the demonstration than serverless portability; the browser still sends the complete confirmed snapshot, validates every complete revision, and preserves the last valid Specification.

The existing `/api/brain` route remains the only credential and streaming boundary, and no database, KV store, account system, or separate backend service is added. The opaque Codex thread ID is returned only in a validated terminal response, bound to the browser's sanitized checkpoint, and used to form a local Session Link. Possession of that link is sufficient to identify the local hackathon thread, so it is not an authenticated collaboration link. Resume works only while the same machine retains the Codex session store and the browser retains the matching unexpired checkpoint; it is not promised across browsers, devices, serverless instances, or deployments.

Codex runs server-side with read-only filesystem access, an empty working directory, network and public search disabled, no approvals, structured output, deterministic semantic validation, one bounded repair, one active turn per thread, and content-free lifecycle events. Prepared Demo remains isolated. This mode makes no `store:false`, Zero Data Retention, provider-cancellation, thread-deletion, cross-instance durability, or production-readiness claim, and any interrupted or terminally invalid thread is quarantined rather than resumed.
