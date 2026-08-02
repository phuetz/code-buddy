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
  /** Session identity allowed to receive and answer this request. */
  initiator?: string;
}

export type ChannelSendFn = (message: string) => Promise<void>;
export type ApprovalResponseResult = 'accepted' | 'unknown' | 'identity_mismatch';

interface RegisteredChannel {
  channelType: string;
  send: ChannelSendFn;
  identity?: string;
}

// ============================================================================
// Remote Approval Service
// ============================================================================

export class RemoteApprovalService extends EventEmitter {
  private pending = new Map<string, ApprovalRequest>();
  private resolvers = new Map<string, (approved: boolean) => void>();
  private channels = new Map<string, RegisteredChannel[]>();
  private defaultTimeoutMs = 120_000; // 2 minutes

  /**
   * Register a messaging channel for forwarding approvals
   */
  registerChannel(channelType: string, sendFn: ChannelSendFn, identity?: string): () => void {
    const key = this.channelKey(channelType, identity);
    const registration: RegisteredChannel = {
      channelType,
      send: sendFn,
      ...(identity !== undefined ? { identity } : {}),
    };
    const registrations = this.channels.get(key) ?? [];
    registrations.push(registration);
    this.channels.set(key, registrations);
    logger.debug(`Remote approval channel registered: ${channelType}`);

    // A stale turn must not unregister a newer replacement for the same
    // channel/identity pair. Removing the newer turn restores the prior one.
    return () => {
      const current = this.channels.get(key);
      if (!current) return;
      const index = current.indexOf(registration);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.channels.delete(key);
    };
  }

  /**
   * Unregister a channel
   */
  unregisterChannel(channelType: string, identity?: string): void {
    if (identity !== undefined) {
      this.channels.delete(this.channelKey(channelType, identity));
      return;
    }
    // Preserve the original public API: omitting identity unregisters every
    // registration for that channel type.
    for (const [key, registrations] of this.channels) {
      if (registrations.some((channel) => channel.channelType === channelType)) {
        this.channels.delete(key);
      }
    }
  }

  /**
   * Check if any channels are registered
   */
  hasChannels(identity?: string): boolean {
    if (identity === undefined) return this.channels.size > 0;
    return this.hasChannelForIdentity(identity);
  }

  /** Check for a channel that is safe to use in this exact approval context. */
  hasChannelForIdentity(identity?: string): boolean {
    return Array.from(this.channels.values()).some((registrations) =>
      registrations.some((channel) => channel.identity === identity)
    );
  }

  /**
   * Request approval via remote channels.
   * Returns a promise that resolves to true (approved) or false (denied/expired).
   */
  async requestApproval(req: {
    toolName: string;
    summary: string;
    timeoutMs?: number;
    initiator?: string;
  }): Promise<boolean> {
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

    // Install the resolver and timeout before sending. A fast response received
    // while the channel send is still pending must not be lost.
    let timer: ReturnType<typeof setTimeout>;
    const approval = new Promise<boolean>((resolve) => {
      this.resolvers.set(id, (approved: boolean) => {
        clearTimeout(timer);
        resolve(approved);
      });
      timer = setTimeout(() => {
        if (request.status === 'pending') {
          request.status = 'expired';
          this.resolvers.delete(id);
          this.pending.delete(id);
          this.emit('approval-expired', request);
          resolve(false);
        }
      }, timeoutMs);
    });

    // Send only to the channel bound to the initiating session. Legacy callers
    // without an identity can use only identity-less registrations.
    const message = this.formatApprovalMessage(request);
    const targets = Array.from(this.channels.values())
      .map((registrations) => registrations.at(-1))
      .filter((channel): channel is RegisteredChannel =>
        channel !== undefined && (
          req.initiator === undefined
            ? channel.identity === undefined
            : channel.identity === req.initiator
        )
      );
    this.emit('approval-requested', request);

    // Delivery is best-effort and deliberately detached: expiration must still
    // resolve the caller if a channel transport never settles. Install a
    // microtask boundary so synchronous throws are caught too.
    for (const channel of targets) {
      void Promise.resolve()
        .then(() => channel.send(message))
        .catch((err: unknown) => {
          logger.warn(`Failed to send approval via ${channel.channelType}`, { error: err });
        });
    }

    return approval;
  }

  /**
   * Handle an approval response (called when user sends /approve or /deny)
   */
  handleResponse(requestId: string, approved: boolean, responder?: string): ApprovalResponseResult {
    const request = this.pending.get(requestId);
    const resolver = this.resolvers.get(requestId);

    if (!request || !resolver) {
      logger.warn(`Unknown or expired approval request: ${requestId}`);
      return 'unknown';
    }

    if (request.initiator !== undefined && responder !== request.initiator) {
      logger.warn(`Remote approval rejected for mismatched identity: ${requestId}`);
      return 'identity_mismatch';
    }

    request.status = approved ? 'approved' : 'denied';
    this.pending.delete(requestId);
    this.resolvers.delete(requestId);

    this.emit(approved ? 'approval-approved' : 'approval-denied', request);
    resolver(approved);
    return 'accepted';
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

  private channelKey(channelType: string, identity?: string): string {
    return `${channelType}\0${identity ?? ''}`;
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
