/**
 * Mobile PWA confirmation bridge.
 *
 * confirmation_required {id, tool, summary, risk}
 *   → confirmation_response {id, approved}
 *
 * Fail-closed: timeout or missing clients = deny.
 * One response per id. JWT/auth required (empty principal scopes).
 * Bound to the approval-capable `tools` sockets that received the prompt.
 */

import { randomUUID } from 'node:crypto';
import type { ConfirmationOptions, ConfirmationResult } from '../../utils/confirmation-service.js';
import { ConfirmationService } from '../../utils/confirmation-service.js';
import { logger } from '../../utils/logger.js';
import type { WebSocketResponse } from '../types.js';
import type { WebSocketExtensionRegistration, WsBroadcastTarget } from './handler.js';

export const DEFAULT_MOBILE_CONFIRM_TIMEOUT_MS = 30_000;

interface PendingConfirmation {
  resolve: (result: ConfirmationResult) => void;
  timer: ReturnType<typeof setTimeout>;
  answered: boolean;
  recipientIds: Set<string>;
}

const pending = new Map<string, PendingConfirmation>();
let wired = false;
let unwireFn: (() => void) | null = null;

export function resolveMobileConfirmTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS;
  if (!raw) return DEFAULT_MOBILE_CONFIRM_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MOBILE_CONFIRM_TIMEOUT_MS;
}

export function pendingMobileConfirmationCount(): number {
  return pending.size;
}

export function clearPendingMobileConfirmations(reason = 'Confirmation cancelled'): void {
  for (const [id, entry] of pending.entries()) {
    clearTimeout(entry.timer);
    if (!entry.answered) {
      entry.answered = true;
      entry.resolve({ confirmed: false, feedback: reason });
    }
    pending.delete(id);
  }
}

function riskOf(options: ConfirmationOptions): string {
  return options.riskLevel ?? 'medium';
}

export function wireMobileConfirmationBridge(deps: {
  broadcast: (
    message: WebSocketResponse,
    scopeFilter?: string,
    targetFilter?: (target: WsBroadcastTarget) => boolean,
  ) => string[] | void;
  collectApprovalSurfaceIds: () => string[];
  registerExtension: (registration: WebSocketExtensionRegistration) => () => void;
}): () => void {
  if (wired && unwireFn) return unwireFn;

  const handleResponse: WebSocketExtensionRegistration['handle'] = (ctx, payload) => {
    if (ctx.principal.anonymousRemote) {
      ctx.send({
        type: 'error',
        error: { code: 'UNAUTHORIZED', message: 'Remote confirmation requires authentication' },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (ctx.principal.scopes.length === 0) {
      ctx.send({
        type: 'error',
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!ctx.principal.scopes.includes('tools')) {
      ctx.send({
        type: 'error',
        error: { code: 'FORBIDDEN', message: 'tools scope required' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as { id?: unknown; approved?: unknown }
      : {};
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      ctx.send({
        type: 'error',
        error: { code: 'INVALID_REQUEST', message: 'confirmation id is required' },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (typeof body.approved !== 'boolean') {
      ctx.send({
        type: 'error',
        error: { code: 'INVALID_REQUEST', message: 'approved must be a boolean' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const entry = pending.get(id);
    if (!entry) {
      ctx.send({
        type: 'error',
        error: { code: 'UNKNOWN_CONFIRMATION', message: 'Unknown or expired confirmation id' },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (entry.answered) {
      ctx.send({
        type: 'error',
        error: { code: 'ALREADY_ANSWERED', message: 'Confirmation already answered' },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!entry.recipientIds.has(ctx.connectionId)) {
      logger.warn('[ws] confirmation_response ignored — socket is not a recipient', {
        connectionId: ctx.connectionId,
        confirmationId: id,
      });
      return;
    }

    entry.answered = true;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve({ confirmed: body.approved });
  };

  const unregister = deps.registerExtension({
    type: 'confirmation_response',
    bypassLane: true,
    handle: handleResponse,
  });

  ConfirmationService.getInstance().setWsApprovalBridge(async (options) => {
    const recipientIds = deps.collectApprovalSurfaceIds();
    if (recipientIds.length === 0) return null;
    const recipientSet = new Set(recipientIds);

    const id = randomUUID();
    const tool = options.toolName ?? options.operation;
    const summary = `${options.operation}: ${options.filename}`;
    const timeoutMs = resolveMobileConfirmTimeoutMs();

    return new Promise<ConfirmationResult>((resolve) => {
      const timer = setTimeout(() => {
        const current = pending.get(id);
        if (!current || current.answered) return;
        current.answered = true;
        pending.delete(id);
        resolve({ confirmed: false, feedback: 'Confirmation timed out' });
      }, timeoutMs);
      timer.unref();
      pending.set(id, { resolve, timer, answered: false, recipientIds: recipientSet });
      deps.broadcast(
        {
          type: 'confirmation_required',
          payload: {
            id,
            tool,
            summary,
            risk: riskOf(options),
          },
          timestamp: new Date().toISOString(),
        },
        'tools',
        (target) => recipientSet.has(target.id),
      );
    });
  });

  wired = true;
  unwireFn = () => {
    unregister();
    ConfirmationService.getInstance().setWsApprovalBridge(null);
    clearPendingMobileConfirmations();
    wired = false;
    unwireFn = null;
  };
  return unwireFn;
}
