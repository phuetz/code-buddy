import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../src/events/event-bus.js';
import { RoomAccessPolicy } from '../../../src/fleet/rooms/room-access.js';
import { buildRoomAuth, signRoomEvent, verifyRoomEvent } from '../../../src/fleet/rooms/room-event.js';
import { RoomHub, type RoomStreamFrame } from '../../../src/fleet/rooms/room-hub.js';
import { createRoomIdentity } from '../../../src/fleet/rooms/room-identity.js';
import { ROOM_OBSERVATION_PRINCIPAL, startRoomObservations } from '../../../src/fleet/rooms/room-observations.js';
import { RoomStore } from '../../../src/fleet/rooms/room-store.js';

describe('local observations through authenticated Fleet rooms', () => {
  let directory: string;
  let bus: EventBus;
  let store: RoomStore;
  let hub: RoomHub;
  let env: NodeJS.ProcessEnv;
  let stop: () => void;
  let configPath: string;
  let publicKey: string;
  const audience = 'ws://127.0.0.1:3000/ws';

  beforeEach(() => {
    vi.useFakeTimers();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-room-observations-'));
    const identityPath = path.join(directory, 'identity.json');
    const identity = createRoomIdentity(identityPath);
    publicKey = identity.publicKey;
    configPath = path.join(directory, 'rooms.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      members: { [publicKey]: { name: 'system', principals: [ROOM_OBSERVATION_PRINCIPAL, 'test-reader'] } },
      rooms: { mission: { members: [publicKey] } },
    }));
    store = new RoomStore({ directory: path.join(directory, 'ledger') });
    hub = new RoomHub({ store, access: new RoomAccessPolicy({ path: configPath, reloadIntervalMs: 0 }), audiences: [audience] });
    bus = new EventBus();
    env = {
      CODEBUDDY_FLEET_ROOMS_OBSERVATIONS: 'true',
      CODEBUDDY_FLEET_ROOMS_IDENTITY: identityPath,
      CODEBUDDY_FLEET_ROOMS_ROOM: 'mission',
      CODEBUDDY_FLEET_ROOMS_MISSION: 'robot:inspection-1',
      CODEBUDDY_FLEET_ROOMS_OBSERVATION_INTERVAL_MS: '1000',
    };
    stop = () => {};
  });
  afterEach(() => {
    stop();
    hub.close();
    store.close();
    bus.dispose();
    vi.useRealTimers();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('does not read an identity or subscribe when disabled', () => {
    const on = vi.spyOn(bus, 'on');
    stop = startRoomObservations(hub, { env: { CODEBUDDY_FLEET_ROOMS_IDENTITY: '/missing' }, bus });
    expect(on).not.toHaveBeenCalled();
    expect(hub.sessionCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['CODEBUDDY_FLEET_ROOMS_ROOM', 'CODEBUDDY_FLEET_ROOMS_MISSION'])('rejects missing %s without opening a session', (key) => {
    delete env[key];
    expect(() => startRoomObservations(hub, { env, bus })).toThrow('require a valid');
    expect(hub.sessionCount).toBe(0);
  });

  it('delivers a signed observation to a member and replays it after journal restart', async () => {
    const frames: RoomStreamFrame[] = [];
    const reader = hub.open({ connectionId: 'reader', principalId: 'test-reader', send: frame => { frames.push(frame); return true; }, isBackpressured: () => false });
    const { loadRoomIdentity } = await import('../../../src/fleet/rooms/room-identity.js');
    const identity = loadRoomIdentity(env.CODEBUDDY_FLEET_ROOMS_IDENTITY);
    expect(reader.authenticate(signRoomEvent(buildRoomAuth(reader.hello().challenge, audience), identity.secretKey)).ok).toBe(true);
    reader.subscribe({ subId: 'status', filters: [{ '#h': ['mission'] }] });
    stop = startRoomObservations(hub, { env, bus });
    const perceptions = vi.fn();
    bus.on('sensory:perception', perceptions);
    bus.emit('sensory:perception', { source: 'system-vitals', metadata: { modality: 'system', kind: 'disk_low', payload: { diskPct: 95, diskFreeBytes: 1024, command: 'move', transcript: 'private' } } });
    await vi.advanceTimersByTimeAsync(1000);
    const delivered = frames.filter(frame => frame.type === 'fleet.rooms.event');
    expect(delivered).toHaveLength(1);
    const first = delivered[0];
    if (!first) throw new Error('Expected a delivered observation');
    const event = first.payload.event;
    expect(verifyRoomEvent(event).ok).toBe(true);
    expect(JSON.parse(event.content)).toMatchObject({ missionId: 'robot:inspection-1', type: 'observation', source: 'system-vitals', values: { diskPct: 95, diskFreeBytes: 1024 } });
    expect(event.content).not.toMatch(/private|command|transcript/);
    expect(perceptions).toHaveBeenCalledTimes(1);
    stop(); hub.close(); store.close();
    store = new RoomStore({ directory: path.join(directory, 'ledger') });
    expect(store.query([{ '#h': ['mission'] }], { afterSeq: 0 }).records.map(record => record.event.id)).toEqual([event.id]);
  });

  it('rejects an identity with read permission only and cleans its session', () => {
    fs.writeFileSync(configPath, JSON.stringify({ version: 1, members: { [publicKey]: { name: 'reader' } }, rooms: { mission: { readers: [publicKey] } } }));
    expect(() => startRoomObservations(hub, { env, bus })).toThrow('not allowed');
    expect(hub.sessionCount).toBe(0);
  });

  it('checks membership again before publishing queued observations', async () => {
    stop = startRoomObservations(hub, { env, bus });
    bus.emit('sensory:perception', { source: 'buddy-sense', metadata: { modality: 'vital', kind: 'heartbeat', payload: { load1: 2 } } });
    fs.writeFileSync(configPath, JSON.stringify({ version: 1, members: {}, rooms: {} }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.latestSeq).toBe(0);
    stop(); stop();
    expect(hub.sessionCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans its authenticated session when bridge configuration is invalid', () => {
    env.CODEBUDDY_FLEET_ROOMS_OBSERVATION_INTERVAL_MS = 'NaN';
    expect(() => startRoomObservations(hub, { env, bus })).toThrow('interval');
    expect(hub.sessionCount).toBe(0);
  });
});
