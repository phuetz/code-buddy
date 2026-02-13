/**
 * Group Chat Security
 *
 * OpenClaw-inspired group chat security with mention-gating, group allowlists,
 * and activation control.
 *
 * In group chats, bots can be noisy if they respond to every message. This
 * module provides configurable security controls:
 *
 * 1. **Mention-gating** - Require @mention to activate in groups
 * 2. **Group allowlists** - Per-group user allowlists
 * 3. **Activation modes** - Per-group control (active, mention-only, inactive, allowlist-only)
 * 4. **Global blocklist** - Block users across all groups
 * 5. **Rate limiting** - Per-group message rate limiting
 *
 * Usage:
 * ```typescript
 * const security = getGroupSecurity();
 *
 * // Check if an inbound message should be processed
 * const result = security.shouldProcess(message);
 * if (result.allowed) {
 *   // Process message
 * } else {
 *   logger.debug('Message blocked', { reason: result.reason });
 * }
 *
 * // Configure a group
 * security.addGroup({
 *   groupId: 'telegram:-100123456',
 *   channelType: 'telegram',
 *   activationMode: 'mention-only',
 *   allowedUsers: ['user-1', 'user-2'],
 * });
 * ```
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import type { ChannelType, InboundMessage } from './index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Group activation mode controlling how the bot responds in a group.
 *
 * - `active` - Process all messages (no gating)
 * - `mention-only` - Only process messages that mention the bot
 * - `inactive` - Ignore all messages in this group
 * - `allowlist-only` - Only process messages from allowlisted users
 */
export type GroupActivationMode = 'active' | 'mention-only' | 'inactive' | 'allowlist-only';

/**
 * Per-group configuration
 */
export interface GroupConfig {
  /** Group/channel ID */
  groupId: string;
  /** Channel type (telegram, discord, etc.) */
  channelType: ChannelType;
  /** How the bot is activated in this group */
  activationMode: GroupActivationMode;
  /** Users allowed to interact in this group (for allowlist-only mode) */
  allowedUsers?: string[];
  /** Custom mention patterns for this group (overrides global) */
  mentionPatterns?: string[];
  /** Whether mentions are required in this group (default true for groups) */
  requireMention?: boolean;
  /** Cooldown between processed messages in ms */
  cooldownMs?: number;
  /** Maximum messages per minute for this group */
  maxMessagesPerMinute?: number;
}

/**
 * Global group security configuration
 */
export interface GroupSecurityConfig {
  /** Enable group security */
  enabled: boolean;
  /** Default activation mode for unconfigured groups */
  defaultMode: GroupActivationMode;
  /** Default mention patterns to detect bot mentions */
  mentionPatterns: string[];
  /** Per-group configurations (groupId -> config) */
  groupConfigs: Map<string, GroupConfig>;
  /** Users allowed in all groups */
  globalAllowlist: string[];
  /** Users blocked from all groups */
  blocklist: string[];
  /** Require @mention in group chats by default */
  requireMentionInGroups: boolean;
}

/**
 * Result of shouldProcess check
 */
export interface ProcessResult {
  /** Whether the message should be processed */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_GROUP_SECURITY_CONFIG: GroupSecurityConfig = {
  enabled: true,
  defaultMode: 'mention-only',
  mentionPatterns: ['@buddy', '@codebuddy', '@bot'],
  groupConfigs: new Map(),
  globalAllowlist: [],
  blocklist: [],
  requireMentionInGroups: true,
};

// ============================================================================
// Rate Limit Tracker
// ============================================================================

interface RateLimitEntry {
  /** Timestamps of processed messages (sliding window) */
  timestamps: number[];
  /** Last processed timestamp (for cooldown) */
  lastProcessed: number;
}

// ============================================================================
// GroupSecurityManager
// ============================================================================

export class GroupSecurityManager extends EventEmitter {
  private config: GroupSecurityConfig;
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  constructor(config: Partial<GroupSecurityConfig> = {}) {
    super();
    this.config = {
      ...DEFAULT_GROUP_SECURITY_CONFIG,
      ...config,
      // Deep-copy collections so mutations don't leak
      groupConfigs: config.groupConfigs
        ? new Map(config.groupConfigs)
        : new Map(),
      globalAllowlist: config.globalAllowlist
        ? [...config.globalAllowlist]
        : [],
      blocklist: config.blocklist
        ? [...config.blocklist]
        : [],
      mentionPatterns: config.mentionPatterns
        ? [...config.mentionPatterns]
        : [...DEFAULT_GROUP_SECURITY_CONFIG.mentionPatterns],
    };
  }

  // ==========================================================================
  // Main Gating Function
  // ==========================================================================

