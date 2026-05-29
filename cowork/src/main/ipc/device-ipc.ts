/**
 * Device IPC (C3) — read-only view of paired device nodes (SSH/ADB/local) from
 * Cowork. Wraps core `DeviceNodeManager.getInstance().listDevices()`
 * (`src/nodes/device-node.ts`, global `~/.codebuddy/devices.json`). Read-only:
 * pairing/removal stay on the CLI (`buddy device`), and secrets (pairing token,
 * key path) are redacted before crossing to the renderer.
 *
 * @module main/ipc/device-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';

export interface DeviceNodeDTO {
  id: string;
  name: string;
  type: string;
  transportType: string;
  capabilities: string[];
  paired: boolean;
  lastSeen: number;
  address?: string;
  port?: number;
  username?: string;
}

interface DeviceNode {
  id: string;
  name: string;
  type: string;
  transportType: string;
  capabilities: string[];
  paired: boolean;
  lastSeen: number;
  address?: string;
  port?: number;
  username?: string;
  keyPath?: string;
  pairingToken?: unknown;
}

interface DeviceManagerLike {
  listDevices(): DeviceNode[];
}

type DeviceMod = { DeviceNodeManager: { getInstance(): DeviceManagerLike } };

/** Redact secrets (pairing token, key path) before sending to the renderer. */
function toDTO(d: DeviceNode): DeviceNodeDTO {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    transportType: d.transportType,
    capabilities: Array.isArray(d.capabilities) ? d.capabilities : [],
    paired: !!d.paired,
    lastSeen: d.lastSeen,
    address: d.address,
    port: d.port,
    username: d.username,
  };
}

export function registerDeviceIpcHandlers(): void {
  ipcMain.handle('deviceNodes.list', async () => {
    try {
      const mod = await loadCoreModule<DeviceMod>('nodes/device-node.js');
      if (!mod?.DeviceNodeManager) {
        return { ok: false as const, error: 'core device module unavailable', items: [] as DeviceNodeDTO[] };
      }
      const items = mod.DeviceNodeManager.getInstance().listDevices().map(toDTO);
      return { ok: true as const, items };
    } catch (err) {
      logError('[deviceNodes.list] failed:', err);
      return { ok: false as const, error: err instanceof Error ? err.message : String(err), items: [] as DeviceNodeDTO[] };
    }
  });
}
