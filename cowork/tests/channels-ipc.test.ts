import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture ipcMain.handle(channel, handler) into a map (mirrors science-ipc.test.ts).
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});
vi.mock('electron', () => ({ ipcMain: { handle: electronMock.handle } }));

// Fake core modules (encrypted secret store + dm-pairing) returned by loadCoreModule.
const fakes = vi.hoisted(() => {
  const store = new Map<string, string>();
  const credMgr = {
    setCredential: (k: string, v: string) => void store.set(k, v),
    getCredential: (k: string) => store.get(k),
    hasCredential: (k: string) => store.has(k),
    deleteCredential: (k: string) => void store.delete(k),
  };
  const allow = new Map<string, Record<string, unknown>>();
  const pairingMgr = {
    loadAllowlist: async () => {},
    persistAllowlist: async () => {},
    listApproved: () => [...allow.values()],
    listPending: () => [] as Array<Record<string, unknown>>,
    approve: () => null,
    approveDirectly: (channelType: string, senderId: string, approvedBy = 'owner', displayName?: string) => {
      const s = { channelType, senderId, approvedBy, displayName, approvedAt: new Date('2026-07-01T10:00:00.000Z') };
      allow.set(`${channelType}:${senderId}`, s);
      return s;
    },
    revoke: (channelType: string, senderId: string) => allow.delete(`${channelType}:${senderId}`),
    getStats: () => ({ enabled: false, totalApproved: allow.size, totalPending: 0, totalBlocked: 0, approvedByChannel: {} }),
  };
  return { store, credMgr, allow, pairingMgr };
});

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (rel: string) => {
    if (rel === 'security/credential-manager.js') return { getCredentialManager: () => fakes.credMgr };
    if (rel === 'channels/dm-pairing.js') return { getDMPairing: () => fakes.pairingMgr };
    // channels/core.js + commands/handlers/channel-handlers.js (readiness bridge) → unavailable → empty runtime.
    return null;
  }),
}));

// Capture logError calls so we can assert no secret is ever logged.
const loggerMock = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../src/main/utils/logger', () => ({
  logError: (...args: unknown[]) => void loggerMock.calls.push(args),
  log: () => {},
  logWarn: () => {},
}));

import { registerChannelsIpcHandlers } from '../src/main/ipc/channels-ipc';
import { registerPairingIpcHandlers } from '../src/main/ipc/pairing-ipc';

const SECRET = 'SUPER-SECRET-BOT-TOKEN-abc123XYZ';

