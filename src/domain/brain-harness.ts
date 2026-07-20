import type { BrainLifecycleEvent, V3BrainRequest, V3BrainResponse } from "./v3-schemas";

export type BrainHarnessEvent =
  | { type: "lifecycle"; event: BrainLifecycleEvent }
  | { type: "result"; response: V3BrainResponse };

/** Server-only adapter boundary. Implementations must emit the same validated,
 * complete V3 contract and may not retain hidden authoritative state. */
export interface BrainHarness {
  run(input: V3BrainRequest, signal: AbortSignal): AsyncIterable<BrainHarnessEvent>;
}

