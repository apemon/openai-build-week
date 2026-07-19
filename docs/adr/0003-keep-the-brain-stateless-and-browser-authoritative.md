# Keep the Brain stateless and browser-authoritative

The browser owns the revisioned conversation and Specification, checkpoints only confirmed revisions in expiring per-tab storage, and sends a complete snapshot with every Brain request; the server calls GPT-5.6 with `store: false` and returns a complete validated replacement snapshot. This avoids an always-on agent process or database while making serverless deployment, retries, stale-response rejection, and deterministic Demo Mode straightforward, at the accepted cost of resending bounded session context on each turn.
