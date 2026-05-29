/**
 * Channels IPC (read-only) — surfaces the core ChannelManager's per-channel
 * connection status to Cowork. Wraps `getChannelManager().getStatus()`
 * (`src/channels/core.ts`). Read-only: configuring / sending stays on the CLI
 * (`buddy` channel layer + cron delivery), and the free-form `info` blob (which
 * may carry tokens/ids) is dropped before crossing to the renderer.
 *
 * @module main/ipc/channels-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';

export interface ChannelStatusDTO {
  type: string;
  connected: boolean;
  authenticated: boolean;
  lastActivity?: number;
  error?: string;
}

interface CoreChannelStatus {
  type: string;
  connected: boolean;
  authenticated: boolean;
  lastActivity?: Date | number;
  error?: string;
  info?: Record<string, unknown>;
}

interface ChannelManagerLike {
  getStatus(): Record<string, CoreChannelStatus>;
}

type ChannelsMod = { getChannelManager: () => ChannelManagerLike };

/** Surface only safe scalar fields; drop the free-form `info` blob (may hold secrets). */
function toDTO(s: CoreChannelStatus): ChannelStatusDTO {
  const lastActivity =
    s.lastActivity instanceof Date ? s.lastActivity.getTime() : typeof s.lastActivity === 'number' ? s.lastActivity : undefined;
  return {
    type: s.type,
    connected: !!s.connected,
    authenticated: !!s.authenticated,
    ...(lastActivity !== undefined ? { lastActivity } : {}),
    ...(s.error ? { error: s.error } : {}),
  };
}

export function registerChannelsIpcHandlers(): void {
  ipcMain.handle('channels.status', async () => {
    try {
      const mod = await loadCoreModule<ChannelsMod>('channels/core.js');
      if (!mod?.getChannelManager) {
        return { ok: false as const, error: 'core channels module unavailable', items: [] as ChannelStatusDTO[] };
      }
      const status = mod.getChannelManager().getStatus();
      const items = Object.values(status ?? {}).map(toDTO);
      return { ok: true as const, items };
    } catch (err) {
      logError('[channels.status] failed:', err);
      return { ok: false as const, error: err instanceof Error ? err.message : String(err), items: [] as ChannelStatusDTO[] };
    }
  });
}
