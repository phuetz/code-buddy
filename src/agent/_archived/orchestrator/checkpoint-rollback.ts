/**
 * Checkpoint Rollback
 *
 * Automatic checkpointing before risky operations with rollback support.
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface AutoCheckpoint {
  id: string;
  operation: string;
  createdAt: Date;
  files: { path: string; content: string; existed: boolean }[];
  expiresAt: Date;
}

export interface RollbackResult {
  success: boolean;
  checkpointId: string;
  filesRestored: number;
  error?: string;
}

const RISKY_OPERATIONS = [
  'str_replace_editor',
  'create_file',
  'bash', // when contains rm, mv, git reset, etc.
  'delete_file',
];

const RISKY_COMMANDS = [
  /\brm\s/,
  /\bgit\s+reset/,
  /\bgit\s+checkout\s+\./,
  /\bgit\s+clean/,
  /\bmv\s/,
  /\bchmod\b/,
  /\bchown\b/,
  />\s*\//, // redirect to root paths
];

// ============================================================================
// Checkpoint Rollback Manager
// ============================================================================

export class CheckpointRollback extends EventEmitter {
  private checkpoints: Map<string, AutoCheckpoint> = new Map();
  private maxCheckpoints: number = 50;
  private expirationDays: number = 7;

  /**
   * Determine if an operation is risky
   */
  isRiskyOperation(toolName: string, args?: Record<string, unknown>): boolean {
    if (!RISKY_OPERATIONS.includes(toolName)) return false;

    // For bash, check command content
    if (toolName === 'bash' && args?.command) {
      const cmd = String(args.command);
      return RISKY_COMMANDS.some(pattern => pattern.test(cmd));
    }

    return true;
  }

  /**
   * Create a checkpoint before a risky operation
   */
  autoCheckpoint(
    operation: string,
    files: { path: string; content: string; existed: boolean }[]
  ): AutoCheckpoint {
    const checkpoint: AutoCheckpoint = {
      id: `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operation,
      createdAt: new Date(),
      files,
      expiresAt: new Date(Date.now() + this.expirationDays * 86400000),
    };

    this.checkpoints.set(checkpoint.id, checkpoint);
    this.emit('checkpoint:created', { id: checkpoint.id, operation });

    // Prune old checkpoints
    this.prune();

    return checkpoint;
  }

  /**
   * Rollback to a checkpoint
   */
  async rollbackTo(
    checkpointId: string,
    fileWriter: (path: string, content: string) => Promise<void>,
    fileDeleter: (path: string) => Promise<void>
  ): Promise<RollbackResult> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return { success: false, checkpointId, filesRestored: 0, error: 'Checkpoint not found' };
    }

    let filesRestored = 0;
    try {
      for (const file of checkpoint.files) {
        if (file.existed) {
          await fileWriter(file.path, file.content);
        } else {
          await fileDeleter(file.path);
        }
        filesRestored++;
      }

      this.emit('rollback:success', { checkpointId, filesRestored });
      return { success: true, checkpointId, filesRestored };

    } catch (error) {
      this.emit('rollback:error', { checkpointId, error: String(error) });
      return {
        success: false,
        checkpointId,
        filesRestored,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get a checkpoint
   */
  getCheckpoint(id: string): AutoCheckpoint | undefined {
    return this.checkpoints.get(id);
  }

  /**
   * List checkpoints
   */
  listCheckpoints(): AutoCheckpoint[] {
    return Array.from(this.checkpoints.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Remove expired checkpoints
   */
  private prune(): void {
    const now = Date.now();

    // Remove expired
    for (const [id, cp] of this.checkpoints) {
      if (cp.expiresAt.getTime() < now) {
        this.checkpoints.delete(id);
      }
    }

    // Remove oldest if over max
    if (this.checkpoints.size > this.maxCheckpoints) {
      const sorted = Array.from(this.checkpoints.entries())
        .sort(([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime());

      const toRemove = sorted.slice(0, sorted.length - this.maxCheckpoints);
      for (const [id] of toRemove) {
        this.checkpoints.delete(id);
      }
    }
  }

  /**
   * Clear all checkpoints
   */
  clear(): void {
    this.checkpoints.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let rollbackInstance: CheckpointRollback | null = null;

export function getCheckpointRollback(): CheckpointRollback {
  if (!rollbackInstance) {
    rollbackInstance = new CheckpointRollback();
  }
  return rollbackInstance;
}

export function resetCheckpointRollback(): void {
  rollbackInstance = null;
}
