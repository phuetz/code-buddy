import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevicePairingStore } from '../../src/gateway/device-pairing';

describe('DevicePairingStore', () => {
  let dir: string;
  let tokenSeq: number;
  let store: DevicePairingStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'device-pairing-'));
    tokenSeq = 0;
    store = new DevicePairingStore({
      dir,
      now: () => 1_000,
      generateToken: () => `token-${++tokenSeq}`,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('requestPairing', () => {
    it('queues an unknown device as pending', () => {
      const result = store.requestPairing({ deviceId: 'dev-1', clientId: 'cli', role: 'operator', requestedScopes: ['chat'] });
      expect(result.status).toBe('pending');
      expect(store.listPending()).toHaveLength(1);
      expect(store.listPending()[0]).toMatchObject({ deviceId: 'dev-1', clientId: 'cli', role: 'operator', requestedScopes: ['chat'] });
      expect(store.isPaired('dev-1')).toBe(false);
    });

    it('is idempotent on the requested timestamp for repeat requests', () => {
      store.requestPairing({ deviceId: 'dev-1' });
      const reqAt = store.listPending()[0]?.requestedAtMs;
      store.requestPairing({ deviceId: 'dev-1', displayName: 'Renamed' });
      expect(store.listPending()).toHaveLength(1);
      expect(store.listPending()[0]?.requestedAtMs).toBe(reqAt);
      expect(store.listPending()[0]?.displayName).toBe('Renamed');
    });

    it('short-circuits to paired for an already-paired device', () => {
      store.requestPairing({ deviceId: 'dev-1' });
      store.approve('dev-1');
      const result = store.requestPairing({ deviceId: 'dev-1' });
      expect(result.status).toBe('paired');
    });
  });

  describe('approve', () => {
    it('mints a token once, persists only its hash, and moves pending -> paired', () => {
      store.requestPairing({ deviceId: 'dev-1', clientId: 'cli', requestedScopes: ['chat', 'tools'] });
      const { device, token } = store.approve('dev-1', { approvedBy: 'patrice' });

      expect(token).toBe('token-1');
      expect(device.scopes).toEqual(['chat', 'tools']);
      expect(device.approvedBy).toBe('patrice');
      expect(device.clientId).toBe('cli');
      // moved out of pending, now paired
      expect(store.listPending()).toHaveLength(0);
      expect(store.isPaired('dev-1')).toBe(true);

      // disk holds the hash, never the plaintext token; view has no tokenHash
      const onDisk = readFileSync(join(dir, 'paired.json'), 'utf-8');
      expect(onDisk).not.toContain('token-1');
      expect(JSON.stringify(device)).not.toContain('tokenHash');
    });

    it('can approve scopes that override the requested set', () => {
      store.requestPairing({ deviceId: 'dev-1', requestedScopes: ['chat'] });
      const { device } = store.approve('dev-1', { scopes: ['chat', 'tools', 'admin'] });
      expect(device.scopes).toEqual(['admin', 'chat', 'tools']);
    });

    it('throws for an unknown device with no pending request', () => {
      expect(() => store.approve('ghost')).toThrow(/unknown device/);
    });
  });

  describe('verifyToken', () => {
    it('accepts the issued token and rejects others', () => {
      store.requestPairing({ deviceId: 'dev-1' });
      const { token } = store.approve('dev-1');
      expect(store.verifyToken('dev-1', token)).toBe(true);
      expect(store.verifyToken('dev-1', 'wrong')).toBe(false);
      expect(store.verifyToken('dev-1', '')).toBe(false);
      expect(store.verifyToken('unknown', token)).toBe(false);
    });

    it('rejects a token after the device is revoked', () => {
      store.requestPairing({ deviceId: 'dev-1' });
      const { token } = store.approve('dev-1');
      expect(store.revoke('dev-1')).toBe(true);
      expect(store.verifyToken('dev-1', token)).toBe(false);
      expect(store.isPaired('dev-1')).toBe(false);
    });
  });

  describe('reject / revoke', () => {
    it('reject removes a pending request', () => {
      store.requestPairing({ deviceId: 'dev-1' });
      expect(store.reject('dev-1')).toBe(true);
      expect(store.reject('dev-1')).toBe(false);
      expect(store.listPending()).toHaveLength(0);
    });

    it('revoke returns false for a non-paired device', () => {
      expect(store.revoke('nope')).toBe(false);
    });
  });

  describe('persistence + views', () => {
    it('persists across store instances and never leaks tokens in list views', () => {
      store.requestPairing({ deviceId: 'dev-1', clientId: 'cli', requestedScopes: ['chat'] });
      store.approve('dev-1', { approvedBy: 'patrice' });

      const reopened = new DevicePairingStore({ dir, now: () => 2_000, generateToken: () => 'x' });
      const paired = reopened.listPaired();
      expect(paired).toHaveLength(1);
      expect(paired[0]?.deviceId).toBe('dev-1');
      expect(JSON.stringify(paired)).not.toContain('tokenHash');
    });

    it('touch records last-seen metadata', () => {
      store.requestPairing({ deviceId: 'dev-1' });
      store.approve('dev-1');
      const seenStore = new DevicePairingStore({ dir, now: () => 5_000, generateToken: () => 'x' });
      seenStore.touch('dev-1', 'connect');
      const device = seenStore.getPaired('dev-1');
      expect(device?.lastSeenAtMs).toBe(5_000);
      expect(device?.lastSeenReason).toBe('connect');
    });

    it('writes the device files with 0600 permissions', () => {
      store.requestPairing({ deviceId: 'dev-1' });
      store.approve('dev-1');
      const mode = require('fs').statSync(join(dir, 'paired.json')).mode & 0o777;
      expect(mode).toBe(0o600);
      expect(existsSync(join(dir, 'pending.json'))).toBe(true);
    });
  });
});
