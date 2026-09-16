import fs from 'fs';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGlobalEventBus } from '../../../src/events/event-bus.js';
import { FleetRoomClient } from '../../../src/fleet/rooms/room-client.js';
import { deriveRoomPublicKey } from '../../../src/fleet/rooms/room-event.js';
import { RoomStore } from '../../../src/fleet/rooms/room-store.js';
import { createApiKey, deleteApiKey } from '../../../src/server/auth/api-keys.js';
import { startServer, stopServer } from '../../../src/server/index.js';

const ALICE = '00000000000000000000000000000000000000000000000000000000000000e5';
const ENV_KEYS = ['CODEBUDDY_FLEET_ROOMS', 'CODEBUDDY_FLEET_ROOMS_DIR', 'CODEBUDDY_FLEET_ROOMS_CONFIG',
  'CODEBUDDY_FLEET_ROOMS_OBSERVATIONS', 'CODEBUDDY_FLEET_ROOMS_ROOM', 'CODEBUDDY_FLEET_ROOMS_MISSION',
  'CODEBUDDY_FLEET_ROOMS_IDENTITY', 'CODEBUDDY_FLEET_ROOMS_OBSERVATION_INTERVAL_MS', 'CODEBUDDY_SENSORY'] as const;

describe('buddy server wiring for fleet rooms', () => {
  let dir: string;
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string>>;
  const cleanups: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-server-'));
    process.env.CODEBUDDY_FLEET_ROOMS_DIR = path.join(dir, 'ledger');
    process.env.CODEBUDDY_FLEET_ROOMS_CONFIG = path.join(dir, 'rooms.json');
    process.env.CODEBUDDY_FLEET_ROOMS_OBSERVATIONS = 'false';
    process.env.CODEBUDDY_SENSORY = 'false';
    const alice = deriveRoomPublicKey(ALICE);
    fs.writeFileSync(process.env.CODEBUDDY_FLEET_ROOMS_CONFIG, JSON.stringify({
      version: 1,
      members: { [alice]: { name: 'alice' } },
      rooms: { general: { members: [alice] } },
    }));
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function boot() {
    const key = createApiKey({ name: 'rooms-server', userId: 'rooms-server', scopes: ['fleet:listen'] });
    cleanups.push(() => { deleteApiKey(key.apiKey.id, 'rooms-server'); });
    const handle = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: true,
      rateLimit: false,
      logging: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      await stopServer(handle.server).catch(() => undefined);
    };
    cleanups.push(stop);
    const { port } = handle.server.address() as AddressInfo;
    const client = new FleetRoomClient({ url: `ws://127.0.0.1:${port}/ws`, secretKey: ALICE, apiKey: key.key, autoReconnect: false });
    cleanups.push(() => client.close());
    return { client, stop };
  }

  it('opens the ledger on the bound port when CODEBUDDY_FLEET_ROOMS=true and releases it on stop', async () => {
    process.env.CODEBUDDY_FLEET_ROOMS = 'true';
    process.env.CODEBUDDY_FLEET_ROOMS_OBSERVATIONS = 'true';
    process.env.CODEBUDDY_FLEET_ROOMS_ROOM = 'general';
    process.env.CODEBUDDY_FLEET_ROOMS_MISSION = 'robot:server-test';
    process.env.CODEBUDDY_FLEET_ROOMS_OBSERVATION_INTERVAL_MS = '1000';
    process.env.CODEBUDDY_FLEET_ROOMS_IDENTITY = path.join(dir, 'identity.json');
    fs.writeFileSync(process.env.CODEBUDDY_FLEET_ROOMS_IDENTITY, JSON.stringify({ version: 1, secretKey: ALICE, publicKey: deriveRoomPublicKey(ALICE) }), { mode: 0o600 });
    const { client, stop } = await boot();
    await client.connect();
    const ack = await client.publish({ room: 'general', content: 'depuis buddy server' });
    const read = await client.fetch([{ '#h': ['general'] }]);
    expect(read.messages.map((m) => m.event.content)).toEqual(['depuis buddy server']);
    getGlobalEventBus().emit('sensory:perception', {
      source: 'system-vitals', metadata: { modality: 'system', kind: 'disk_low', payload: { diskPct: 94 } },
    });
    await vi.waitFor(async () => {
      const observations = await client.fetch([{ '#h': ['general'] }]);
      expect(observations.messages).toHaveLength(2);
      expect(JSON.parse(observations.messages[1]!.event.content)).toMatchObject({ missionId: 'robot:server-test', values: { diskPct: 94 } });
    }, { timeout: 4000, interval: 200 });
    await client.close();
    await stop();

    const reopened = new RoomStore({ directory: process.env.CODEBUDDY_FLEET_ROOMS_DIR });
    try {
      expect(reopened.get(ack.id)?.seq).toBe(ack.seq);
    } finally {
      reopened.close();
    }
  });

  it('registers nothing when the option is absent', async () => {
    delete process.env.CODEBUDDY_FLEET_ROOMS;
    const { client } = await boot();
    await expect(client.connect()).rejects.toThrow(/Unknown message type: fleet\.rooms\.hello/);
    expect(fs.existsSync(path.join(dir, 'ledger'))).toBe(false);
  });
});
