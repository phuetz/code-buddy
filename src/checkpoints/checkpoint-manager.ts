import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getErrorMessage } from '../types/index.js';
import { LisaActionStore, lisaUnifiedCheckpointsEnabled } from './lisa-action-store.js';

export interface FileSnapshot {
  path: string;
  content: string;
  existed: boolean;
}

export interface Checkpoint {
  id: string;
  timestamp: Date;
  description: string;
  files: FileSnapshot[];
  workingDirectory: string;
}

export interface CheckpointManagerOptions {
  maxCheckpoints?: number;
  autoCheckpoint?: boolean;
}

/**
 * Checkpoint Manager for saving and restoring file states
 */
export class CheckpointManager extends EventEmitter {
  private checkpoints: Checkpoint[] = [];
  private maxCheckpoints: number;
  private autoCheckpoint: boolean;
  private workingDirectory: string;

  constructor(options: CheckpointManagerOptions = {}) {
    super();
    this.maxCheckpoints = options.maxCheckpoints || 50;
    this.autoCheckpoint = options.autoCheckpoint ?? true;
    this.workingDirectory = process.cwd();
  }

  /**
   * Create a new checkpoint
   */
  createCheckpoint(description: string, files?: string[]): Checkpoint {
    const checkpoint: Checkpoint = {
      id: this.generateId(),
      timestamp: new Date(),
      description,
      files: [],
      workingDirectory: this.workingDirectory
    };

    if (files && files.length > 0) {
      checkpoint.files = this.snapshotFiles(files);
      if (lisaUnifiedCheckpointsEnabled()) {
        new LisaActionStore(this.workingDirectory).prepare(checkpoint.id, description, 'checkpoint-manager', files);
      }
    }

    this.checkpoints.push(checkpoint);

    // Trim old checkpoints if exceeding max
    while (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints.shift();
    }

    this.emit('checkpoint-created', checkpoint);
    return checkpoint;
  }

  /**
   * Create a checkpoint before modifying a file
   */
  checkpointBeforeEdit(filePath: string, description?: string): Checkpoint {
    const resolvedPath = path.resolve(this.workingDirectory, filePath);
    const desc = description || `Before editing: ${path.basename(filePath)}`;

    const checkpoint = this.createCheckpoint(desc, [resolvedPath]);
    return checkpoint;
  }

  /**
   * Create a checkpoint before creating a file
   */
  checkpointBeforeCreate(filePath: string, description?: string): Checkpoint {
    const resolvedPath = path.resolve(this.workingDirectory, filePath);
    const desc = description || `Before creating: ${path.basename(filePath)}`;

    // Snapshot the file (will mark it as non-existent if it doesn't exist)
    const checkpoint = this.createCheckpoint(desc, [resolvedPath]);
    return checkpoint;
  }

  /**
   * Snapshot multiple files
   */
  private snapshotFiles(filePaths: string[]): FileSnapshot[] {
    const snapshots: FileSnapshot[] = [];

    for (const filePath of filePaths) {
      try {
        const resolvedPath = path.resolve(this.workingDirectory, filePath);

        if (fs.existsSync(resolvedPath)) {
          const stat = fs.statSync(resolvedPath);
          if (stat.isFile()) {
            const content = fs.readFileSync(resolvedPath, 'utf-8');
            snapshots.push({
              path: resolvedPath,
              content,
              existed: true
            });
          }
        } else {
          // File doesn't exist yet
          snapshots.push({
            path: resolvedPath,
            content: '',
            existed: false
          });
        }
      } catch (_error) {
        // Skip files that can't be read
      }
    }

    return snapshots;
  }

