const DEFAULT_PROVIDER_EVENT_ID_CAPACITY = 512;

/** Session-local bounded replay protection. Provider IDs never leave the
 * transport boundary and are discarded on reconnect. */
export class BoundedEventIdSet {
  private readonly ids = new Set<string>();

  constructor(private readonly capacity = DEFAULT_PROVIDER_EVENT_ID_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Provider event deduplication capacity must be a positive integer.");
    }
  }

  addIfNew(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.ids.clear();
  }

  get size(): number {
    return this.ids.size;
  }
}
