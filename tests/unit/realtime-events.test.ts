import { describe, expect, it } from "vitest";

import events from "../fixtures/realtime-events.json";
import { parseRealtimeServerEvent } from "@/realtime/realtime-event-schemas";

describe("Realtime provider event validation", () => {
  it("validates the consumed ordered event subset", () => {
    for (const event of events.ordered) {
      expect(parseRealtimeServerEvent(event).success).toBe(true);
    }
  });

  it("keeps item IDs on out-of-order transcript completions", () => {
    const parsed = events.outOfOrderCompletions.map(parseRealtimeServerEvent);
    expect(parsed.every((result) => result.success)).toBe(true);
    expect(
      parsed.map((result) => (result.success && "item_id" in result.event ? result.event.item_id : null)),
    ).toEqual(["item_B", "item_A"]);
  });

  it("rejects malformed known events and ignores unsupported events", () => {
    expect(parseRealtimeServerEvent(events.invalid)).toEqual({
      success: false,
      reason: "invalid",
    });
    expect(parseRealtimeServerEvent({ type: "rate_limits.updated" })).toEqual({
      success: false,
      reason: "unsupported",
    });
  });
});
