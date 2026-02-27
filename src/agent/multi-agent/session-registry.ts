/**
 * Session Registry
 *
 * Central registry for managing multi-agent sessions.
 * Enables inter-session communication and coordination.
 *
 * Inspired by OpenClaw's session tools system.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export type SessionKind =
  | 'main'      // Main DM session
  | 'channel'   // Channel/group session
  | 'cron'      // Cron job session
  | 'hook'      // Webhook session
  | 'spawn'     // Spawned sub-agent session
  | 'node';     // Companion node session

export type SessionStatus = 'active' | 'idle' | 'completed' | 'error';

export interface SessionInfo {
  id: string;
  key: string;
  kind: SessionKind;
  agentId: string;
  status: SessionStatus;
  channelId?: string;
  peerId?: string;
  label?: string;
  parentSessionId?: string;
  createdAt: Date;
  lastActivityAt: Date;
  messageCount: number;
  model?: string;
  sandboxed: boolean;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolResult?: {
    toolCallId: string;
    result: unknown;
  };
  timestamp: Date;
  tokenCount?: number;
}

export interface SessionRegistryConfig {
  maxSessions: number;
  idleTimeoutMs: number;
  cleanupIntervalMs: number;
  defaultMaxRounds: number;
  persistPath: string;
}

export const DEFAULT_SESSION_REGISTRY_CONFIG: SessionRegistryConfig = {
  maxSessions: 1000,
  idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
  cleanupIntervalMs: 60 * 1000, // 1 minute
  defaultMaxRounds: 5,
  persistPath: path.join(homedir(), '.codebuddy', 'sessions'),
};

// ============================================================================
// Session Registry
// ============================================================================

export class SessionRegistry extends EventEmitter {
  private config: SessionRegistryConfig;
  private sessions: Map<string, SessionInfo> = new Map();
  private sessionsByKey: Map<string, string> = new Map(); // key -> id
  private messages: Map<string, SessionMessage[]> = new Map(); // sessionId -> messages
  private cleanupTimer: NodeJS.Timeout | null = null;
  private pendingReplies: Map<string, {
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(config: Partial<SessionRegistryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SESSION_REGISTRY_CONFIG, ...config };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    // Ensure persist path exists
    await fs.mkdir(this.config.persistPath, { recursive: true });

    // Load persisted sessions
    await this.loadPersistedSessions();

    // Start cleanup timer
    this.cleanupTimer = setInterval(
      () => this.cleanupIdleSessions(),
      this.config.cleanupIntervalMs
    );
  }

  async stop(): Promise<void> {
    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Cancel pending replies
    for (const [, pending] of this.pendingReplies) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Session registry stopped'));
    }
    this.pendingReplies.clear();

    // Persist sessions
    await this.persistSessions();
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Create a new session
   */
  createSession(params: {
    kind: SessionKind;
    agentId: string;
    channelId?: string;
    peerId?: string;
    label?: string;
    parentSessionId?: string;
    model?: string;
    sandboxed?: boolean;
  }): SessionInfo {
    // Check max sessions
    if (this.sessions.size >= this.config.maxSessions) {
      // Try to cleanup first
      this.cleanupIdleSessions();
      if (this.sessions.size >= this.config.maxSessions) {
        throw new Error('Maximum sessions exceeded');
      }
    }

    const id = crypto.randomUUID();
    const key = this.buildSessionKey(params);
    const now = new Date();

    const session: SessionInfo = {
      id,
      key,
      kind: params.kind,
      agentId: params.agentId,
      status: 'active',
      channelId: params.channelId,
      peerId: params.peerId,
      label: params.label,
      parentSessionId: params.parentSessionId,
      createdAt: now,
      lastActivityAt: now,
      messageCount: 0,
      model: params.model,
      sandboxed: params.sandboxed ?? false,
    };

    this.sessions.set(id, session);
    this.sessionsByKey.set(key, id);
    this.messages.set(id, []);

    this.emit('session:created', session);
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get session by key
   */
  getSessionByKey(key: string): SessionInfo | undefined {
    const id = this.sessionsByKey.get(key);
    return id ? this.sessions.get(id) : undefined;
  }

  /**
   * Update session status
   */
  updateSession(sessionId: string, updates: Partial<SessionInfo>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    Object.assign(session, updates, { lastActivityAt: new Date() });
    this.emit('session:updated', session);
  }

  /**
   * Delete session
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);
    this.sessionsByKey.delete(session.key);
    this.messages.delete(sessionId);

    this.emit('session:deleted', sessionId);
    return true;
  }

  /**
   * List sessions with filters
   */
  listSessions(params: {
    kinds?: SessionKind[];
    limit?: number;
    activeMinutes?: number;
    agentId?: string;
  } = {}): SessionInfo[] {
    let sessions = Array.from(this.sessions.values());

    // Filter by kinds
    if (params.kinds && params.kinds.length > 0) {
      sessions = sessions.filter(s => params.kinds!.includes(s.kind));
    }

    // Filter by agent
    if (params.agentId) {
      sessions = sessions.filter(s => s.agentId === params.agentId);
    }

    // Filter by activity
    if (params.activeMinutes !== undefined) {
      const cutoff = new Date(Date.now() - params.activeMinutes * 60 * 1000);
      sessions = sessions.filter(s => s.lastActivityAt >= cutoff);
    }

    // Sort by last activity (most recent first)
    sessions.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());

    // Apply limit
    if (params.limit !== undefined && params.limit > 0) {
      sessions = sessions.slice(0, params.limit);
    }

    return sessions;
  }

  // ==========================================================================
  // Message Management
  // ==========================================================================

  /**
   * Add message to session
   */
  addMessage(sessionId: string, message: Omit<SessionMessage, 'id' | 'timestamp'>): SessionMessage {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const fullMessage: SessionMessage = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };

    const messages = this.messages.get(sessionId) || [];
    messages.push(fullMessage);
    this.messages.set(sessionId, messages);

    session.messageCount++;
    session.lastActivityAt = new Date();

    this.emit('session:message', sessionId, fullMessage);
    return fullMessage;
  }

  /**
   * Get session history
   */
  getHistory(sessionId: string, params: {
    limit?: number;
    includeTools?: boolean;
  } = {}): SessionMessage[] {
    let messages = this.messages.get(sessionId) || [];

    // Filter out tool messages if not requested
    if (!params.includeTools) {
      messages = messages.filter(m => m.role !== 'tool');
    }

    // Apply limit (from end)
    if (params.limit !== undefined && params.limit > 0) {
      messages = messages.slice(-params.limit);
    }

    return messages;
  }

  // ==========================================================================
  // Inter-Session Communication
  // ==========================================================================

  /**
   * Send message to another session
   */
  async sendToSession(
    sourceSessionId: string,
    targetKey: string,
    message: string,
    timeoutSeconds: number = 0
  ): Promise<{ success: boolean; response?: string; error?: string; fireAndForget: boolean }> {
    const target = this.getSessionByKey(targetKey);
    if (!target) {
      return { success: false, error: `Session ${targetKey} not found`, fireAndForget: false };
    }

    // Add message to target session
    this.addMessage(target.id, {
      sessionId: target.id,
      role: 'user',
      content: `[From session ${sourceSessionId}]: ${message}`,
    });

    // Fire and forget
    if (timeoutSeconds === 0) {
      this.emit('session:message-sent', sourceSessionId, target.id, message);
      return { success: true, fireAndForget: true };
    }

    // Wait for response
    return new Promise((resolve) => {
      const replyId = `${sourceSessionId}:${target.id}:${Date.now()}`;

      const timeout = setTimeout(() => {
        this.pendingReplies.delete(replyId);
        resolve({ success: false, error: 'Timeout waiting for response', fireAndForget: false });
      }, timeoutSeconds * 1000);

      this.pendingReplies.set(replyId, {
        resolve: (response: string) => {
          clearTimeout(timeout);
          this.pendingReplies.delete(replyId);
          resolve({ success: true, response, fireAndForget: false });
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingReplies.delete(replyId);
          resolve({ success: false, error: error.message, fireAndForget: false });
        },
        timeout,
      });

      this.emit('session:awaiting-reply', replyId, sourceSessionId, target.id);
    });
  }

  /**
   * Reply to a pending message
   */
  replyToSession(replyId: string, response: string): boolean {
    const pending = this.pendingReplies.get(replyId);
    if (!pending) return false;

    pending.resolve(response);
    return true;
  }

  // ==========================================================================
  // Session Spawning
  // ==========================================================================

  /**
   * Spawn a sub-session
   */
  spawnSession(params: {
    parentSessionId: string;
    task: string;
    label?: string;
    agentId?: string;
    model?: string;
    allowedTools?: string[];
    context?: Record<string, unknown>;
  }): SessionInfo {
    const parent = this.sessions.get(params.parentSessionId);
    if (!parent) {
      throw new Error(`Parent session ${params.parentSessionId} not found`);
    }

    const child = this.createSession({
      kind: 'spawn',
      agentId: params.agentId || parent.agentId,
      parentSessionId: params.parentSessionId,
      label: params.label,
      model: params.model,
      sandboxed: true, // Spawned sessions are always sandboxed
    });

    // Add initial task message
    this.addMessage(child.id, {
      sessionId: child.id,
      role: 'system',
      content: `Task: ${params.task}${params.context ? `\n\nContext: ${JSON.stringify(params.context)}` : ''}`,
    });

    this.emit('session:spawn', parent, child);
    return child;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private async loadPersistedSessions(): Promise<void> {
    try {
      const indexPath = path.join(this.config.persistPath, 'sessions.json');
      const data = await fs.readFile(indexPath, 'utf-8');
      const persisted = JSON.parse(data) as {
        sessions: SessionInfo[];
        messages: Record<string, SessionMessage[]>;
      };

      for (const session of persisted.sessions) {
        session.createdAt = new Date(session.createdAt);
        session.lastActivityAt = new Date(session.lastActivityAt);
        this.sessions.set(session.id, session);
        this.sessionsByKey.set(session.key, session.id);
      }

      for (const [sessionId, messages] of Object.entries(persisted.messages)) {
        const parsed = messages.map(m => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
        this.messages.set(sessionId, parsed);
      }
    } catch {
      // No persisted sessions or error reading
    }
  }

  private async persistSessions(): Promise<void> {
    try {
      const data = {
        sessions: Array.from(this.sessions.values()),
        messages: Object.fromEntries(this.messages),
      };

      const indexPath = path.join(this.config.persistPath, 'sessions.json');
      await fs.writeFile(indexPath, JSON.stringify(data, null, 2));
    } catch (error) {
      this.emit('error', error);
    }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  private cleanupIdleSessions(): void {
    const cutoff = new Date(Date.now() - this.config.idleTimeoutMs);

    for (const [id, session] of this.sessions) {
      if (session.status === 'idle' && session.lastActivityAt < cutoff) {
        this.deleteSession(id);
      }
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private buildSessionKey(params: {
    kind: SessionKind;
    agentId: string;
    channelId?: string;
    peerId?: string;
    label?: string;
    parentSessionId?: string;
  }): string {
    switch (params.kind) {
      case 'main':
        return 'main';
      case 'channel':
        return `agent:${params.agentId}:${params.channelId}:peer:${params.peerId || 'unknown'}`;
      case 'cron':
        return `cron:${params.label || crypto.randomUUID()}`;
      case 'hook':
        return `hook:${crypto.randomUUID()}`;
      case 'spawn':
        return `spawn:${params.parentSessionId}:${params.label || crypto.randomUUID().slice(0, 8)}`;
      case 'node':
        return `node-${params.agentId}`;
      default:
        return `session:${crypto.randomUUID()}`;
    }
  }

  // ==========================================================================
  // Stats
  // ==========================================================================

  getStats(): {
    totalSessions: number;
    activeSessions: number;
    byKind: Record<SessionKind, number>;
    totalMessages: number;
  } {
    const byKind: Record<SessionKind, number> = {
      main: 0,
      channel: 0,
      cron: 0,
      hook: 0,
      spawn: 0,
      node: 0,
    };

    let activeSessions = 0;
    let totalMessages = 0;

    for (const session of this.sessions.values()) {
      byKind[session.kind]++;
      if (session.status === 'active') activeSessions++;
      totalMessages += session.messageCount;
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      byKind,
      totalMessages,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let sessionRegistryInstance: SessionRegistry | null = null;

export function getSessionRegistry(config?: Partial<SessionRegistryConfig>): SessionRegistry {
  if (!sessionRegistryInstance) {
    sessionRegistryInstance = new SessionRegistry(config);
  }
  return sessionRegistryInstance;
}

export async function resetSessionRegistry(): Promise<void> {
  if (sessionRegistryInstance) {
    await sessionRegistryInstance.stop();
  }
  sessionRegistryInstance = null;
}

export default SessionRegistry;
