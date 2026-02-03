/**
 * Session Isolation
 *
 * OpenClaw-inspired session scoping for multi-channel DM handling.
 *
 * Session scopes:
 * - per-channel-peer: Separate session per (channel, peer) pair
 *   Prevents cross-user context leakage
 * - per-account-channel-peer: Per (account, channel, peer) triple
 *   For multiple bot accounts on the same channel
 * - global: Single session for all peers (default for CLI)
 *
 * Usage:
 * ```typescript
 * const isolator = getSessionIsolator();
 *
 * // Get session key for a message
 * const sessionKey = isolator.getSessionKey(message);
 *
 * // Check if sessions are isolated
 * isolator.areIsolated(sessionKey1, sessionKey2); // true if different scopes
 * ```
 */

import { EventEmitter } from 'events';
import type { InboundMessage, ChannelType } from './index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Session scope determines how sessions are partitioned
 */
export type SessionScope =
  | 'global'                    // Single session for all (CLI default)
  | 'per-channel'               // One session per channel
  | 'per-channel-peer'          // One session per (channel, peer)
  | 'per-account-channel-peer'; // One session per (account, channel, peer)

/**
 * Session key components
 */
export interface SessionKeyComponents {
  /** Bot account ID (for multi-account setups) */
  accountId?: string;
  /** Channel type (telegram, discord, etc.) */
  channelType: ChannelType;
  /** Channel ID */
  channelId: string;
  /** Peer/user ID */
  peerId: string;
}

/**
 * Session isolation configuration
 */
export interface SessionIsolationConfig {
  /** Default session scope */
  defaultScope: SessionScope;
  /** Per-channel scope overrides */
  channelScopes?: Partial<Record<ChannelType, SessionScope>>;
  /** Maximum sessions per scope */
  maxSessions: number;
  /** Session TTL in milliseconds (0 = no expiry) */
  sessionTtlMs: number;
  /** Enable session activity tracking */
  trackActivity: boolean;
}

/**
 * Session metadata
 */
export interface SessionInfo {
  /** Computed session key */
  key: string;
  /** Key components */
  components: SessionKeyComponents;
  /** Session scope used */
  scope: SessionScope;
  /** Creation timestamp */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Message count */
  messageCount: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_SESSION_ISOLATION_CONFIG: SessionIsolationConfig = {
  defaultScope: 'per-channel-peer',
  maxSessions: 1000,
  sessionTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  trackActivity: true,
};

// ============================================================================
// Session Isolator
// ============================================================================

export class SessionIsolator extends EventEmitter {
  private config: SessionIsolationConfig;
  private sessions: Map<string, SessionInfo> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<SessionIsolationConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SESSION_ISOLATION_CONFIG, ...config };

