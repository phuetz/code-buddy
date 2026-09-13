import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { RoomAccessPolicy, type RoomAccessConfigInput } from '../../../src/fleet/rooms/room-access.js';
import {
  buildRoomAuth,
  buildRoomMessage,
  deriveRoomPublicKey,
  signRoomEvent,
} from '../../../src/fleet/rooms/room-event.js';
import { RoomHub, type RoomSession, type RoomStreamFrame } from '../../../src/fleet/rooms/room-hub.js';
import { RoomStore } from '../../../src/fleet/rooms/room-store.js';

const ALICE = '0000000000000000000000000000000000000000000000000000000000000001';
const BOB = '0000000000000000000000000000000000000000000000000000000000000002';
const CAROL = '0000000000000000000000000000000000000000000000000000000000000003';
const MALLORY = '0000000000000000000000000000000000000000000000000000000000000004';
const AUDIENCE = 'ws://127.0.0.1:3000/ws';
const NOW_MS = 1_800_000_000_000;
const NOW_SEC = NOW_MS / 1000;

const pub = (sk: string) => deriveRoomPublicKey(sk);

function accessConfig(): RoomAccessConfigInput {
  return {
    version: 1,
    members: {
      [pub(ALICE)]: { name: 'alice' },
      [pub(BOB)]: { name: 'bob', principals: ['key:bob'] },
      [pub(CAROL)]: { name: 'carol' },
    },
    rooms: {
      general: { members: [pub(ALICE), pub(BOB)], readers: [pub(CAROL)] },
      ops: { members: [pub(ALICE)] },
    },
  };
}

interface FakeTransport {
  frames: RoomStreamFrame[];
  backpressured: boolean;
}