  /**
   * Determine whether an inbound message should be processed.
   *
   * DM (direct message) channels always pass through.
   * Group messages are checked against activation mode, mention patterns,
   * allowlists, blocklist, and rate limits.
   */
  shouldProcess(message: InboundMessage): ProcessResult {
    // If security is disabled, allow everything
    if (!this.config.enabled) {
      return { allowed: true, reason: 'group security disabled' };
    }

    // DMs always pass through - group security only applies to groups
    if (message.channel.isDM || !message.channel.isGroup) {
      return { allowed: true, reason: 'direct message' };
    }

    const groupId = message.channel.id;
    const senderId = message.sender.id;

    // Check global blocklist first
    if (this.config.blocklist.includes(senderId)) {
      const result: ProcessResult = { allowed: false, reason: 'user is on global blocklist' };
      this.emit('message:blocked', message, result.reason);
      logger.debug('Group security: blocked message (blocklist)', {
        groupId,
        senderId,
      });
      return result;
    }

    // Get group-specific config or fall back to defaults
    const groupConfig = this.config.groupConfigs.get(groupId);
    const activationMode = groupConfig?.activationMode ?? this.config.defaultMode;

    // Handle activation modes
    switch (activationMode) {
      case 'inactive': {
        const result: ProcessResult = { allowed: false, reason: 'group is inactive' };
        this.emit('message:blocked', message, result.reason);
        logger.debug('Group security: blocked message (inactive group)', { groupId });
        return result;
      }

      case 'active': {
        // Active mode: process all (but still check blocklist which is done above
        // and rate limits below)
        break;
      }

      case 'allowlist-only': {
        const allowedUsers = groupConfig?.allowedUsers ?? [];
        const isGloballyAllowed = this.config.globalAllowlist.includes(senderId);
        const isGroupAllowed = allowedUsers.includes(senderId);

        if (!isGloballyAllowed && !isGroupAllowed) {
          const result: ProcessResult = { allowed: false, reason: 'user not on allowlist' };
          this.emit('message:blocked', message, result.reason);
          logger.debug('Group security: blocked message (not on allowlist)', {
            groupId,
            senderId,
          });
          return result;
        }
        break;
      }

      case 'mention-only': {
        const requireMention = groupConfig?.requireMention ?? this.config.requireMentionInGroups;

        if (requireMention) {
          const patterns = groupConfig?.mentionPatterns ?? this.config.mentionPatterns;
          const hasMention = this.containsMention(message.content, patterns);

          if (!hasMention) {
            const result: ProcessResult = { allowed: false, reason: 'no mention detected' };
            this.emit('message:blocked', message, result.reason);
            logger.debug('Group security: blocked message (no mention)', {
              groupId,
              senderId,
            });
            return result;
          }
        }
        break;
      }
    }

    // Rate limiting
    const rateLimitResult = this.checkRateLimit(groupId, groupConfig);
    if (!rateLimitResult.allowed) {
      this.emit('message:rate-limited', message, rateLimitResult.reason);
      logger.debug('Group security: rate limited', {
        groupId,
        reason: rateLimitResult.reason,
      });
      return rateLimitResult;
    }

    // Record this message for rate limiting
    this.recordMessage(groupId);

    const result: ProcessResult = { allowed: true, reason: 'passed all checks' };
    this.emit('message:allowed', message);
    return result;
  }

  // ==========================================================================
  // Mention Detection
  // ==========================================================================

  /**
   * Check if message content contains any of the mention patterns.
   * Case-insensitive matching.
   */
  private containsMention(content: string, patterns: string[]): boolean {
    const lower = content.toLowerCase();
    return patterns.some(pattern => lower.includes(pattern.toLowerCase()));
  }

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================

  /**
   * Check if a group has exceeded its rate limit.
   */
  private checkRateLimit(groupId: string, groupConfig?: GroupConfig): ProcessResult {
    if (!groupConfig) {
      return { allowed: true, reason: 'no rate limit configured' };
    }

    const entry = this.rateLimits.get(groupId);
    if (!entry) {
      return { allowed: true, reason: 'no rate limit history' };
    }

    const now = Date.now();

    // Check cooldown
    if (groupConfig.cooldownMs && groupConfig.cooldownMs > 0) {
      const elapsed = now - entry.lastProcessed;
      if (elapsed < groupConfig.cooldownMs) {
        return {
          allowed: false,
          reason: `cooldown active (${groupConfig.cooldownMs - elapsed}ms remaining)`,
        };
      }
    }

    // Check messages per minute
    if (groupConfig.maxMessagesPerMinute && groupConfig.maxMessagesPerMinute > 0) {
      const oneMinuteAgo = now - 60_000;
      const recentCount = entry.timestamps.filter(ts => ts >= oneMinuteAgo).length;

      if (recentCount >= groupConfig.maxMessagesPerMinute) {
        return {
          allowed: false,
          reason: `rate limit exceeded (${recentCount}/${groupConfig.maxMessagesPerMinute} per minute)`,
        };
      }
    }

    return { allowed: true, reason: 'within rate limits' };
  }

  /**
   * Record a processed message for rate limiting purposes.
   */
  private recordMessage(groupId: string): void {
    const now = Date.now();
    let entry = this.rateLimits.get(groupId);

    if (!entry) {
      entry = { timestamps: [], lastProcessed: 0 };
      this.rateLimits.set(groupId, entry);
    }

    entry.timestamps.push(now);
    entry.lastProcessed = now;

    // Prune old timestamps (keep only last 2 minutes)
    const cutoff = now - 120_000;
    entry.timestamps = entry.timestamps.filter(ts => ts >= cutoff);
  }

