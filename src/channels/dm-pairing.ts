/**
 * DM Pairing System
 *
 * OpenClaw-inspired access control for personal AI assistants exposed
 * to messaging platforms.
 *
 * When pairing mode is enabled:
 * 1. Unknown senders receive a pairing code
 * 2. Messages are NOT processed until the owner approves via:
 *    `pairing approve <channel> <code>`
 * 3. Approved senders are stored in a persistent allowlist
 * 4. Approved senders can interact freely until revoked
 *
 * This prevents unauthorized users from consuming API credits
 * or accessing private information through the bot.
 *
 * Usage:
 * ```typescript
 * const pairing = getDMPairing();
 *
 * // Check if a message sender is approved
 * const status = await pairing.checkSender(message);
 *
 * if (status.approved) {
 *   // Process message normally
 * } else {
 *   // Send pairing code to sender
 *   await channel.send({ content: `Pairing code: ${status.code}` });
 * }
 *
 * // Owner approves from CLI
 * pairing.approve('telegram', 'ABC123');
 * ```
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import * as crypto from 'crypto';
import type { ChannelType, InboundMessage } from './index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Pairing status for a sender
 */
export interface PairingStatus {
  /** Whether the sender is approved */
  approved: boolean;
  /** Pairing code (if not approved) */
  code?: string;
  /** When the code expires */
  expiresAt?: Date;
  /** Sender info */
  senderId: string;
  /** Channel type */
  channelType: ChannelType;
}

/**
 * An approved sender in the allowlist
 */
export interface ApprovedSender {
  /** Channel type */
  channelType: ChannelType;
  /** Sender ID on the channel */
  senderId: string;
  /** Display name at time of approval */
  displayName?: string;
  /** When approved */
  approvedAt: Date;
  /** Who approved (owner or auto) */
  approvedBy: string;
  /** Notes */
  notes?: string;
}

/**
 * A pending pairing request
 */
export interface PairingRequest {
  /** Pairing code */
  code: string;
  /** Channel type */
  channelType: ChannelType;
  /** Sender ID */
  senderId: string;
  /** Display name */
  displayName?: string;
  /** Message excerpt */
  messageExcerpt?: string;
  /** When the request was created */
  createdAt: Date;
  /** When the code expires */
  expiresAt: Date;
  /** Number of attempts */
  attempts: number;
}

/**
 * DM Pairing configuration
 */
export interface DMPairingConfig {
  /** Enable pairing mode */
  enabled: boolean;
  /** Channels that require pairing (empty = all) */
  pairingChannels: ChannelType[];
  /** Pairing code length */
  codeLength: number;
  /** Code expiry in milliseconds */
  codeExpiryMs: number;
  /** Maximum pending requests */
  maxPending: number;
  /** Maximum attempts before blocking */
  maxAttempts: number;
  /** Block duration after max attempts (ms) */
  blockDurationMs: number;
  /** Path to persist allowlist */
  allowlistPath?: string;
  /** Auto-approve from same session (CLI) */
  autoApproveCli: boolean;
  /** Message to send to unapproved senders */
  pairingMessage: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_DM_PAIRING_CONFIG: DMPairingConfig = {
  enabled: true,
  pairingChannels: ['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix'],
  codeLength: 6,
  codeExpiryMs: 15 * 60 * 1000, // 15 minutes
  maxPending: 100,
  maxAttempts: 5,
  blockDurationMs: 60 * 60 * 1000, // 1 hour
  autoApproveCli: true,
  pairingMessage: 'This assistant requires pairing. Your code is: {code}\nAsk the owner to approve with: pairing approve {channel} {code}',
};

// ============================================================================
// DM Pairing Manager
// ============================================================================

export class DMPairingManager extends EventEmitter {
  private config: DMPairingConfig;
  private allowlist: Map<string, ApprovedSender> = new Map();
  private pending: Map<string, PairingRequest> = new Map();
  private blocked: Map<string, number> = new Map(); // senderId -> unblock timestamp

  constructor(config: Partial<DMPairingConfig> = {}) {
    super();
    this.config = {
      ...DEFAULT_DM_PAIRING_CONFIG,
      ...config,
      allowlistPath: config.allowlistPath ??
        path.join(homedir(), '.codebuddy', 'credentials'),
    };
  }

