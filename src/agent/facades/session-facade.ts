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
import type { Session, SessionStore, SessionUsageSnapshot } from '../../persistence/session-store.js';
import type { ChatEntry } from '../types.js';
import { SessionEncryption } from '../../security/session-encryption.js';
import { logger } from '../../utils/logger.js';

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
  private encryption: SessionEncryption | null = null;
  private encryptionInitialized = false;

  constructor(deps: SessionFacadeDeps) {
    this.checkpointManager = deps.checkpointManager;
    this.sessionStore = deps.sessionStore;
  }

  /**
   * Lazily initialize session encryption if enabled via SESSION_ENCRYPTION env var
   */
  private async getEncryption(): Promise<SessionEncryption | null> {
    if (this.encryptionInitialized) return this.encryption;
    this.encryptionInitialized = true;

    if (process.env.SESSION_ENCRYPTION === 'true') {
      try {
        this.encryption = new SessionEncryption({ enabled: true });
        await this.encryption.initialize();
        logger.debug('Session encryption initialized');
      } catch (err) {
        logger.warn('Failed to initialize session encryption', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.encryption = null;
      }
    }
    return this.encryption;
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
  async saveCurrentSession(
    chatHistory: ChatEntry[],
    usage?: SessionUsageSnapshot
  ): Promise<void> {
    const enc = await this.getEncryption();
    if (enc) {
      try {
        const encrypted = enc.encryptObject(chatHistory);
        const marker: ChatEntry = {
          type: 'assistant',
          content: JSON.stringify({ __encrypted: true, data: encrypted }),
          timestamp: new Date(),
        };
        await this.sessionStore.updateCurrentSession([marker]);
        if (usage) await this.sessionStore.attachUsageToCurrentSession(usage);
        return;
      } catch (err) {
        logger.warn('Session encryption failed, saving unencrypted', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await this.sessionStore.updateCurrentSession(chatHistory);
    if (usage) await this.sessionStore.attachUsageToCurrentSession(usage);
  }

  /**
   * Get formatted list of sessions
   */
  getSessionList(): Promise<string> | string {
    return this.sessionStore.formatSessionList();
  }

  /**
   * Export current session to a file
   * @returns The path to the exported file, or null if no current session
   */
  exportCurrentSession(outputPath?: string): Promise<string | null> | string | null {
    const currentId = this.sessionStore.getCurrentSessionId();
    if (!currentId) return null;
    return this.sessionStore.exportSessionToFile(currentId, outputPath);
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | null {
    return this.sessionStore.getCurrentSessionId();
  }

  /** Load a persisted session through the canonical session store. */
  loadSession(sessionId: string): Promise<Session | null> {
    return this.sessionStore.loadSession(sessionId);
  }

  /**
   * Fork a session at a timeline boundary while preserving the existing
   * on-disk session format. The source session is never modified.
   */
  async forkSessionAtTurn(
    sourceSessionId: string,
    newSessionId: string,
    turn: number,
  ): Promise<Session> {
    if (!Number.isInteger(turn) || turn < 1) {
      throw new Error('Turn must be a positive integer');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(newSessionId) || newSessionId === '..') {
      throw new Error('New session id may contain only letters, numbers, dots, underscores, and dashes');
    }
    if (sourceSessionId === newSessionId) {
      throw new Error('Fork session id must differ from the source session id');
    }
    if (await this.sessionStore.loadSession(newSessionId)) {
      throw new Error(`Session already exists: ${newSessionId}`);
    }

    const source = await this.sessionStore.loadSession(sourceSessionId);
    if (!source) throw new Error(`Session not found: ${sourceSessionId}`);

    let userTurns = 0;
    const messages = [] as Session['messages'];
    for (const message of source.messages) {
      if (message.type === 'user') {
        userTurns += 1;
        if (userTurns > turn) break;
      }
      messages.push(message);
    }

    const forked: Session = {
      ...source,
      id: newSessionId,
      name: `${source.name} (fork at turn ${turn})`,
      messages,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      metadata: {
        ...source.metadata,
        parentSessionId: sourceSessionId,
        forkedFrom: sourceSessionId,
        forkedAtTurn: turn,
      },
    };
    await this.sessionStore.saveSession(forked);
    return forked;
  }
}
