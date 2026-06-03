/**
 * Mobile supervision IPC (S6).
 *
 * Surfaces the supervision-only mobile gateway in Cowork: read the pairing code
 * + follow-up review queue and approve/cancel queued drafts. All calls go to the
 * embedded Code Buddy server's loopback-gated `/api/mobile` routes via the
 * ServerBridge; nothing here dispatches work — approval stays a review marker.
 *
 * @module main/ipc/mobile-supervision-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import {
  fetchMobileSupervision,
  approveFollowupDraft,
  cancelFollowupDraft,
  rotatePairingCode,
} from '../server/mobile-supervision-client';

const SERVER_DOWN = 'Embedded server is not running — start it to manage mobile supervision.';

async function serverBridge() {
  const { getServerBridge } = await import('../server/server-bridge');
  return getServerBridge();
}

async function port(): Promise<number | null> {
  const status = await (await serverBridge()).status();
  return status.running ? status.port : null;
}

export function registerMobileSupervisionIpcHandlers(): void {
  ipcMain.handle('mobileSupervision.status', async () => {
    try {
      const status = await (await serverBridge()).status();
      return await fetchMobileSupervision(status.port, status.running, fetch as never);
    } catch (err) {
      logError('[mobileSupervision.status] failed:', err);
      return { running: false, port: null, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mobileSupervision.approve', async (_e, id: string, reviewer?: string) => {
    const p = await port();
    if (p == null) return { ok: false as const, error: SERVER_DOWN };
    try {
      await approveFollowupDraft(p, id, reviewer, fetch as never);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mobileSupervision.cancel', async (_e, id: string) => {
    const p = await port();
    if (p == null) return { ok: false as const, error: SERVER_DOWN };
    try {
      await cancelFollowupDraft(p, id, fetch as never);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mobileSupervision.rotateCode', async () => {
    const p = await port();
    if (p == null) return { ok: false as const, error: SERVER_DOWN };
    try {
      const res = await rotatePairingCode(p, fetch as never);
      return { ok: true as const, pairingCode: res.pairingCode as string | undefined };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