  // ==========================================================================
  // Sender Checking
  // ==========================================================================

  /**
   * Check if a message sender is approved.
   * If not, generates a pairing code.
   */
  async checkSender(message: InboundMessage): Promise<PairingStatus> {
    const channelType = message.channel.type;
    const senderId = message.sender.id;

    // Skip pairing for non-pairing channels
    if (!this.requiresPairing(channelType)) {
      return { approved: true, senderId, channelType };
    }

    // Auto-approve CLI
    if (channelType === 'cli' && this.config.autoApproveCli) {
      return { approved: true, senderId, channelType };
    }

    // Check if blocked
    if (this.isBlocked(senderId)) {
      return { approved: false, senderId, channelType };
    }

    // Check allowlist
    const key = this.makeAllowlistKey(channelType, senderId);
    if (this.allowlist.has(key)) {
      return { approved: true, senderId, channelType };
    }

    // Generate or retrieve pairing code
    const pairingKey = `${channelType}:${senderId}`;
    let request = this.pending.get(pairingKey);

    if (!request || request.expiresAt < new Date()) {
      // Generate new code
      const code = this.generateCode();
      request = {
        code,
        channelType,
        senderId,
        displayName: message.sender.displayName || message.sender.username,
        messageExcerpt: message.content.slice(0, 100),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.codeExpiryMs),
        attempts: 0,
      };
      this.pending.set(pairingKey, request);
      this.emit('pairing:requested', request);
    }

    request.attempts++;

    // Block if too many attempts
    if (request.attempts > this.config.maxAttempts) {
      this.blocked.set(senderId, Date.now() + this.config.blockDurationMs);
      this.pending.delete(pairingKey);
      this.emit('pairing:blocked', senderId, channelType);
    }

    return {
      approved: false,
      code: request.code,
      expiresAt: request.expiresAt,
      senderId,
      channelType,
    };
  }

  /**
   * Get the pairing message for an unapproved sender
   */
  getPairingMessage(status: PairingStatus): string {
    if (status.approved || !status.code) return '';

    return this.config.pairingMessage
      .replace('{code}', status.code)
      .replace('{channel}', status.channelType);
  }

  // ==========================================================================
  // Approval
  // ==========================================================================

  /**
   * Approve a sender using a pairing code
   */
  approve(channelType: ChannelType, code: string, approvedBy = 'owner'): ApprovedSender | null {
    // Find the pending request with this code
    for (const [key, request] of this.pending) {
      if (request.channelType === channelType && request.code === code) {
        // Check expiry
        if (request.expiresAt < new Date()) {
          this.pending.delete(key);
          this.emit('pairing:expired', request);
          return null;
        }

        // Approve
        const sender: ApprovedSender = {
          channelType,
          senderId: request.senderId,
          displayName: request.displayName,
          approvedAt: new Date(),
          approvedBy,
        };

        const allowlistKey = this.makeAllowlistKey(channelType, request.senderId);
        this.allowlist.set(allowlistKey, sender);
        this.pending.delete(key);

        // Remove from blocked if applicable
        this.blocked.delete(request.senderId);

        this.emit('pairing:approved', sender);
        this.persistAllowlist().catch(() => {});

        return sender;
      }
    }

    return null;
  }

  /**
   * Directly approve a sender (without pairing code)
   */
  approveDirectly(
    channelType: ChannelType,
    senderId: string,
    approvedBy = 'owner',
    displayName?: string
  ): ApprovedSender {
    const sender: ApprovedSender = {
      channelType,
      senderId,
      displayName,
      approvedAt: new Date(),
      approvedBy,
    };

    const key = this.makeAllowlistKey(channelType, senderId);
    this.allowlist.set(key, sender);
    this.blocked.delete(senderId);

    this.emit('pairing:approved', sender);
    this.persistAllowlist().catch(() => {});

    return sender;
  }

