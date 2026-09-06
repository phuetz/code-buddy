/**
 * Persistence seam. The core owns no filesystem, no database and no network:
 * a host supplies a `KeyValueStore`. The package ships an in-memory one; a host
 * writes its own (atomic JSON files, a SQL table, …) behind the same three
 * methods.
 *
 * @module runtime/store
 */

/** The only persistence contract the core knows about. */
export interface KeyValueStore {
  /** The stored value, or null when the key is absent or unreadable. */
  get<T>(key: string): Promise<T | null>;
  /** Replace the value at `key`. */
  set<T>(key: string, value: T): Promise<void>;
  /** Remove the key. Absent keys are not an error. */
  delete(key: string): Promise<void>;
}

/** In-memory store — the default, and the test double. Values are deep-copied. */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly entries = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.entries.get(key);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  /** Keys currently held — for host diagnostics and tests only. */
  keys(): string[] {
    return [...this.entries.keys()].sort();
  }
}
