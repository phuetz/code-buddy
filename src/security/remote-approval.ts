/**
 * Remote Approval Forwarding
 *
 * Forward tool execution approval requests to messaging channels
 * (Telegram, Discord, Slack) for remote /approve or /deny.
 * OpenClaw-inspired remote authorization flow.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ApprovalRequest {
  /** Unique request ID */
  id: string;
  /** Tool name requiring approval */
  toolName: string;
  /** Human-readable summary of what's being approved */
  summary: string;
  /** When the request was created */
  requestedAt: Date;
  /** When the request expires */
  expiresAt: Date;
  /** Current status */
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

export type ChannelSendFn = (message: string) => Promise<void>;

// ============================================================================
// Remote Approval Service
// ============================================================================

export class RemoteApprovalService extends EventEmitter {
  private pending = new Map<string, ApprovalRequest>();
  private resolvers = new Map<string, (approved: boolean) => void>();
  private channels = new Map<string, ChannelSendFn>();
  private nextId = 1;
  private defaultTimeoutMs = 120_000; // 2 minutes

  /**
   * Register a messaging channel for forwarding approvals
   */
  registerChannel(channelType: string, sendFn: ChannelSendFn): void {
    this.channels.set(channelType, sendFn);
    logger.debug(`Remote approval channel registered: ${channelType}`);
  }

  /**
   * Unregister a channel
   */
  unregisterChannel(channelType: string): void {
    this.channels.delete(channelType);
  }

  /**
   * Check if any channels are registered
   */
  hasChannels(): boolean {
    return this.channels.size > 0;
  }

  /**
   * Request approval via remote channels.
   * Returns a promise that resolves to true (approved) or false (denied/expired).
   */
  async requestApproval(req: {
    toolName: string;
    summary: string;
    timeoutMs?: number;
  }): Promise<boolean> {
    const id = `approval-${this.nextId++}`;
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    const request: ApprovalRequest = {
      id,
      toolName: req.toolName,
      summary: req.summary,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + timeoutMs),
      status: 'pending',
    };

    this.pending.set(id, request);

    // Broadcast to all registered channels
    const message = this.formatApprovalMessage(request);
    const sendPromises = Array.from(this.channels.entries()).map(
      async ([type, send]) => {
        try {
          await send(message);
        } catch (err) {
          logger.warn(`Failed to send approval to ${type}`, { error: err });
        }
      }
    );
    await Promise.allSettled(sendPromises);

    this.emit('approval-requested', request);

    // Wait for response or timeout
    return new Promise<boolean>((resolve) => {
      this.resolvers.set(id, resolve);

      // Timeout handler
      const timer = setTimeout(() => {
        if (request.status === 'pending') {
          request.status = 'expired';
          this.resolvers.delete(id);
          this.pending.delete(id);
          this.emit('approval-expired', request);
          resolve(false);
        }
      }, timeoutMs);

      // Clean up timer if resolved early
      const originalResolve = resolve;
      this.resolvers.set(id, (approved: boolean) => {
        clearTimeout(timer);
        originalResolve(approved);
      });
    });
  }

  /**
   * Handle an approval response (called when user sends /approve or /deny)
   */
  handleResponse(requestId: string, approved: boolean): void {
    const request = this.pending.get(requestId);
    const resolver = this.resolvers.get(requestId);

    if (!request || !resolver) {
      logger.warn(`Unknown or expired approval request: ${requestId}`);
      return;
    }

    request.status = approved ? 'approved' : 'denied';
    this.pending.delete(requestId);
    this.resolvers.delete(requestId);

    this.emit(approved ? 'approval-approved' : 'approval-denied', request);
    resolver(approved);
  }

  /**
   * Get all pending approval requests
   */
  getPending(): ApprovalRequest[] {
    return Array.from(this.pending.values());
  }

  /**
   * Format the approval message for channels
   */
  private formatApprovalMessage(request: ApprovalRequest): string {
    const expiresIn = Math.round((request.expiresAt.getTime() - Date.now()) / 1000);
    return [
      `🔐 **Approval Required**`,
      `Tool: \`${request.toolName}\``,
      `Summary: ${request.summary}`,
      `Request ID: \`${request.id}\``,
      `Expires in: ${expiresIn}s`,
      ``,
      `Reply with \`/approve ${request.id}\` or \`/deny ${request.id}\``,
    ].join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let remoteApprovalInstance: RemoteApprovalService | null = null;

export function getRemoteApprovalService(): RemoteApprovalService {
  if (!remoteApprovalInstance) {
    remoteApprovalInstance = new RemoteApprovalService();
  }
  return remoteApprovalInstance;
}

export function resetRemoteApprovalService(): void {
  remoteApprovalInstance = null;
}
