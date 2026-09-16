/**
 * Session Persistence Manager
 *
 * Manages session persistence for context continuity across restarts.
 * Stores conversations as JSON files and supports auto-save.
 */

import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { logger } from "../../utils/logger.js";

import type {
  SessionPersistenceConfig,
  PersistedSession,
  PersistedMessage,
  PersistedToolCall,
} from "./types.js";
import { DEFAULT_MOLTBOT_CONFIG } from "./config.js";
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';

/**
 * Manages session persistence for context continuity
 */
export class SessionPersistenceManager extends EventEmitter {
  private config: SessionPersistenceConfig;
  private workingDirectory: string;
  private currentSession: PersistedSession | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;

  constructor(workingDirectory: string, config?: Partial<SessionPersistenceConfig>) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = { ...DEFAULT_MOLTBOT_CONFIG.persistence, ...config };
    this.ensureStorageDirectory();
  }

  /**
   * Ensure storage directory exists
   */
  private ensureStorageDirectory(): void {
    if (!fs.existsSync(this.config.storagePath)) {
      fs.mkdirSync(this.config.storagePath, { recursive: true });
    }
  }

  /**
   * Generate session file path
   */
  private getSessionPath(sessionId: string): string {
    return path.join(this.config.storagePath, `session-${sessionId}.json`);
  }

  /**
   * Generate project hash for identifying sessions
   */
  private getProjectHash(): string {
    // Simple hash of project path
    const hash = this.workingDirectory
      .split("")
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
    return Math.abs(hash).toString(36);
  }

  /**
   * Start a new session or resume existing
   */
  async startSession(sessionId?: string): Promise<PersistedSession> {
    if (sessionId) {
      // Try to load existing session
      const existing = await this.loadSession(sessionId);
      if (existing) {
        this.currentSession = existing;
        this.startAutoSave();
        this.emit("session-resumed", existing);
        return existing;
      }
    }

    // Create new session
    const newSession: PersistedSession = {
      id: sessionId || `${this.getProjectHash()}-${Date.now().toString(36)}`,
      projectPath: this.workingDirectory,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      metadata: {},
    };

    this.currentSession = newSession;
    this.startAutoSave();
    this.emit("session-started", newSession);

    return newSession;
  }

  /**
   * Load a session from storage
   */
  async loadSession(sessionId: string): Promise<PersistedSession | null> {
    const sessionPath = this.getSessionPath(sessionId);

    if (!fs.existsSync(sessionPath)) {
      return null;
    }

    try {
      return readJsonAtomicSync<PersistedSession | null>(sessionPath, null, {
        mode: 0o600,
        isValid: (value): value is PersistedSession => Boolean(
          value && typeof value === 'object' && !Array.isArray(value) &&
          typeof (value as PersistedSession).id === 'string',
        ),
      });
    } catch (error) {
      logger.warn(`Failed to load session ${sessionId}: ${error}`);
      return null;
    }
  }

  /**
   * Save current session
   */
  async saveSession(): Promise<void> {
    if (!this.currentSession || !this.config.enabled) {
      return;
    }

    this.currentSession.updatedAt = new Date().toISOString();

    // Trim messages if exceeding limit
    if (this.currentSession.messages.length > this.config.maxMessagesPerSession) {
      const excess = this.currentSession.messages.length - this.config.maxMessagesPerSession;
      this.currentSession.messages.splice(0, excess);
    }

    const sessionPath = this.getSessionPath(this.currentSession.id);

    try {
      writeJsonAtomicSync(sessionPath, this.currentSession, { mode: 0o600 });
      this.isDirty = false;
      this.emit("session-saved", this.currentSession);
    } catch (error) {
      logger.error(`Failed to save session: ${error instanceof Error ? error : undefined}`);
    }
  }

  /**
   * Add a message to the session
   */
  addMessage(message: Omit<PersistedMessage, "id" | "timestamp">): void {
    if (!this.currentSession) {
      return;
    }

    const fullMessage: PersistedMessage = {
      ...message,
      id: `msg-${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
    };

    this.currentSession.messages.push(fullMessage);
    this.isDirty = true;
    this.emit("message-added", fullMessage);
  }

  /**
   * Add a tool call to the last assistant message
   */
  addToolCall(toolCall: Omit<PersistedToolCall, "id" | "timestamp">): void {
    if (!this.currentSession) {
      return;
    }

    const lastMessage = this.currentSession.messages
      .filter(m => m.role === "assistant")
      .pop();

    if (!lastMessage) {
      return;
    }

    if (!lastMessage.toolCalls) {
      lastMessage.toolCalls = [];
    }

    const fullToolCall: PersistedToolCall = {
      ...toolCall,
      id: `tool-${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
    };

    lastMessage.toolCalls.push(fullToolCall);
    this.isDirty = true;
    this.emit("tool-call-added", fullToolCall);
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    if (this.config.autoSaveInterval > 0) {
      this.autoSaveTimer = setInterval(async () => {
        if (this.isDirty) {
          await this.saveSession();
        }
      }, this.config.autoSaveInterval);
    }
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * End current session
   */
  async endSession(): Promise<void> {
    if (this.currentSession) {
      await this.saveSession();
      this.emit("session-ended", this.currentSession);
      this.currentSession = null;
    }
    this.stopAutoSave();
  }

  /**
   * List all sessions for current project
   */
  listSessions(): PersistedSession[] {
    const sessions: PersistedSession[] = [];
    const projectHash = this.getProjectHash();

    try {
      const files = fs.readdirSync(this.config.storagePath);

      for (const file of files) {
        if (!file.startsWith("session-") || !file.endsWith(".json")) {
          continue;
        }

        try {
          const session = readJsonAtomicSync<PersistedSession | null>(
            path.join(this.config.storagePath, file),
            null,
            {
              mode: 0o600,
              isValid: (value): value is PersistedSession => Boolean(
                value && typeof value === 'object' && !Array.isArray(value) &&
                typeof (value as PersistedSession).id === 'string',
              ),
            },
          );
          if (!session) continue;

          // Filter by project
          if (session.id.startsWith(projectHash) || session.projectPath === this.workingDirectory) {
            sessions.push(session);
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }

    // Sort by updatedAt, most recent first
    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Get the most recent session
   */
  getMostRecentSession(): PersistedSession | null {
    const sessions = this.listSessions();
    return sessions[0] || null;
  }

  /**
   * Delete old sessions
   */
  async cleanupOldSessions(): Promise<number> {
    const sessions = this.listSessions();
    let deleted = 0;

    if (sessions.length <= this.config.maxSessions) {
      return 0;
    }

    // Delete oldest sessions
    const toDelete = sessions.slice(this.config.maxSessions);

    for (const session of toDelete) {
      const sessionPath = this.getSessionPath(session.id);
      try {
        fs.unlinkSync(sessionPath);
        deleted++;
      } catch {
        // Ignore deletion errors
      }
    }

    this.emit("sessions-cleaned", deleted);
    return deleted;
  }

  /**
   * Get current session
   */
  getCurrentSession(): PersistedSession | null {
    return this.currentSession;
  }

  /**
   * Get configuration
   */
  getConfig(): SessionPersistenceConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SessionPersistenceConfig>): void {
    this.config = { ...this.config, ...config };
    this.ensureStorageDirectory();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopAutoSave();
    if (this.isDirty && this.currentSession) {
      // Synchronous save on dispose
      try {
        const sessionPath = this.getSessionPath(this.currentSession.id);
        writeJsonAtomicSync(sessionPath, this.currentSession, { mode: 0o600 });
      } catch {
        // Ignore errors on dispose
      }
    }
  }
}
