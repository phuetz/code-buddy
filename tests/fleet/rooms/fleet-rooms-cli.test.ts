import { Command } from 'commander';
import fs from 'fs';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerFleetRoomsCommands } from '../../../src/commands/cli/fleet-rooms-commands.js';
import { RoomAccessPolicy } from '../../../src/fleet/rooms/room-access.js';
import { deriveRoomPublicKey } from '../../../src/fleet/rooms/room-event.js';
import { RoomHub } from '../../../src/fleet/rooms/room-hub.js';
import { RoomStore } from '../../../src/fleet/rooms/room-store.js';
import { wireFleetRoomsBridge } from '../../../src/fleet/rooms/room-ws-bridge.js';
import { createApiKey, deleteApiKey } from '../../../src/server/auth/api-keys.js';
import { DEFAULT_SERVER_CONFIG } from '../../../src/server/types.js';
import { setupWebSocket } from '../../../src/server/websocket/handler.js';

describe('buddy fleet rooms CLI', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function run(args: string[]): Promise<string[]> {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => { lines.push(parts.join(' ')); });
    const error = vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { lines.push(`ERR ${parts.join(' ')}`); });
    const fleet = new Command('fleet').exitOverride();
    registerFleetRoomsCommands(fleet);
    try {
      await fleet.parseAsync(['node', 'fleet', ...args]);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    return lines;
  }

  it('creates an identity, posts, and catches up with a cursor file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-cli-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const identity = path.join(dir, 'identity.json');

    const [created] = await run(['rooms', 'identity', 'init', '--identity', identity, '--json']);
    const { publicKey } = JSON.parse(created as string) as { publicKey: string };
    const stored = JSON.parse(fs.readFileSync(identity, 'utf8')) as { secretKey: string };
    expect(deriveRoomPublicKey(stored.secretKey)).toBe(publicKey);
    expect(created).not.toContain(stored.secretKey);
    if (process.platform !== 'win32') expect(fs.statSync(identity).mode & 0o777).toBe(0o600);
    expect((await run(['rooms', 'identity', 'init', '--identity', identity]))[0]).toMatch(/already exists/);
    process.exitCode = undefined;

    const key = createApiKey({ name: 'rooms-cli', userId: 'rooms-cli', scopes: ['fleet:listen'] });
    cleanups.push(() => { deleteApiKey(key.apiKey.id, 'rooms-cli'); });
    const server = createServer();
    const wss = await setupWebSocket(server, { ...DEFAULT_SERVER_CONFIG, authEnabled: true });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected a TCP address');
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const store = new RoomStore({ directory: path.join(dir, 'ledger') });
    const hub = new RoomHub({
      store,
      audiences: [url],
      access: new RoomAccessPolicy({
        config: { version: 1, members: { [publicKey]: { name: 'cli' } }, rooms: { general: { members: [publicKey] } } },
      }),
    });
    const unwire = wireFleetRoomsBridge(hub);
    cleanups.push(async () => {
      unwire();
      hub.close();
      store.close();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const connection = ['--url', url, '--api-key', key.key, '--identity', identity];

    const [posted] = await run(['rooms', 'post', 'general', 'build', 'vert', 'sur', 'peer-alpha', ...connection, '--json']);
    expect(JSON.parse(posted as string)).toMatchObject({ seq: 1, duplicate: false });

    const cursorFile = path.join(dir, 'cursor.json');
    const [firstRead] = await run(['rooms', 'read', 'general', '--cursor', cursorFile, ...connection, '--json']);
    const firstPayload = JSON.parse(firstRead as string) as { messages: Array<{ text: string; seq: number }>; cursor: { throughSeq: number } };
    expect(firstPayload.messages.map((m) => m.text)).toEqual(['build vert sur peer-alpha']);
    expect(JSON.parse(fs.readFileSync(cursorFile, 'utf8'))).toMatchObject({ version: 1, room: 'general', throughSeq: 1 });

    await run(['rooms', 'post', 'general', 'second', ...connection]);
    const [secondRead] = await run(['rooms', 'read', 'general', '--cursor', cursorFile, ...connection, '--json']);
    expect((JSON.parse(secondRead as string) as { messages: Array<{ text: string }> }).messages.map((m) => m.text)).toEqual(['second']);
    const [thirdRead] = await run(['rooms', 'read', 'general', '--cursor', cursorFile, ...connection, '--json']);
    expect(JSON.parse(thirdRead as string)).toMatchObject({ messages: [], cursor: { throughSeq: 2 } });
    expect(process.exitCode).toBeUndefined();

    // A tail must save the initial EOSE cursor even when no live message follows.
    const tailCursor = path.join(dir, 'tail-cursor.json');
    const beforeInt = process.listenerCount('SIGINT');
    const beforeTerm = process.listenerCount('SIGTERM');
    const tail = run(['rooms', 'tail', 'general', '--cursor', tailCursor, ...connection, '--json']);
    try {
      await vi.waitFor(() => {
        expect(JSON.parse(fs.readFileSync(tailCursor, 'utf8'))).toMatchObject({ throughSeq: 2, storeId: store.storeId });
      });
    } finally {
      process.emit('SIGINT');
      await tail;
    }
    expect(process.listenerCount('SIGINT')).toBe(beforeInt);
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm);

    // A terminal refusal ends tail without waiting forever for Ctrl+C.
    const denied = await run(['rooms', 'tail', 'private', ...connection]);
    expect(denied.join('\n')).toContain('no read access');
    await vi.waitFor(() => expect(hub.sessionCount).toBe(0));
    expect(process.listenerCount('SIGINT')).toBe(beforeInt);
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm);
    process.exitCode = undefined;

    const brokenCursor = path.join(dir, 'broken-cursor.json');
    fs.writeFileSync(brokenCursor, '{');
    await run(['rooms', 'tail', 'general', '--cursor', brokenCursor, ...connection]);
    await vi.waitFor(() => expect(hub.sessionCount).toBe(0));
  });
});
