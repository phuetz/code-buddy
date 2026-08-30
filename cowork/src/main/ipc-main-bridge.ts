// cowork/src/main/ipc-main-bridge.ts
import { BrowserWindow } from 'electron';
import type { ServerEvent } from '../renderer/types';
import { getMainWindow } from './window-management';
import { remoteManager as remoteManagerInstance } from './remote/remote-manager'; // Import the remoteManager instance
import { log, logError } from './utils/logger'; // Import logger

type PermissionResponse = 'allow' | 'allow_always' | 'deny';
type PermissionResponder = (
  toolUseId: string,
  response: PermissionResponse,
  bridgeId?: string
) => void;

let permissionResponder: PermissionResponder | null = null;

export function setPermissionResponder(responder: PermissionResponder | null): void {
  permissionResponder = responder;
}

/**
 * Tool-confirmation / credential events that MUST reach the renderer the user
 * is actually looking at, on time — a dropped or mis-routed one silently
 * expires (DesktopPermissionBridge attend jusqu'à 5 min 30 s côté distant,
 * and every gated `create_file` fails). The general event stream targets the
 * single canonical `getMainWindow()`, which is correct while exactly one app
 * window exists; but confirmations are load-bearing, so we deliver them to the
 * ACTIVE (focused) app window in addition to the canonical main window —
 * deduped, skipping destroyed windows. In the normal single-window case the
 * focused window IS the main window, so this is byte-identical; it only adds a
 * recipient when the active renderer ever diverges from `getMainWindow()`
 * (a second window, a focus/window-recreation race), guaranteeing the modal is
 * never delivered to a background renderer alone. It never DROPS the historical
 * recipient. See `tests` regression: `e2e/appstudio-confirm-repro.spec.ts`.
 */
const CONFIRMATION_EVENT_TYPES = new Set<string>([
  'permission.request',
  'permission.dismiss',
  'sudo.password.request',
  'sudo.password.dismiss',
]);
const pendingConfirmationEvents = new Map<string, ServerEvent>();
const MAX_PENDING_CONFIRMATIONS = 50;

function confirmationEventKey(event: ServerEvent): string {
  const payload = 'payload' in event
    ? event.payload as { toolUseId?: string }
    : undefined;
  const family = event.type.startsWith('sudo.') ? 'sudo' : 'permission';
  return `${family}:${payload?.toolUseId ?? event.type}`;
}

function queueConfirmationEvent(event: ServerEvent): void {
  const key = confirmationEventKey(event);
  if (event.type.endsWith('.dismiss')) {
    pendingConfirmationEvents.delete(key);
    return;
  }
  pendingConfirmationEvents.set(key, event);
  while (pendingConfirmationEvents.size > MAX_PENDING_CONFIRMATIONS) {
    const oldest = pendingConfirmationEvents.keys().next().value;
    if (!oldest) break;
    pendingConfirmationEvents.delete(oldest);
  }
}

export function flushPendingConfirmations(): void {
  const targets = confirmationTargets();
  if (targets.length === 0 || pendingConfirmationEvents.size === 0) return;
  const pending = [...pendingConfirmationEvents.values()];
  pendingConfirmationEvents.clear();
  for (const event of pending) {
    for (const win of targets) {
      win.webContents.send('server-event', event);
    }
  }
}

/** Live app windows that should receive a confirmation event: the focused
 *  window (the active renderer) plus the canonical main window, deduped and
 *  excluding destroyed/offscreen (never-focusable) windows. */
function confirmationTargets(): BrowserWindow[] {
  const targets: BrowserWindow[] = [];
  const seen = new Set<number>();
  const push = (win: BrowserWindow | null | undefined) => {
    if (!win || win.isDestroyed() || seen.has(win.id)) return;
    seen.add(win.id);
    targets.push(win);
  };
  // Focused first so the active renderer is always covered even if the
  // canonical main-window ref is momentarily stale.
  push(BrowserWindow.getFocusedWindow());
  push(getMainWindow());
  return targets;
}