    // Start cleanup timer if TTL is set
    if (this.config.sessionTtlMs > 0) {
      this.cleanupTimer = setInterval(
        () => this.cleanupExpiredSessions(),
        Math.min(this.config.sessionTtlMs / 2, 60000)
      );
    }
  }

  // ==========================================================================
  // Session Key Generation
  // ==========================================================================

  /**
   * Generate session key for an inbound message
   */
  getSessionKey(message: InboundMessage, accountId?: string): string {
    const components: SessionKeyComponents = {
      accountId,
      channelType: message.channel.type,
      channelId: message.channel.id,
      peerId: message.sender.id,
    };

    return this.computeSessionKey(components);
  }

  /**
   * Generate session key from explicit components
   */
  computeSessionKey(components: SessionKeyComponents): string {
    const scope = this.getScopeForChannel(components.channelType);
    let key: string;

    switch (scope) {
      case 'global':
        key = 'global';
        break;
      case 'per-channel':
        key = `${components.channelType}:${components.channelId}`;
        break;
      case 'per-channel-peer':
        key = `${components.channelType}:${components.channelId}:${components.peerId}`;
        break;
      case 'per-account-channel-peer':
        key = `${components.accountId || 'default'}:${components.channelType}:${components.channelId}:${components.peerId}`;
        break;
    }

    // Track session
    if (!this.sessions.has(key)) {
      if (this.sessions.size >= this.config.maxSessions) {
        this.evictOldestSession();
      }

      const info: SessionInfo = {
        key,
        components,
        scope,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        messageCount: 0,
      };
      this.sessions.set(key, info);
      this.emit('session:created', info);
    }

    // Update activity
    const session = this.sessions.get(key)!;
    session.lastActivityAt = new Date();
    session.messageCount++;

    return key;
  }

  /**
   * Get the scope for a given channel type
   */
  getScopeForChannel(channelType: ChannelType): SessionScope {
    return this.config.channelScopes?.[channelType] ?? this.config.defaultScope;
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Check if two session keys are isolated from each other
   */
  areIsolated(key1: string, key2: string): boolean {
    return key1 !== key2;
  }

  /**
   * Get session info
   */
  getSession(key: string): SessionInfo | undefined {
    return this.sessions.get(key);
  }

  /**
   * List all active sessions
   */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * List sessions for a specific channel
   */
  listSessionsForChannel(channelType: ChannelType): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter(s => s.components.channelType === channelType);
  }

  /**
   * List sessions for a specific peer across all channels
   */
  listSessionsForPeer(peerId: string): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter(s => s.components.peerId === peerId);
  }

  /**
   * Remove a session
   */
  removeSession(key: string): boolean {
    const session = this.sessions.get(key);
    if (session) {
      this.sessions.delete(key);
      this.emit('session:removed', session);
      return true;
    }
    return false;
  }

  /**
   * Set scope for a specific channel
   */
  setChannelScope(channelType: ChannelType, scope: SessionScope): void {
    if (!this.config.channelScopes) {
      this.config.channelScopes = {};
    }
    this.config.channelScopes[channelType] = scope;
    this.emit('scope:changed', channelType, scope);
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    if (this.config.sessionTtlMs <= 0) return;

    const now = Date.now();
    const expired: string[] = [];

    for (const [key, session] of this.sessions) {
      if (now - session.lastActivityAt.getTime() > this.config.sessionTtlMs) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      this.removeSession(key);
    }

    if (expired.length > 0) {
      this.emit('sessions:cleaned', expired.length);
    }
  }

  /**
   * Evict the oldest session when at capacity
   */
  private evictOldestSession(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, session] of this.sessions) {
      if (session.lastActivityAt.getTime() < oldestTime) {
        oldestTime = session.lastActivityAt.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.removeSession(oldestKey);
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get isolation statistics
   */
  getStats(): {
    totalSessions: number;
    sessionsByScope: Record<SessionScope, number>;
    sessionsByChannel: Record<string, number>;
    oldestSession: Date | null;
    newestSession: Date | null;
  } {
    const sessionsByScope: Record<SessionScope, number> = {
      global: 0,
      'per-channel': 0,
      'per-channel-peer': 0,
      'per-account-channel-peer': 0,
    };

    const sessionsByChannel: Record<string, number> = {};
    let oldest: Date | null = null;
    let newest: Date | null = null;

    for (const session of this.sessions.values()) {
      sessionsByScope[session.scope]++;
      const ct = session.components.channelType;
      sessionsByChannel[ct] = (sessionsByChannel[ct] || 0) + 1;

      if (!oldest || session.createdAt < oldest) oldest = session.createdAt;
      if (!newest || session.createdAt > newest) newest = session.createdAt;
    }

    return {
      totalSessions: this.sessions.size,
      sessionsByScope,
      sessionsByChannel,
      oldestSession: oldest,
      newestSession: newest,
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Dispose the isolator
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let isolatorInstance: SessionIsolator | null = null;

export function getSessionIsolator(config?: Partial<SessionIsolationConfig>): SessionIsolator {
  if (!isolatorInstance) {
    isolatorInstance = new SessionIsolator(config);
  }
  return isolatorInstance;
}

export function resetSessionIsolator(): void {
  if (isolatorInstance) {
    isolatorInstance.dispose();
  }
  isolatorInstance = null;
}
