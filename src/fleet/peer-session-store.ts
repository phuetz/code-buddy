/**
 * Peer chat-session disk-backed store (Fleet V1.2-saga / Phase d.22).
 *
 * Persists `peer.chat-session.*` state across restarts. Mirror of the
 * lockfile + atomic-rename pattern used by `saga-store.ts`, but with a
 * schema dedicated to multi-turn conversations (no DispatchPlan, no
 * lanes — just systemPrompt + alternating user/assistant messages).
 *
 * Storage layout:
 *
 *   ~/.codebuddy/peer-sessions/
 *     <sessionId>.json    — one file per session
 *     <sessionId>.lock    — PID-based lock (reuses session-lock.ts)
 *
 * Cross-restart contract:
 *   - On boot, `peer-session-bridge` calls `loadAll()` and replays
 *     sessions younger than the configured idle TTL into its in-memory
 *     map. Older sessions are purged via `purgeExpired()`.
 *   - During the lifetime, `save()` is called after every successful
 *     `peer.chat-session.continue` (so the disk reflects the model's
 *     view of the conversation). `delete()` is called on
 *     `peer.chat-session.end`.
 *
 * Single-process by design: two `buddy server` processes sharing the
 * same `~/.codebuddy/peer-sessions/` is not supported (matches
 * `peer.chat-session.*` in-memory semantics — one peer = one process).
 *
 * @module fleet/peer-session-store
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withSessionLock } from '../persistence/session-lock.js';
import { logger } from '../utils/logger.js';
import type { GoalState } from '../goals/goal-state.js';
import type {
  FleetDispatchProfile,
  FleetHermesToolsetDescriptor,
  FleetDispatchToolDecision,
  FleetDispatchToolPolicy,
} from './dispatch-profile.js';

export interface PersistedChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PersistedChatSession {
  sessionId: string;
  systemPrompt: string;
  /** Exact backend pinned for this session. Absent in legacy records. */
  provider?: string;
  model?: string;
  dispatchProfile?: FleetDispatchProfile;
  toolPolicy?: FleetDispatchToolPolicy;
  toolDecisions?: FleetDispatchToolDecision[];
  toolset?: FleetHermesToolsetDescriptor;
  /** User/assistant turns (system prompt is held separately). */
  messages: PersistedChatMessage[];
  /** Standing goal attached via `peer.chat-session.goal` (Hermes gateway parity). */
  goal?: GoalState;
  createdAt: number;
  lastUsedAt: number;
}

export interface PeerSessionStoreConfig {
  /** Override the default `~/.codebuddy/peer-sessions/` directory. */
  storeDir?: string;
}

/**
 * Disk-backed registry for `peer.chat-session.*` state. Pattern copied
 * from `SagaStore` — the storage discipline is identical, only the
 * record schema differs.
 */
export class PeerSessionStore {
  private readonly dir: string;

  constructor(config: PeerSessionStoreConfig = {}) {
    this.dir = config.storeDir ?? this.defaultDir();
    this.ensureDir();
  }

  /** Persist a session record atomically. Replaces any existing file. */
  async save(session: PersistedChatSession): Promise<void> {
    const file = this.fileFor(session.sessionId);
    await withSessionLock(file, async () => {
      await this.writeUnlocked(session);
    });
  }

  /** Read a session by id. Returns null if absent or unreadable. */
  async load(sessionId: string): Promise<PersistedChatSession | null> {
    const file = this.fileFor(sessionId);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = await fs.promises.readFile(file, 'utf-8');
      return JSON.parse(raw) as PersistedChatSession;
    } catch (err) {
      logger.warn?.('[peer-session-store] failed to read session', {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Read every session on disk. Skips files that fail to parse so a
   * single corrupt entry doesn't break boot. Returned in arbitrary
   * order — callers that care should sort by `lastUsedAt`.
   */
  async loadAll(): Promise<PersistedChatSession[]> {
    let files: string[];
    try {
      files = await fs.promises.readdir(this.dir);
    } catch (err) {
      logger.warn?.('[peer-session-store] failed to read store directory', {
        dir: this.dir,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
    const records: PersistedChatSession[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const r = await this.load(id);
      if (r) records.push(r);
    }
    return records;
  }

  /**
   * Remove a session file (and its lockfile). Returns false when the
   * file did not exist — callers can use this to make `end` idempotent.
   */
  async delete(sessionId: string): Promise<boolean> {
    const file = this.fileFor(sessionId);
    if (!fs.existsSync(file)) return false;
    try {
      await fs.promises.unlink(file);
    } catch (err) {
      logger.warn?.('[peer-session-store] failed to unlink session', {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    const lock = file + '.lock';
    if (fs.existsSync(lock)) {
      try {
        await fs.promises.unlink(lock);
      } catch {
        /* lock might be held by another process */
      }
    }
    return true;
  }

  /**
   * Drop sessions whose `lastUsedAt` is older than `now - idleMs`.
   * Returns the ids that were removed. Used at boot to GC zombies and
   * by `peer-session-bridge.purgeExpired()` for the running peer.
   */
  async purgeExpired(now: number, idleMs: number): Promise<string[]> {
    const all = await this.loadAll();
    const dropped: string[] = [];
    for (const s of all) {
      if (now - s.lastUsedAt > idleMs) {
        const ok = await this.delete(s.sessionId);
        if (ok) dropped.push(s.sessionId);
      }
    }
    return dropped;
  }

  // ─────────── Internals ───────────

  private defaultDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, '.codebuddy', 'peer-sessions');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private fileFor(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.json`);
  }

  private async writeUnlocked(record: PersistedChatSession): Promise<void> {
    const file = this.fileFor(record.sessionId);
    const tmp = `${file}.tmp.${process.pid}`;
    await fs.promises.writeFile(tmp, JSON.stringify(record, null, 2));
    await fs.promises.rename(tmp, file);
  }
}

let cachedStore: PeerSessionStore | null = null;

/** Process-wide store. Created on first access. */
export function getPeerSessionStore(): PeerSessionStore {
  if (!cachedStore) cachedStore = new PeerSessionStore();
  return cachedStore;
}

/**
 * Test-only — drop the singleton + replace it with a store rooted at
 * the given directory. Lets unit tests isolate disk effects to a tmpdir
 * without touching the real `~/.codebuddy/`.
 */
export function _setPeerSessionStoreForTests(store: PeerSessionStore | null): void {
  cachedStore = store;
}

/** Test-only — drop the singleton entirely. */
export function resetPeerSessionStore(): void {
  cachedStore = null;
}
