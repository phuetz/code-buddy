/**
 * Ghost Snapshots — Git-based automatic workspace undo
 *
 * Before each agent turn, creates an automatic Git commit capturing
 * the workspace state. Enables single-command undo to any previous turn.
 *
 * Uses a shadow branch (.codebuddy/ghost) to avoid polluting the user's
 * git history. Ghost commits are lightweight stash-like references.
 *
 * Inspired by OpenAI Codex CLI's ghost_snapshot.rs
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/** Git ref namespace for ghost snapshots */
const GHOST_REF_PREFIX = 'refs/codebuddy/ghost/';

/** Maximum time for a ghost snapshot operation (ms) */
const SNAPSHOT_TIMEOUT_MS = 240_000;

/** Maximum number of ghost snapshots to keep */
const MAX_GHOST_SNAPSHOTS = 50;

// ============================================================================
// Types
// ============================================================================

export interface GhostSnapshot {
  /** Unique snapshot ID (ISO timestamp) */
  id: string;
  /** Git commit hash */
  commitHash: string;
  /** Human-readable description */
  description: string;
  /** Timestamp */
  timestamp: Date;
  /** Turn number */
  turn: number;
}

// ============================================================================
// Ghost Snapshot Manager
// ============================================================================

export class GhostSnapshotManager {
  private cwd: string;
  private turnCounter = 0;
  private snapshots: GhostSnapshot[] = [];
  private redoStack: GhostSnapshot[] = [];
  private currentIndex = -1;
  private isGitRepo = false;
  private initialized = false;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /**
   * Initialize — check if we're in a git repo.
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return this.isGitRepo;
    this.initialized = true;

    try {
      await this.git(['rev-parse', '--git-dir']);
      this.isGitRepo = true;
      return true;
    } catch {
      this.isGitRepo = false;
      return false;
    }
  }

  /**
   * Create a ghost snapshot before a turn.
   * Returns the snapshot info, or null if not in a git repo.
   */
  async createSnapshot(description?: string): Promise<GhostSnapshot | null> {
    if (!await this.initialize()) return null;

    this.turnCounter++;
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    // Sanitize description: cap length, strip control chars
    const rawDesc = description ?? `Turn ${this.turnCounter}`;
    // eslint-disable-next-line no-control-regex
    const desc = rawDesc.substring(0, 200).replace(/[\x00-\x1f\x7f]/g, '');

    try {
      // The common case between turns is a clean workspace. Check it before
      // touching the index so large repositories avoid an unnecessary
      // `git add -A` on the first-token critical path.
      const status = await this.git(['status', '--porcelain']);
      if (!status.trim()) {
        // No changes — create a reference to HEAD
        const headHash = (await this.git(['rev-parse', 'HEAD'])).trim();
        const snapshot: GhostSnapshot = {
          id, commitHash: headHash, description: desc,
          timestamp: new Date(), turn: this.turnCounter,
        };
        this.snapshots.push(snapshot);
        this.redoStack = [];
        this.currentIndex = this.snapshots.length - 1;
        return snapshot;
      }

      // Stage all changes (including untracked, excluding .gitignored) only
      // when there is actually something to capture.
      await this.git(['add', '-A']);

      // Create a ghost commit (won't appear in regular git log)
      const commitHash = (await this.git([
        'commit', '--allow-empty', '-m', `[ghost] ${desc}`,
        '--no-verify', '--no-gpg-sign',
      ])).trim();

      // Extract the actual hash from the commit output
      const hashMatch = commitHash.match(/\[.*\s+([a-f0-9]+)\]/);
      const hash = hashMatch?.[1] ?? (await this.git(['rev-parse', 'HEAD'])).trim();

      // Store as a named ref (not on any branch)
      const refName = `${GHOST_REF_PREFIX}${id}`;
      await this.git(['update-ref', refName, hash]);

      // Soft-reset to unstage (keep changes in working tree for the user)
      await this.git(['reset', '--soft', 'HEAD~1']);

      const snapshot: GhostSnapshot = {
        id, commitHash: hash, description: desc,
        timestamp: new Date(), turn: this.turnCounter,
      };
      this.snapshots.push(snapshot);
      this.redoStack = [];
      this.currentIndex = this.snapshots.length - 1;

      // Prune old snapshots
      if (this.snapshots.length > MAX_GHOST_SNAPSHOTS) {
        const toRemove = this.snapshots.splice(0, this.snapshots.length - MAX_GHOST_SNAPSHOTS);
        for (const old of toRemove) {
          try {
            await this.git(['update-ref', '-d', `${GHOST_REF_PREFIX}${old.id}`]);
          } catch { /* best effort */ }
        }
      }

      logger.debug(`Ghost snapshot created: ${id} (${hash.substring(0, 8)})`);
      return snapshot;
    } catch (err) {
      logger.debug(`Ghost snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Restore workspace to a ghost snapshot.
   */
  async restoreSnapshot(snapshotId: string): Promise<boolean> {
    if (!this.isGitRepo) return false;

    const snapshot = this.snapshots.find(s => s.id === snapshotId);
    if (!snapshot) {
      logger.debug(`Ghost snapshot not found: ${snapshotId}`);
      return false;
    }

    try {
      // Checkout the ghost commit's tree onto the working directory
      await this.git(['checkout', snapshot.commitHash, '--', '.']);
      logger.info(`Restored ghost snapshot: ${snapshotId} (turn ${snapshot.turn})`);
      return true;
    } catch (err) {
      logger.debug(`Ghost restore failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Undo to the last ghost snapshot (most recent before current turn).
   * Pushes the current snapshot onto the redo stack before restoring.
   */
  async undoLastTurn(): Promise<GhostSnapshot | null> {
    if (this.snapshots.length === 0 || this.currentIndex < 0) return null;

    const current = this.snapshots[this.currentIndex];
    const targetIndex = this.currentIndex - 1;
    if (targetIndex < 0) return null;

    const target = this.snapshots[targetIndex];
    if (current === undefined || target === undefined) return null;
    const restored = await this.restoreSnapshot(target.id);
    if (restored) {
      this.redoStack.push(current);
      this.currentIndex = targetIndex;
      return target;
    }
    return null;
  }

  /**
   * Redo a previously undone change (restore forward in timeline).
   * Pops from the redo stack and restores it.
   */
  async redoLastTurn(): Promise<GhostSnapshot | null> {
    if (this.redoStack.length === 0) return null;

    const snapshot = this.redoStack.pop()!;
    const restored = await this.restoreSnapshot(snapshot.id);
    if (restored) {
      this.currentIndex++;
      return snapshot;
    }
    return null;
  }

  /**
   * Get the full timeline of snapshots with navigation state.
   */
  getTimeline(): { snapshots: GhostSnapshot[]; currentIndex: number; canUndo: boolean; canRedo: boolean } {
    return {
      snapshots: [...this.snapshots],
      currentIndex: this.currentIndex,
      canUndo: this.currentIndex > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  /**
   * List all ghost snapshots.
   */
  listSnapshots(): GhostSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Helper: run a git command.
   */
  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.cwd,
      timeout: SNAPSHOT_TIMEOUT_MS,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout;
  }
}

/** One manager per workspace; Cowork can keep several projects open at once. */
const _instances = new Map<string, GhostSnapshotManager>();

export function getGhostSnapshotManager(cwd?: string): GhostSnapshotManager {
  const key = cwd ?? process.cwd();
  let instance = _instances.get(key);
  if (!instance) {
    instance = new GhostSnapshotManager(key);
    _instances.set(key, instance);
  }
  return instance;
}

export function resetGhostSnapshotManager(): void {
  _instances.clear();
}
