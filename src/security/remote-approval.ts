/**
 * Remote Approval Forwarding
 *
 * Forward tool execution approval requests to messaging channels
 * (Telegram, Discord, Slack) for remote /approve or /deny.
 * Enterprise-grade remote authorization flow.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
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
  /**
   * Identity that initiated the request (e.g. paired chat/session id). When set,
   * only a response from the SAME identity may approve/deny it — a different paired
   * user cannot approve someone else's pending high-risk tool call.
   */
  initiator?: string;
}

export type ChannelSendFn = (message: string) => Promise<void>;

// ============================================================================
// Remote Approval Service
// ============================================================================

export class RemoteApprovalService extends EventEmitter {
  private pending = new Map<string, ApprovalRequest>();
  private resolvers = new Map<string, (approved: boolean) => void>();
  private channels = new Map<string, ChannelSendFn>();
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
    /** Identity that initiated this request; only it may respond (see handleResponse). */
    initiator?: string;
  }): Promise<boolean> {
    // Unguessable ID: a sequential `approval-N` lets anyone with a paired DM approve
    // a request whose number they simply guessed.
    const id = `approval-${randomUUID()}`;
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    const request: ApprovalRequest = {
      id,
      toolName: req.toolName,
      summary: req.summary,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + timeoutMs),
      status: 'pending',
      ...(req.initiator !== undefined ? { initiator: req.initiator } : {}),
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
   * Handle an approval response (called when user sends /approve or /deny).
   *
   * @param responder Identity of the sender of the /approve|/deny. When the request
   *   carries an `initiator`, the responder MUST match it — a response from any other
   *   paired identity is refused, so one user cannot approve another's pending request.
   */
  handleResponse(requestId: string, approved: boolean, responder?: string): void {
    const request = this.pending.get(requestId);
    const resolver = this.resolvers.get(requestId);

    if (!request || !resolver) {
      logger.warn(`Unknown or expired approval request: ${requestId}`);
      return;
    }

    if (request.initiator !== undefined && responder !== undefined && responder !== request.initiator) {
      logger.warn(
        `Remote approval ${requestId} rejected: responder does not match the initiating identity`,
      );
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