let tmp: string;
let configPath: string;
const opts = () => ({ configPath });
const call = (channel: string, ...args: unknown[]) => electronMock.handlers.get(channel)?.(...args);

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.handle.mockClear();
  fakes.store.clear();
  fakes.allow.clear();
  loggerMock.calls.length = 0;
  tmp = mkdtempSync(path.join(tmpdir(), 'channels-ipc-'));
  configPath = path.join(tmp, 'channels.json');
  registerChannelsIpcHandlers();
  registerPairingIpcHandlers();
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe('channels config IPC', () => {
  it('registers the config + secret channels alongside the read-only status', () => {
    const channels = [...electronMock.handlers.keys()].sort();
    expect(channels).toContain('channels.status');
    expect(channels).toContain('channels.listConfig');
    expect(channels).toContain('channels.setConfig');
    expect(channels).toContain('channels.setEnabled');
    expect(channels).toContain('channels.setSecret');
    expect(channels).toContain('channels.deleteSecret');
    expect(channels).toContain('channels.removeChannel');
  });

  it('listConfig returns a catalog and an empty channel list when nothing is configured', async () => {
    const res = (await call('channels.listConfig', {}, opts())) as {
      ok: boolean;
      channels: unknown[];
      catalog: Array<{ type: string }>;
    };
    expect(res.ok).toBe(true);
    expect(res.channels).toEqual([]);
    expect(res.catalog.some((c) => c.type === 'telegram')).toBe(true);
  });

  it('adds + enables a channel, persisting only non-secret fields to channels.json', async () => {
    expect(((await call('channels.setConfig', {}, 'telegram', { enabled: false }, opts())) as { ok: boolean }).ok).toBe(true);
    expect(((await call('channels.setEnabled', {}, 'telegram', true, opts())) as { ok: boolean }).ok).toBe(true);

    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as { channels: Array<{ type: string; enabled: boolean }> };
    expect(onDisk.channels).toHaveLength(1);
    expect(onDisk.channels[0]).toMatchObject({ type: 'telegram', enabled: true });

    const res = (await call('channels.listConfig', {}, opts())) as { channels: Array<{ type: string; enabled: boolean; hasSecret: boolean }> };
    expect(res.channels[0]).toMatchObject({ type: 'telegram', enabled: true, hasSecret: false });
  });

  it('strips a token slipped into setConfig — a secret can never land in channels.json', async () => {
    await call('channels.setConfig', {}, 'telegram', { enabled: true, token: SECRET, webhookUrl: 'https://example.com/hook' }, opts());
    const raw = readFileSync(configPath, 'utf8');
    expect(raw).not.toContain(SECRET);
    const onDisk = JSON.parse(raw) as { channels: Array<Record<string, unknown>> };
    expect(onDisk.channels[0]).not.toHaveProperty('token');
    expect(onDisk.channels[0]).toMatchObject({ type: 'telegram', enabled: true, webhookUrl: 'https://example.com/hook' });
  });

  it('SECURITY: setSecret stores the token in the encrypted store and it NEVER comes back via listConfig / disk / logs', async () => {
    await call('channels.setConfig', {}, 'telegram', { enabled: true }, opts());
    const setRes = (await call('channels.setSecret', {}, 'telegram', SECRET)) as { ok: boolean; error?: string; [k: string]: unknown };
    expect(setRes.ok).toBe(true);
    // The return value carries NO secret.
    expect(JSON.stringify(setRes)).not.toContain(SECRET);
    // The secret really went into the (fake) encrypted store under the channel key.
    expect(fakes.store.get('channel:telegram:token')).toBe(SECRET);

    // listConfig reports presence only — never the value.
    const list = (await call('channels.listConfig', {}, opts())) as { channels: Array<{ type: string; hasSecret: boolean }> };
    expect(list.channels[0]).toMatchObject({ type: 'telegram', hasSecret: true });
    expect(JSON.stringify(list)).not.toContain(SECRET);

    // channels.json on disk holds no secret.
    expect(readFileSync(configPath, 'utf8')).not.toContain(SECRET);

    // Nothing was logged that contains the secret.
    expect(JSON.stringify(loggerMock.calls)).not.toContain(SECRET);
  });

  it('deleteSecret / removeChannel clear the stored secret', async () => {
    await call('channels.setConfig', {}, 'telegram', { enabled: true }, opts());
    await call('channels.setSecret', {}, 'telegram', SECRET);
    expect(fakes.store.has('channel:telegram:token')).toBe(true);

    await call('channels.deleteSecret', {}, 'telegram');
    expect(fakes.store.has('channel:telegram:token')).toBe(false);

    // removeChannel drops the entry and any lingering secret.
    await call('channels.setSecret', {}, 'telegram', SECRET);
    const rm = (await call('channels.removeChannel', {}, 'telegram', opts())) as { ok: boolean };
    expect(rm.ok).toBe(true);
    expect(fakes.store.has('channel:telegram:token')).toBe(false);
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as { channels: unknown[] };
    expect(onDisk.channels).toEqual([]);
  });

  it('never-throws on invalid input (bad type / empty secret / bad patch)', async () => {
    expect(((await call('channels.setConfig', {}, 'Bad Type!', { enabled: true }, opts())) as { ok: boolean }).ok).toBe(false);
    expect(((await call('channels.setSecret', {}, 'telegram', '   ')) as { ok: boolean }).ok).toBe(false);
    expect(((await call('channels.setSecret', {}, 'telegram', 42)) as { ok: boolean }).ok).toBe(false);
    expect(((await call('channels.setConfig', {}, 'telegram', 'not-an-object', opts())) as { ok: boolean }).ok).toBe(false);
    expect(((await call('channels.setEnabled', {}, 'telegram', 'yes', opts())) as { ok: boolean }).ok).toBe(false);
    // No config file was created by the rejected calls.
    expect(existsSync(configPath)).toBe(false);
  });
});

describe('pairing IPC', () => {
  it('registers the pairing channels', () => {
    const channels = [...electronMock.handlers.keys()];
    for (const c of ['pairing.status', 'pairing.list', 'pairing.pending', 'pairing.approve', 'pairing.approveDirect', 'pairing.revoke']) {
      expect(channels).toContain(c);
    }
  });

  it('lists / approves-directly / revokes an allowlist entry', async () => {
    expect(((await call('pairing.list')) as { ok: boolean; approved: unknown[] }).approved).toEqual([]);

    const add = (await call('pairing.approveDirect', {}, 'telegram', '12345', 'owner', 'Alice')) as {
      ok: boolean;
      approved: { channelType: string; senderId: string; approvedAt: string } | null;
    };
    expect(add.ok).toBe(true);
    expect(add.approved).toMatchObject({ channelType: 'telegram', senderId: '12345' });
    // Date normalised to an ISO string across IPC.
    expect(typeof add.approved?.approvedAt).toBe('string');

    const list = (await call('pairing.list')) as { approved: Array<{ senderId: string; displayName?: string }> };
    expect(list.approved).toHaveLength(1);
    expect(list.approved[0]).toMatchObject({ senderId: '12345', displayName: 'Alice' });

    const revoke = (await call('pairing.revoke', {}, 'telegram', '12345')) as { ok: boolean; revoked: boolean };
    expect(revoke.ok).toBe(true);
    expect(revoke.revoked).toBe(true);
    expect(((await call('pairing.list')) as { approved: unknown[] }).approved).toEqual([]);
  });

  it('pairing.status returns the stats roll-up', async () => {
    await call('pairing.approveDirect', {}, 'discord', 'u-1');
    const status = (await call('pairing.status')) as { ok: boolean; totalApproved: number; enabled: boolean };
    expect(status.ok).toBe(true);
    expect(status.totalApproved).toBe(1);
    expect(status.enabled).toBe(false);
  });

  it('never-throws on invalid pairing input', async () => {
    expect(((await call('pairing.approveDirect', {}, 'Bad!', 'x')) as { ok: boolean }).ok).toBe(false);
    expect(((await call('pairing.approve', {}, 'telegram', '')) as { ok: boolean }).ok).toBe(false);
    expect(((await call('pairing.revoke', {}, 'telegram', '  ')) as { ok: boolean }).ok).toBe(false);
  });
});