  /**
   * Rewind to a specific checkpoint.
   *
   * Two-phase atomic restore (F30):
   *
   *   Phase 1 — Stage
   *     For every snapshot, write its content to a sibling temp file
   *     (`<target>.restore-<uuid>.tmp`) or pre-check that the target
   *     can be deleted. We do NOT touch the real project files yet.
   *     If any stage step throws, we abort BEFORE any destructive
   *     change lands, and the repo is left exactly as it was before
   *     the call.
   *
   *   Phase 2 — Commit
   *     Rename every staged temp file into place (near-atomic on POSIX,
   *     best-effort atomic on Windows) and delete the "did-not-exist"
   *     targets. Errors here are reported but no longer abort, because
   *     the project is already in a mixed state.
   *
   * This replaces the previous implementation which iterated through
   * the snapshots and wrote them one by one, so a write failure at
   * file 10/30 left the project in a half-restored state AND truncated
   * `this.checkpoints` in memory, making any manual recovery impossible.
   *
   * The in-memory `this.checkpoints` slice is now only applied when the
   * restore is fully successful.
   */
  rewindTo(checkpointId: string): { success: boolean; restored: string[]; errors: string[] } {
    const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);

    if (!checkpoint) {
      return {
        success: false,
        restored: [],
        errors: [`Checkpoint not found: ${checkpointId}`]
      };
    }

    const restored: string[] = [];
    const errors: string[] = [];

    // ------------------------------------------------------------------
    // Phase 1 — Stage every write/delete into a temp file or a plan.
    // ------------------------------------------------------------------
    type Staged =
      | { kind: 'write'; target: string; tmpPath: string }
      | { kind: 'delete'; target: string };

    const staged: Staged[] = [];
    const stagingErrors: string[] = [];

    for (const snapshot of checkpoint.files) {
      try {
        if (snapshot.existed) {
          const dir = path.dirname(snapshot.path);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          // Stage content in a sibling temp file so Phase 2 only has
          // to do a rename — much harder to fail partway through.
          const tmpPath = `${snapshot.path}.restore-${this.generateId()}.tmp`;
          fs.writeFileSync(tmpPath, snapshot.content);
          staged.push({ kind: 'write', target: snapshot.path, tmpPath });
        } else {
          // Nothing to stage for a delete; we only need to know the target.
          staged.push({ kind: 'delete', target: snapshot.path });
        }
      } catch (error) {
        stagingErrors.push(`Failed to stage ${snapshot.path}: ${getErrorMessage(error)}`);
      }
    }

    if (stagingErrors.length > 0) {
      // Abort: clean up any temp files we managed to create so we
      // don't leave `.restore-*.tmp` litter in the working tree.
      for (const op of staged) {
        if (op.kind === 'write') {
          try { fs.unlinkSync(op.tmpPath); } catch { /* ignore */ }
        }
      }
      this.emit('rewind', checkpoint, [], stagingErrors);
      return {
        success: false,
        restored: [],
        errors: stagingErrors,
      };
    }

    // ------------------------------------------------------------------
    // Phase 2 — Commit every staged change. Errors here do not abort
    // (the project is already being modified) but are reported so the
    // caller knows the final state is mixed.
    // ------------------------------------------------------------------
    for (const op of staged) {
      try {
        if (op.kind === 'write') {
          fs.renameSync(op.tmpPath, op.target);
          restored.push(op.target);
        } else {
          if (fs.existsSync(op.target)) {
            fs.unlinkSync(op.target);
            restored.push(`Deleted: ${op.target}`);
          }
        }
      } catch (error) {
        errors.push(`Failed to commit ${op.target}: ${getErrorMessage(error)}`);
        // If the commit rename failed, the temp file is still on disk —
        // try to clean it so we don't leave half-staged artifacts.
        if (op.kind === 'write') {
          try { fs.unlinkSync(op.tmpPath); } catch { /* ignore */ }
        }
      }
    }

    // Only discard the newer checkpoints when the restore was fully
    // successful. The previous code truncated unconditionally, which
    // destroyed the user's ability to recover after a partial failure.
    if (errors.length === 0) {
      const checkpointIndex = this.checkpoints.indexOf(checkpoint);
      if (checkpointIndex >= 0) {
        this.checkpoints = this.checkpoints.slice(0, checkpointIndex + 1);
      }
    }

