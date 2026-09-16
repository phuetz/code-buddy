/**
 * Durable per-session goal persistence.
 *
 * One JSON file per session key under `~/.codebuddy/goals/` (honors
 * CODEBUDDY_HOME). Files are tiny (<1 KB) so I/O is synchronous — same
 * trade-off as TodoTracker. Writes are atomic (tmp + rename). Loads are
 * fail-soft: a corrupt or unreadable file reads as "no goal".
 *
 * Cleared goals keep a tombstone (`status: 'cleared'`) for audit, mirroring
 * Hermes' SessionDB behavior.
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import { logger } from '../utils/logger.js';
import { GoalState, normalizeGoalState } from './goal-state.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export interface GoalStoreOptions {
  /** Override the storage directory (test isolation). */
  storeDir?: string;
}

export class GoalStore {
  private storeDir: string;

  constructor(options: GoalStoreOptions = {}) {
    this.storeDir = options.storeDir ?? getCodeBuddyPath('goals');
  }

  getStoreDir(): string {
    return this.storeDir;
  }

  load(key: string): GoalState | null {
    if (!key) return null;

    for (const file of this.fileCandidatesForRead(key)) {
      try {
        if (!fs.existsSync(file)) continue;
        const raw = readJsonAtomicSync<unknown | null>(file, null, { mode: 0o600 });
        return raw === null ? null : normalizeGoalState(raw);
      } catch (error) {
        logger.debug('GoalStore: failed to load goal state', { key, file, error: String(error) });
      }
    }

    return null;
  }

  save(key: string, state: GoalState): void {
    if (!key) return;
    const file = this.fileFor(key);
    try {
      writeJsonAtomicSync(file, state, { mode: 0o600 });
    } catch (error) {
      logger.debug('GoalStore: failed to save goal state', { key, error: String(error) });
    }
  }

  delete(key: string): void {
    if (!key) return;

    for (const file of this.fileCandidatesForRead(key)) {
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        logger.debug('GoalStore: failed to delete goal state', { key, file, error: String(error) });
      }
    }
  }

  private fileFor(key: string): string {
    const label = this.fileLabel(key);
    const digest = createHash('sha256').update(key).digest('hex').slice(0, 16);
    return path.join(this.storeDir, `${label}-${digest}.json`);
  }

  private fileCandidatesForRead(key: string): string[] {
    return Array.from(new Set([this.fileFor(key), this.legacyFileFor(key)]));
  }

  private legacyFileFor(key: string): string {
    // Session ids and dir-hash keys are already filesystem-safe; sanitize
    // anyway so a malformed key can't escape the store directory.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.storeDir, `${safe}.json`);
  }

  private fileLabel(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_').slice(0, 80);
    return safe || 'goal';
  }
}
