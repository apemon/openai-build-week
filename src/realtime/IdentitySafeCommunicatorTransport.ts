import type { ExchangeIdentity } from "@/domain/v3-schemas";

import type { V3CommunicatorTransport } from "./CommunicatorTransport";

/** Owned extension for identity-safe authoritative/app prompt playback. The
 * shared V3 interface covers permitted questions; root orchestration can use
 * this capability without weakening the frozen shared contract. */
export interface IdentitySafeCommunicatorTransport extends V3CommunicatorTransport {
  speakPromptWithIdentity(identity: ExchangeIdentity, spokenQuestion: string): void;
  cancelAuthoritativeExchange(identity: ExchangeIdentity, nextCancelEpoch: number): void;
}
