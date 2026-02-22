/**
 * Shared Context
 *
 * Thread-safe shared memory for inter-agent communication.
 * Supports versioning and conflict detection.
 */

import { EventEmitter } from 'events';

export interface ContextEntry {
  key: string;
  value: unknown;
  version: number;
  updatedBy: string;
  updatedAt: Date;
}

export class SharedContext extends EventEmitter {
  private store: Map<string, ContextEntry> = new Map();
  private locks: Map<string, { agentId: string; acquiredAt: number }> = new Map();
  private lockTtlMs = 60_000; // Lock expires after 60s

  /**
   * Get a value
   */
  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined;
  }

  /**
   * Set a value with conflict detection
   */
  set(key: string, value: unknown, agentId: string, expectedVersion?: number): boolean {
    const existing = this.store.get(key);

    // Version conflict check
    if (expectedVersion !== undefined && existing && existing.version !== expectedVersion) {
      this.emit('conflict', { key, agentId, expectedVersion, actualVersion: existing.version });
      return false;
    }

    // Lock check
    const lockHolder = this.locks.get(key);
    if (lockHolder && lockHolder.agentId !== agentId) {
      // Check if lock is stale
      if (Date.now() - lockHolder.acquiredAt <= this.lockTtlMs) {
        this.emit('lock-blocked', { key, agentId, lockHolder: lockHolder.agentId });
        return false;
      }
      this.locks.delete(key); // Stale lock
    }

    const entry: ContextEntry = {
      key,
      value,
      version: (existing?.version || 0) + 1,
      updatedBy: agentId,
      updatedAt: new Date(),
    };

    this.store.set(key, entry);
    this.emit('updated', entry);
    return true;
  }

  /**
   * Lock a key for exclusive access
   */
  lock(key: string, agentId: string): boolean {
    const existing = this.locks.get(key);
    if (existing) {
      // Allow stale lock to be reclaimed
      if (Date.now() - existing.acquiredAt > this.lockTtlMs) {
        this.locks.delete(key);
      } else {
        return false;
      }
    }
    this.locks.set(key, { agentId, acquiredAt: Date.now() });
    return true;
  }

  /**
   * Unlock a key
   */
  unlock(key: string, agentId: string): boolean {
    const existing = this.locks.get(key);
    if (!existing || existing.agentId !== agentId) return false;
    this.locks.delete(key);
    return true;
  }

  /**
   * Get version of a key
   */
  getVersion(key: string): number {
    return this.store.get(key)?.version || 0;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Get all entries
   */
  entries(): ContextEntry[] {
    return Array.from(this.store.values());
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Delete a key
   */
  delete(key: string): boolean {
    this.locks.delete(key);
    return this.store.delete(key);
  }

  /**
   * Clear all
   */
  clear(): void {
    this.store.clear();
    this.locks.clear();
  }

  /**
   * Get snapshot for serialization
   */
  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of this.store) {
      result[key] = entry.value;
    }
    return result;
  }
}
