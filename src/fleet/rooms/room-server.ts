/**
 * Fleet rooms — opt-in startup for `buddy server`.
 *
 * `CODEBUDDY_FLEET_ROOMS=true` opens the ledger (exclusive lock), loads the room
 * policy and registers the `fleet.rooms.*` WebSocket messages. Unset, nothing is
 * opened or registered: `/ws` answers `UNKNOWN_TYPE` exactly as before.
 *
 * Accepted auth audiences: the loopback URLs of the listening port, plus the
 * canonical URLs listed in `CODEBUDDY_FLEET_ROOMS_AUDIENCE` (csv) — the address
 * remote members dial (e.g. `ws://ministar-linux:3000/ws`). A hub never accepts
 * a proof addressed to a URL it was not told is its own.
 *
 * @module fleet/rooms/room-server
 */

import { logger } from '../../utils/logger.js';
import { RoomAccessPolicy } from './room-access.js';
import { canonicalRoomAudience } from './room-event.js';
import { RoomHub } from './room-hub.js';
import { startRoomObservations } from './room-observations.js';
import { RoomStore } from './room-store.js';
import { wireFleetRoomsBridge } from './room-ws-bridge.js';

export interface FleetRoomsHandle {
  readonly hub: RoomHub;
  readonly store: RoomStore;
  readonly audiences: readonly string[];
  stop(): void;
}

export function fleetRoomsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_FLEET_ROOMS === 'true';
}

export function resolveFleetRoomsAudiences(port: number, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new RangeError('port must be an integer between 1 and 65535');
  }
  const audiences = [`ws://127.0.0.1:${port}/ws`, `ws://localhost:${port}/ws`, `ws://[::1]:${port}/ws`];
  for (const entry of (env.CODEBUDDY_FLEET_ROOMS_AUDIENCE ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed) audiences.push(canonicalRoomAudience(trimmed));
  }
  return [...new Set(audiences.map((audience) => canonicalRoomAudience(audience)))];
}

export function startFleetRooms(options: { port: number; env?: NodeJS.ProcessEnv }): FleetRoomsHandle {
  const env = options.env ?? process.env;
  const audiences = resolveFleetRoomsAudiences(options.port, env);
  const store = new RoomStore({ directory: env.CODEBUDDY_FLEET_ROOMS_DIR });
  let unwire: (() => void) | undefined;
  let stopObservations: (() => void) | undefined;
  let hub: RoomHub;
  try {
    hub = new RoomHub({ store, access: new RoomAccessPolicy({ path: env.CODEBUDDY_FLEET_ROOMS_CONFIG }), audiences });
    unwire = wireFleetRoomsBridge(hub);
  } catch (error) {
    store.close();
    throw error;
  }
  try {
    stopObservations = startRoomObservations(hub, { env });
  } catch {
    logger.warn('[fleet-rooms] observations disabled: check the configured mission, identity and room permissions');
  }
  logger.info('[fleet-rooms] enabled on /ws', { storeId: store.storeId, audiences: audiences.length });
  let stopped = false;
  return {
    hub,
    store,
    audiences,
    stop: () => {
      if (stopped) return;
      stopped = true;
      stopObservations?.();
      unwire?.();
      hub.close();
      store.close();
    },
  };
}