describe('RoomHub', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  function setup(options: { access?: RoomAccessPolicy; publishPerMinute?: number; audiences?: string[] } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-hub-'));
    const store = new RoomStore({ directory: dir });
    const hub = new RoomHub({
      store,
      access: options.access ?? new RoomAccessPolicy({ config: accessConfig() }),
      audiences: options.audiences ?? [AUDIENCE],
      now: () => NOW_MS,
      ...(options.publishPerMinute ? { publishPerMinute: options.publishPerMinute } : {}),
    });
    cleanups.push(() => {
      hub.close();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const connect = (principalId = 'key:any') => {
      const transport: FakeTransport = { frames: [], backpressured: false };
      const session = hub.open({
        connectionId: `c${Math.random()}`,
        principalId,
        send: (frame) => { transport.frames.push(frame); return true; },
        isBackpressured: () => transport.backpressured,
      });
      return { session, transport };
    };
    return { hub, store, dir, connect };
  }

  function authenticate(session: RoomSession, sk: string, audience = AUDIENCE, createdAt = NOW_SEC) {
    const { challenge } = session.hello();
    return session.authenticate(signRoomEvent(buildRoomAuth(challenge, audience, createdAt), sk));
  }

  const post = (sk: string, content: string, room = 'general', createdAt = NOW_SEC) =>
    signRoomEvent(buildRoomMessage({ room, content, createdAt }), sk);

  describe('authentication', () => {
    it('admits a declared member proving its key for this hub', () => {
      const { connect } = setup();
      const { session } = connect();
      expect(authenticate(session, ALICE)).toMatchObject({ ok: true, pubkey: pub(ALICE), name: 'alice' });
    });

    it('rejects a proof addressed to another hub (cross-hub relay)', () => {
      const { connect } = setup();
      const { session } = connect();
      const result = authenticate(session, ALICE, 'ws://evil-hub:3000/ws');
      expect(result).toEqual({ ok: false, message: 'restricted: auth proof is addressed to another hub' });
    });

    it('makes challenges single-use and time-bound', () => {
      const { connect } = setup();
      const { session } = connect();
      const { challenge } = session.hello();
      const proof = signRoomEvent(buildRoomAuth(challenge, AUDIENCE, NOW_SEC), ALICE);
      expect(session.authenticate(proof).ok).toBe(true);
      expect(session.authenticate(proof)).toMatchObject({ ok: false, message: expect.stringMatching(/^auth-required:/) });
      const stale = authenticate(connect().session, ALICE, AUDIENCE, NOW_SEC - 3_600);
      expect(stale).toMatchObject({ ok: false, message: expect.stringMatching(/timestamp/) });
    });

    it('enforces principal binding, membership and attempt limits', () => {
      const { connect } = setup();
      expect(authenticate(connect('key:mallory').session, BOB)).toMatchObject({ ok: false, message: expect.stringMatching(/not bound/) });
      expect(authenticate(connect('key:bob').session, BOB).ok).toBe(true);
      expect(authenticate(connect().session, MALLORY)).toMatchObject({ ok: false, message: expect.stringMatching(/not a declared/) });
      const { session } = connect();
      for (let i = 0; i < 5; i++) authenticate(session, MALLORY);
      expect(authenticate(session, ALICE)).toMatchObject({ ok: false, message: expect.stringMatching(/too many/) });
    });
  });

  describe('publish', () => {
    it('follows the relay pipeline with machine-readable prefixes', () => {
      const { connect } = setup({ publishPerMinute: 3 });
      const anonymous = connect().session;
      expect(anonymous.publish(post(ALICE, 'x')).message).toMatch(/^auth-required:/);

      const alice = connect().session;
      authenticate(alice, ALICE);
      expect(alice.publish(post(BOB, 'impersonation')).message).toBe('invalid: event pubkey does not match authenticated identity');
      const tampered = { ...post(ALICE, 'x'), content: 'y' };
      expect(alice.publish(tampered).message).toMatch(/^invalid: event id/);
      const twoRooms = signRoomEvent({ created_at: NOW_SEC, kind: 9, tags: [['h', 'general'], ['h', 'ops']], content: 'x' }, ALICE);
      expect(alice.publish(twoRooms).message).toBe('invalid: message must carry exactly one valid h tag');
      expect(alice.publish(post(ALICE, 'future', 'general', NOW_SEC + 3_600)).message).toMatch(/future/);

      const first = post(ALICE, 'first');
      const stored = alice.publish(first);
      expect(stored).toMatchObject({ accepted: true, seq: 1, message: '' });
      expect(alice.publish(first)).toMatchObject({ accepted: true, seq: 1, message: 'duplicate: already stored' });
      alice.publish(post(ALICE, 'second'));
      alice.publish(post(ALICE, 'third'));
      expect(alice.publish(post(ALICE, 'fourth')).message).toMatch(/^rate-limited:/);

      const carol = connect().session;
      authenticate(carol, CAROL);
      expect(carol.publish(post(CAROL, 'reader')).message).toBe('restricted: no write access to room general');
    });
  });

  describe('subscribe', () => {
    it('checks access before reading, then sends history, EOSE and live events', () => {
      const { connect } = setup();
      const alice = connect().session;
      authenticate(alice, ALICE);
      alice.publish(post(ALICE, 'before'));

      const carol = connect();
      authenticate(carol.session, CAROL);
      carol.session.subscribe({ subId: 'ops', filters: [{ '#h': ['ops'] }] });
      expect(carol.transport.frames).toEqual([
        { type: 'fleet.rooms.closed', payload: expect.objectContaining({ subId: 'ops', message: 'restricted: no read access to room ops' }) },
      ]);
      carol.transport.frames.length = 0;

      carol.session.subscribe({ subId: 'g', filters: [{ '#h': ['general'] }] });
      alice.publish(post(ALICE, 'after'));
      alice.publish(post(ALICE, 'hidden', 'ops'));
      expect(carol.transport.frames.map((frame) => frame.type)).toEqual([
        'fleet.rooms.event', 'fleet.rooms.eose', 'fleet.rooms.event',
      ]);
      const eose = carol.transport.frames[1];
      expect(eose?.type === 'fleet.rooms.eose' && eose.payload).toMatchObject({ throughSeq: 1, live: true, gap: false });
    });

    it('resumes after a cursor, flags an epoch change and pages truncated replays', () => {
      const { connect, store } = setup();
      for (let i = 0; i < 502; i++) store.append(post(ALICE, `bulk-${i}`, 'general', NOW_SEC - 10));
      const carol = connect();
      authenticate(carol.session, CAROL);

      carol.session.subscribe({ subId: 'r', filters: [{ '#h': ['general'] }], afterSeq: 1, storeId: store.storeId });
      let eose = carol.transport.frames.at(-1);
      expect(eose?.type).toBe('fleet.rooms.eose');
      expect(eose?.type === 'fleet.rooms.eose' && eose.payload).toMatchObject({ live: false, truncated: true, throughSeq: 501 });
      expect(carol.session.subscriptionCount).toBe(0);

      carol.transport.frames.length = 0;
      carol.session.subscribe({ subId: 'r', filters: [{ '#h': ['general'] }], afterSeq: 501, storeId: store.storeId });
      expect(carol.transport.frames.filter((f) => f.type === 'fleet.rooms.event')).toHaveLength(1);
      eose = carol.transport.frames.at(-1);
      expect(eose?.type === 'fleet.rooms.eose' && eose.payload).toMatchObject({ live: true, throughSeq: 502 });

      carol.transport.frames.length = 0;
      carol.session.subscribe({ subId: 'e', filters: [{ '#h': ['general'], limit: 1 }], afterSeq: 400, storeId: 'another-generation' });
      eose = carol.transport.frames.at(-1);
      expect(eose?.type === 'fleet.rooms.eose' && eose.payload).toMatchObject({ epochChanged: true, throughSeq: 502 });
    });

    it('closes a lagging subscription with a resumable cursor instead of queueing', () => {
      const { connect, store } = setup();
      const alice = connect().session;
      authenticate(alice, ALICE);
      const bob = connect('key:bob');
      authenticate(bob.session, BOB);
      bob.session.subscribe({ subId: 'live', filters: [{ '#h': ['general'] }] });
      alice.publish(post(ALICE, 'one'));
      bob.transport.backpressured = true;
      alice.publish(post(ALICE, 'two'));
      const closed = bob.transport.frames.at(-1);
      expect(closed).toEqual({
        type: 'fleet.rooms.closed',
        payload: { subId: 'live', message: 'error: backpressure, resubscribe after throughSeq', storeId: store.storeId, throughSeq: 1 },
      });
      bob.transport.backpressured = false;
      bob.transport.frames.length = 0;
      bob.session.subscribe({ subId: 'live', filters: [{ '#h': ['general'] }], afterSeq: 1, storeId: store.storeId });
      const replayed = bob.transport.frames.filter((f) => f.type === 'fleet.rooms.event');
      expect(replayed.map((f) => f.type === 'fleet.rooms.event' && f.payload.event.content)).toEqual(['two']);
    });

    it('closes live subscriptions when membership is revoked in the policy file', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-revoke-'));
      cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
      const file = path.join(dir, 'rooms.json');
      fs.writeFileSync(file, JSON.stringify(accessConfig()));
      const { connect } = setup({ access: new RoomAccessPolicy({ path: file, reloadIntervalMs: 0 }) });
      const alice = connect().session;
      authenticate(alice, ALICE);
      const carol = connect();
      authenticate(carol.session, CAROL);
      carol.session.subscribe({ subId: 'g', filters: [{ '#h': ['general'] }] });

      const revoked = accessConfig();
      revoked.rooms.general = { members: [pub(ALICE), pub(BOB)], readers: [] };
      fs.writeFileSync(file, `${JSON.stringify(revoked)} `);
      alice.publish(post(ALICE, 'secret'));
      expect(carol.transport.frames.at(-1)).toMatchObject({
        type: 'fleet.rooms.closed',
        payload: { subId: 'g', message: 'restricted: membership revoked' },
      });
      expect(carol.transport.frames.some((f) => f.type === 'fleet.rooms.event')).toBe(false);
    });

    it('bounds subscriptions per session and validates subId and cursor', () => {
      const { connect } = setup();
      const alice = connect();
      authenticate(alice.session, ALICE);
      expect(alice.session.subscribe({ subId: 'bad id!', filters: [{ '#h': ['general'] }] }).ok).toBe(false);
      alice.session.subscribe({ subId: 'c', filters: [{ '#h': ['general'] }], afterSeq: 3 });
      expect(alice.transport.frames.at(-1)).toMatchObject({ payload: { message: expect.stringMatching(/storeId/) } });
      for (let i = 0; i < 16; i++) alice.session.subscribe({ subId: `s${i}`, filters: [{ '#h': ['general'] }] });
      alice.session.subscribe({ subId: 'one-too-many', filters: [{ '#h': ['general'] }] });
      expect(alice.transport.frames.at(-1)).toMatchObject({ payload: { message: 'error: too many subscriptions' } });
    });
  });
});
