import { describe, expect, it } from "vitest";

import { BoundedEventIdSet } from "./bounded-event-id-set";

describe("BoundedEventIdSet", () => {
  it("deduplicates within its bound and evicts the oldest provider ID", () => {
    const ids = new BoundedEventIdSet(2);

    expect(ids.addIfNew("event-1")).toBe(true);
    expect(ids.addIfNew("event-1")).toBe(false);
    expect(ids.addIfNew("event-2")).toBe(true);
    expect(ids.addIfNew("event-3")).toBe(true);
    expect(ids.size).toBe(2);
    expect(ids.addIfNew("event-1")).toBe(true);
  });
});
