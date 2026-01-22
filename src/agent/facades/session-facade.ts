/**
 * Session Facade
 *
 * Encapsulates session persistence and checkpoint management.
 * This facade handles:
 * - Session storage and retrieval
 * - Checkpoint creation and restoration
 * - Session export functionality
 */

import type { CheckpointManager } from '../../checkpoints/checkpoint-manager.js';
import type { SessionStore } from '../../persistence/session-store.js';
import type { ChatEntry } from '../types.js';

/**
 * Result of a checkpoint rewind operation
 */
export interface RewindResult {
  success: boolean;
  message: string;
}

/**
 * Dependencies required by SessionFacade
 */
export interface SessionFacadeDeps {
  checkpointManager: CheckpointManager;
  sessionStore: SessionStore;
}

/**
 * Facade for session and checkpoint management in agents.
 *
 * Responsibilities:
 * - Managing session persistence (save, list, export)
 * - Creating and restoring checkpoints
 * - Providing session state information
 */
export class SessionFacade {
  private readonly checkpointManager: CheckpointManager;
  private readonly sessionStore: SessionStore;

  constructor(deps: SessionFacadeDeps) {
    this.checkpointManager = deps.checkpointManager;
    this.sessionStore = deps.sessionStore;
  }

  // ============================================================================
  // Checkpoint Management
  // ============================================================================

  /**
   * Create a checkpoint with the given description
   */
  createCheckpoint(description: string): void {
    this.checkpointManager.createCheckpoint(description);
  }

  /**
   * Rewind to the last checkpoint
   */
  rewindToLastCheckpoint(): RewindResult {
    const result = this.checkpointManager.rewindToLast();
    if (result.success) {
      return {
        success: true,
        message: result.checkpoint
          ? `Rewound to: ${result.checkpoint.description}\nRestored: ${result.restored.join(', ')}`
          : 'No checkpoint found',
      };
    }
    return {
      success: false,
      message: result.errors.join('\n') || 'Failed to rewind',
    };
  }

  /**
   * Get formatted list of checkpoints
   */
  getCheckpointList(): string {
    return this.checkpointManager.formatCheckpointList();
  }

  /**
   * Get the checkpoint manager instance (for advanced operations)
   */
  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Get the session store instance (for advanced operations)
   */
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  /**
   * Save the current chat history to the session
   */
  async saveCurrentSession(chatHistory: ChatEntry[]): Promise<void> {
    await this.sessionStore.updateCurrentSession(chatHistory);
  }

  /**
   * Get formatted list of sessions
   */
  async getSessionList(): Promise<string> {
    return await this.sessionStore.formatSessionList();
  }

  /**
   * Export current session to a file
   * @returns The path to the exported file, or null if no current session
   */
  async exportCurrentSession(outputPath?: string): Promise<string | null> {
    const currentId = this.sessionStore.getCurrentSessionId();
    if (!currentId) return null;
    return await this.sessionStore.exportSessionToFile(currentId, outputPath);
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | null {
    return this.sessionStore.getCurrentSessionId();
  }
}