function sendToLocalRenderer(event: ServerEvent): void {
  // Confirmation-critical events go to the ACTIVE (focused) app window as well
  // as the canonical main window, so a tool-approval modal can never land only
  // on a background renderer and silently expire. Everything else keeps the
  // historical single-target `getMainWindow()` path.
  if (CONFIRMATION_EVENT_TYPES.has(event.type)) {
    const targets = confirmationTargets();
    if (targets.length > 0) {
      flushPendingConfirmations();
      for (const win of targets) {
        win.webContents.send('server-event', event);
      }
      return;
    }
    queueConfirmationEvent(event);
    log(`[ipc-main-bridge] queued confirmation ${event.type} — no live window`);
    return;
  }

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-event', event);
  } else {
    // Helps catch regressions of the "main/index.ts and window-management.ts
    // each held a separate `let mainWindow` so getMainWindow() always
    // returned null" bug — kept as a warning rather than spam.
    logError(
      `[ipc-main-bridge] dropped ${event.type} — mainWindow=${!!mainWindow} destroyed=${mainWindow?.isDestroyed()}`
    );
  }
}

/**
 * Sends an event to the renderer process of the main window.
 * This function also intercepts remote session events and handles them appropriately.
 * @param event The ServerEvent to send.
 */
export function sendToRenderer(event: ServerEvent) {
  const payload =
    'payload' in event
      ? (event.payload as { sessionId?: string; [key: string]: unknown })
      : undefined;
  const sessionId = payload?.sessionId;

  // Determine if this event belongs to a remote session
  if (sessionId && remoteManagerInstance.isRemoteSession(sessionId)) {
    // Process remote session events
    if (event.type === 'stream.message') {
      const message = payload.message as {
        role?: string;
        content?: Array<{ type: string; text?: string }>;
      };
      if (message?.role === 'assistant' && message?.content) {
        const textContent = message.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n');

        if (textContent) {
          remoteManagerInstance.sendResponseToChannel(sessionId, textContent).catch((err: Error) => {
            logError('[Remote] Failed to send response to channel:', err);
          });
        }
      }
    } else if (event.type === 'trace.step') {
      const step = payload.step as {
        type?: string;
        toolName?: string;
        status?: string;
        title?: string;
      };
      if (step?.type === 'tool_call' && step?.toolName) {
        remoteManagerInstance
          .sendToolProgress(
            sessionId,
            step.toolName,
            step.status === 'completed'
              ? 'completed'
              : step.status === 'error'
                ? 'error'
                : 'running'
          )
          .catch((err: Error) => {
            logError('[Remote] Failed to send tool progress:', err);
          });
      }
    } else if (event.type === 'session.status') {
      const status = payload.status as string;
      if (status === 'idle' || status === 'error') {
        remoteManagerInstance.clearSessionBuffer(sessionId).catch((err: Error) => {
          logError('[Remote] Failed to clear session buffer:', err);
        });
      }
    } else if (event.type === 'permission.request' && payload.toolUseId && payload.toolName) {
      log('[Remote] Intercepting permission for remote session:', sessionId);
      remoteManagerInstance
        .handlePermissionRequest(
          sessionId,
          payload.toolUseId as string,
          payload.toolName as string,
          (payload.input as Record<string, unknown> | undefined) ?? {}
        )
        .then((result) => {
          if (result === null) {
            sendToLocalRenderer(event);
            return;
          }
          if (!permissionResponder) {
            logError('[Remote] Permission response dropped: responder is not configured');
            return;
          }
          permissionResponder(
            payload.toolUseId as string,
            result.allow ? (result.remember ? 'allow_always' : 'allow') : 'deny',
            typeof payload.bridgeId === 'string' ? payload.bridgeId : undefined
          );
        })
        .catch((err) => {
          logError('[Remote] Failed to handle permission request:', err);
        });
      return; // Do not send to local UI if handled remotely
    }
  }

  sendToLocalRenderer(event);
}