    this.emit('rewind', checkpoint, restored, errors);

    return {
      success: errors.length === 0,
      restored,
      errors
    };
  }

  /**
   * Rewind to the last checkpoint
   */
  rewindToLast(): { success: boolean; restored: string[]; errors: string[]; checkpoint?: Checkpoint } {
    if (this.checkpoints.length === 0) {
      return {
        success: false,
        restored: [],
        errors: ['No checkpoints available']
      };
    }

    const lastCheckpoint = this.checkpoints[this.checkpoints.length - 1];
    if (lastCheckpoint === undefined) {
      return {
        success: false,
        restored: [],
        errors: ['No checkpoints available']
      };
    }
    const result = this.rewindTo(lastCheckpoint.id);

    return {
      ...result,
      checkpoint: lastCheckpoint
    };
  }

  /**
   * Get all checkpoints
   */
  getCheckpoints(): Checkpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Get a specific checkpoint by ID
   */
  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.find(cp => cp.id === id);
  }

  /**
   * Get the last N checkpoints
   */
  getRecentCheckpoints(count: number = 10): Checkpoint[] {
    return this.checkpoints.slice(-count);
  }

  /**
   * Clear all checkpoints
   */
  clearCheckpoints(): void {
    this.checkpoints = [];
    this.emit('checkpoints-cleared');
  }

  /**
   * Delete a specific checkpoint
   */
  deleteCheckpoint(id: string): boolean {
    const index = this.checkpoints.findIndex(cp => cp.id === id);
    if (index >= 0) {
      this.checkpoints.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Check if auto-checkpoint is enabled
   */
  isAutoCheckpointEnabled(): boolean {
    return this.autoCheckpoint;
  }

  /**
   * Enable or disable auto-checkpoint
   */
  setAutoCheckpoint(enabled: boolean): void {
    this.autoCheckpoint = enabled;
  }

  /**
   * Format checkpoint for display
   */
  formatCheckpoint(checkpoint: Checkpoint): string {
    const time = checkpoint.timestamp.toLocaleTimeString();
    const filesCount = checkpoint.files.length;
    return `[${checkpoint.id.slice(0, 8)}] ${time} - ${checkpoint.description} (${filesCount} file${filesCount !== 1 ? 's' : ''})`;
  }

  /**
   * Format all checkpoints for display
   */
  formatCheckpointList(): string {
    if (this.checkpoints.length === 0) {
      return 'No checkpoints available.';
    }

    const header = 'Checkpoints:\n' + '─'.repeat(50) + '\n';
    const list = this.checkpoints
      .map((cp, index) => `${index + 1}. ${this.formatCheckpoint(cp)}`)
      .join('\n');

    return header + list;
  }

  /**
   * Generate a unique checkpoint ID
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `cp_${timestamp}_${random}`;
  }

  /**
   * Get statistics about checkpoints
   */
  getStats(): { count: number; totalFiles: number; oldestTimestamp?: Date; newestTimestamp?: Date } {
    const totalFiles = this.checkpoints.reduce((sum, cp) => sum + cp.files.length, 0);

    return {
      count: this.checkpoints.length,
      totalFiles,
      oldestTimestamp: this.checkpoints[0]?.timestamp,
      newestTimestamp: this.checkpoints[this.checkpoints.length - 1]?.timestamp
    };
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    this.checkpoints = [];
    this.removeAllListeners();
  }
}

// Singleton instance
let checkpointManagerInstance: CheckpointManager | null = null;

export function getCheckpointManager(options?: CheckpointManagerOptions): CheckpointManager {
  if (!checkpointManagerInstance) {
    checkpointManagerInstance = new CheckpointManager(options);
  }
  return checkpointManagerInstance;
}

export function resetCheckpointManager(): void {
  if (checkpointManagerInstance) {
    checkpointManagerInstance.dispose();
  }
  checkpointManagerInstance = null;
}