  /**
   * Revoke approval for a sender
   */
  revoke(channelType: ChannelType, senderId: string): boolean {
    const key = this.makeAllowlistKey(channelType, senderId);
    const sender = this.allowlist.get(key);
    if (sender) {
      this.allowlist.delete(key);
      this.emit('pairing:revoked', sender);
      this.persistAllowlist().catch(() => {});
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Query
  // ==========================================================================

  /**
   * Check if a channel requires pairing
   */
  requiresPairing(channelType: ChannelType): boolean {
    if (!this.config.enabled) return false;
    if (this.config.pairingChannels.length === 0) return true;
    return this.config.pairingChannels.includes(channelType);
  }

  /**
   * Check if a sender is blocked
   */
  isBlocked(senderId: string): boolean {
    const unblockAt = this.blocked.get(senderId);
    if (!unblockAt) return false;
    if (Date.now() >= unblockAt) {
      this.blocked.delete(senderId);
      return false;
    }
    return true;
  }

  /**
   * Check if a sender is approved
   */
  isApproved(channelType: ChannelType, senderId: string): boolean {
    const key = this.makeAllowlistKey(channelType, senderId);
    return this.allowlist.has(key);
  }

  /**
   * List all approved senders
   */
  listApproved(): ApprovedSender[] {
    return Array.from(this.allowlist.values());
  }

  /**
   * List approved senders for a channel
   */
  listApprovedForChannel(channelType: ChannelType): ApprovedSender[] {
    return Array.from(this.allowlist.values())
      .filter(s => s.channelType === channelType);
  }

  /**
   * List pending pairing requests
   */
  listPending(): PairingRequest[] {
    // Clean expired
    const now = new Date();
    for (const [key, request] of this.pending) {
      if (request.expiresAt < now) {
        this.pending.delete(key);
      }
    }
    return Array.from(this.pending.values());
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  /**
   * Generate a pairing code
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0, I/1
    const bytes = crypto.randomBytes(this.config.codeLength);
    let code = '';
    for (let i = 0; i < this.config.codeLength; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  /**
   * Make allowlist key
   */
  private makeAllowlistKey(channelType: ChannelType, senderId: string): string {
    return `${channelType}:${senderId}`;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Persist allowlist to disk
   */
  async persistAllowlist(): Promise<void> {
    if (!this.config.allowlistPath) return;

    await fs.mkdir(this.config.allowlistPath, { recursive: true });

    // Group by channel type (like OpenClaw: <channel>-allowFrom.json)
    const byChannel: Record<string, ApprovedSender[]> = {};
    for (const sender of this.allowlist.values()) {
      if (!byChannel[sender.channelType]) {
        byChannel[sender.channelType] = [];
      }
      byChannel[sender.channelType].push(sender);
    }

    for (const [channelType, senders] of Object.entries(byChannel)) {
      const filePath = path.join(this.config.allowlistPath, `${channelType}-allowFrom.json`);
      await fs.writeFile(filePath, JSON.stringify(senders, null, 2));
    }
  }

  /**
   * Load allowlist from disk
   */
  async loadAllowlist(): Promise<void> {
    if (!this.config.allowlistPath) return;

    try {
      const files = await fs.readdir(this.config.allowlistPath);

      for (const file of files) {
        if (file.endsWith('-allowFrom.json')) {
          const filePath = path.join(this.config.allowlistPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const senders = JSON.parse(content) as ApprovedSender[];

          for (const sender of senders) {
            sender.approvedAt = new Date(sender.approvedAt);
            const key = this.makeAllowlistKey(sender.channelType, sender.senderId);
            this.allowlist.set(key, sender);
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getStats(): {
    enabled: boolean;
    totalApproved: number;
    totalPending: number;
    totalBlocked: number;
    approvedByChannel: Record<string, number>;
  } {
    const approvedByChannel: Record<string, number> = {};
    for (const sender of this.allowlist.values()) {
      approvedByChannel[sender.channelType] =
        (approvedByChannel[sender.channelType] || 0) + 1;
    }

    return {
      enabled: this.config.enabled,
      totalApproved: this.allowlist.size,
      totalPending: this.pending.size,
      totalBlocked: this.blocked.size,
      approvedByChannel,
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  dispose(): void {
    this.allowlist.clear();
    this.pending.clear();
    this.blocked.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let pairingInstance: DMPairingManager | null = null;

export function getDMPairing(config?: Partial<DMPairingConfig>): DMPairingManager {
  if (!pairingInstance) {
    pairingInstance = new DMPairingManager(config);
  }
  return pairingInstance;
}

export function resetDMPairing(): void {
  if (pairingInstance) {
    pairingInstance.dispose();
  }
  pairingInstance = null;
}