  // ==========================================================================
  // Group Management
  // ==========================================================================

  /**
   * Add a group configuration.
   */
  addGroup(config: GroupConfig): void {
    this.config.groupConfigs.set(config.groupId, { ...config });
    logger.debug('Group security: added group', {
      groupId: config.groupId,
      mode: config.activationMode,
    });
  }

  /**
   * Remove a group configuration.
   */
  removeGroup(groupId: string): boolean {
    const existed = this.config.groupConfigs.delete(groupId);
    if (existed) {
      this.rateLimits.delete(groupId);
      logger.debug('Group security: removed group', { groupId });
    }
    return existed;
  }

  /**
   * Update a group configuration (partial merge).
   */
  updateGroup(groupId: string, partial: Partial<GroupConfig>): boolean {
    const existing = this.config.groupConfigs.get(groupId);
    if (!existing) {
      return false;
    }

    const updated: GroupConfig = { ...existing, ...partial, groupId };
    this.config.groupConfigs.set(groupId, updated);
    logger.debug('Group security: updated group', {
      groupId,
      mode: updated.activationMode,
    });
    return true;
  }

  /**
   * Get configuration for a specific group.
   */
  getGroupConfig(groupId: string): GroupConfig | undefined {
    const config = this.config.groupConfigs.get(groupId);
    return config ? { ...config } : undefined;
  }

  /**
   * List all configured groups.
   */
  listGroups(): GroupConfig[] {
    return Array.from(this.config.groupConfigs.values()).map(c => ({ ...c }));
  }

  // ==========================================================================
  // Allowlist Management
  // ==========================================================================

  /**
   * Add a user to a group's allowlist.
   */
  addToAllowlist(groupId: string, userId: string): boolean {
    const config = this.config.groupConfigs.get(groupId);
    if (!config) {
      return false;
    }

    if (!config.allowedUsers) {
      config.allowedUsers = [];
    }

    if (!config.allowedUsers.includes(userId)) {
      config.allowedUsers.push(userId);
      logger.debug('Group security: added user to allowlist', { groupId, userId });
    }
    return true;
  }

  /**
   * Remove a user from a group's allowlist.
   */
  removeFromAllowlist(groupId: string, userId: string): boolean {
    const config = this.config.groupConfigs.get(groupId);
    if (!config || !config.allowedUsers) {
      return false;
    }

    const index = config.allowedUsers.indexOf(userId);
    if (index === -1) {
      return false;
    }

    config.allowedUsers.splice(index, 1);
    logger.debug('Group security: removed user from allowlist', { groupId, userId });
    return true;
  }

  // ==========================================================================
  // Blocklist Management
  // ==========================================================================

  /**
   * Add a user to the global blocklist.
   */
  addToBlocklist(userId: string): void {
    if (!this.config.blocklist.includes(userId)) {
      this.config.blocklist.push(userId);
      logger.debug('Group security: added user to blocklist', { userId });
    }
  }

  /**
   * Remove a user from the global blocklist.
   */
  removeFromBlocklist(userId: string): boolean {
    const index = this.config.blocklist.indexOf(userId);
    if (index === -1) {
      return false;
    }

    this.config.blocklist.splice(index, 1);
    logger.debug('Group security: removed user from blocklist', { userId });
    return true;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get group security statistics.
   */
  getStats(): {
    enabled: boolean;
    totalGroups: number;
    defaultMode: GroupActivationMode;
    globalAllowlistSize: number;
    blocklistSize: number;
    groupsByMode: Record<string, number>;
  } {
    const groupsByMode: Record<string, number> = {};
    for (const config of this.config.groupConfigs.values()) {
      groupsByMode[config.activationMode] = (groupsByMode[config.activationMode] || 0) + 1;
    }

    return {
      enabled: this.config.enabled,
      totalGroups: this.config.groupConfigs.size,
      defaultMode: this.config.defaultMode,
      globalAllowlistSize: this.config.globalAllowlist.length,
      blocklistSize: this.config.blocklist.length,
      groupsByMode,
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Dispose all internal state and remove all listeners.
   */
  dispose(): void {
    this.config.groupConfigs.clear();
    this.config.globalAllowlist = [];
    this.config.blocklist = [];
    this.rateLimits.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let securityInstance: GroupSecurityManager | null = null;

/**
 * Get the singleton GroupSecurityManager instance.
 */
export function getGroupSecurity(config?: Partial<GroupSecurityConfig>): GroupSecurityManager {
  if (!securityInstance) {
    securityInstance = new GroupSecurityManager(config);
  }
  return securityInstance;
}

/**
 * Reset the singleton GroupSecurityManager (for testing).
 */
export function resetGroupSecurity(): void {
  if (securityInstance) {
    securityInstance.dispose();
  }
  securityInstance = null;
}
