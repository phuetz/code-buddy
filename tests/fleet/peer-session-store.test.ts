/**
 * peer-session-store tests — Phase d.22 / V1.2-saga.
 *
 * Validates the disk-backed registry that backs peer.chat-session.*
 * across restarts: round-trip save/load, atomic write semantics,
 * resilient loadAll over corrupt files, idempotent delete, and TTL
 * purge.
 *
 * Tests use a per-test tmpdir so the real ~/.codebuddy/ is never
 * touched.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PeerSessionStore,
  type PersistedChatSession,
  getPeerSessionStore,
  resetPeerSessionStore,
} from '../../src/fleet/peer-session-store.js';

let tmpDir: string;
let store: PeerSessionStore;

function makeSession(
  sessionId: string,
  overrides: Partial<PersistedChatSession> = {},
): PersistedChatSession {
  const now = Date.now();
  return {
    sessionId,
    systemPrompt: 'You are a peer LLM.',
    model: 'qwen2.5-coder:7b',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ],
    createdAt: now,
    lastUsedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-session-store-'));
  store = new PeerSessionStore({ storeDir: tmpDir });
  resetPeerSessionStore();
});

afterEach(() => {
  resetPeerSessionStore();
  // Cleanup tmpdir best-effort.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* ignore */
  }
});

describe('PeerSessionStore — round-trip', () => {
  it('save then load returns the exact record', async () => {
    const session = makeSession('sess_alpha');
    await store.save(session);
    const loaded = await store.load('sess_alpha');
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(session);
  });

  it('load on unknown sessionId returns null', async () => {
    const loaded = await store.load('sess_does_not_exist');
    expect(loaded).toBeNull();
  });

  it('save overwrites an existing record', async () => {
    await store.save(makeSession('sess_x', { messages: [] }));
    const updated = makeSession('sess_x', {
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
      ],
    });
    await store.save(updated);
    const loaded = await store.load('sess_x');
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.messages[0].content).toBe('q1');
  });
});

describe('PeerSessionStore — loadAll', () => {
  it('returns every saved session', async () => {
    await store.save(makeSession('sess_a'));
    await store.save(makeSession('sess_b'));
    await store.save(makeSession('sess_c'));
    const all = await store.loadAll();
    const ids = all.map((s) => s.sessionId).sort();
    expect(ids).toEqual(['sess_a', 'sess_b', 'sess_c']);
  });

  it('skips a corrupt JSON file without aborting the rest', async () => {
    await store.save(makeSession('sess_good'));
    // Plant a corrupt file directly so it lands in the directory.
    fs.writeFileSync(path.join(tmpDir, 'sess_corrupt.json'), '{"sessionId": "sess_corrupt", BAD_JSON');
    const all = await store.loadAll();
    const ids = all.map((s) => s.sessionId);
    expect(ids).toContain('sess_good');
    expect(ids).not.toContain('sess_corrupt');
  });

  it('ignores non-.json entries in the directory', async () => {
    await store.save(makeSession('sess_a'));
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'a marker');
    fs.writeFileSync(path.join(tmpDir, 'sess_a.json.lock'), '');
    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].sessionId).toBe('sess_a');
  });

  it('handles a non-existent store directory gracefully', async () => {
    const ghost = new PeerSessionStore({
      storeDir: path.join(tmpDir, 'subdir-that-existed-but-then-vanished'),
    });
    // Force the dir to be removed AFTER ensureDir created it.
    fs.rmSync(path.join(tmpDir, 'subdir-that-existed-but-then-vanished'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    const all = await ghost.loadAll();
    expect(all).toEqual([]);
  });
});

describe('PeerSessionStore — delete', () => {
  it('returns true on first delete, false on second (idempotent)', async () => {
    await store.save(makeSession('sess_a'));
    expect(await store.delete('sess_a')).toBe(true);
    expect(await store.delete('sess_a')).toBe(false);
  });

  it('also removes the lockfile if present', async () => {
    await store.save(makeSession('sess_a'));
    // Plant a lockfile to mimic an in-flight save that crashed.
    const lock = path.join(tmpDir, 'sess_a.json.lock');
    fs.writeFileSync(lock, String(process.pid));
    expect(fs.existsSync(lock)).toBe(true);
    await store.delete('sess_a');
    expect(fs.existsSync(lock)).toBe(false);
  });
});

describe('PeerSessionStore — purgeExpired', () => {
  it('drops sessions older than the idle window, keeps fresh ones', async () => {
    const now = 1_700_000_000_000;
    const idleMs = 30 * 60 * 1000;

    await store.save(makeSession('sess_fresh', { lastUsedAt: now - 60_000 }));
    await store.save(makeSession('sess_stale', { lastUsedAt: now - idleMs - 1 }));
    await store.save(makeSession('sess_borderline', { lastUsedAt: now - idleMs })); // exactly at the edge — kept

    const dropped = await store.purgeExpired(now, idleMs);
    expect(dropped).toEqual(['sess_stale']);

    const remaining = (await store.loadAll()).map((s) => s.sessionId).sort();
    expect(remaining).toEqual(['sess_borderline', 'sess_fresh']);
  });

  it('returns an empty array when no sessions exist', async () => {
    const dropped = await store.purgeExpired(Date.now(), 60_000);
    expect(dropped).toEqual([]);
  });
});

describe('PeerSessionStore — atomic write', () => {
  it('an interrupted write does not leave a half-file at the canonical path', async () => {
    // The implementation writes to <file>.tmp.<pid> then renames. So if
    // a crash happens before the rename, the canonical file still
    // contains whatever was there before.
    await store.save(makeSession('sess_a', { messages: [{ role: 'user', content: 'first' }] }));

    // Simulate a half-written tmp file landing next to the canonical
    // record. The store should ignore .tmp.<pid> files when listing.
    const tmpFile = path.join(tmpDir, `sess_a.json.tmp.${process.pid}`);
    fs.writeFileSync(tmpFile, '{"sessionId":"sess_a","BAD');

    // loadAll should skip the .tmp.<pid> file (it's not .json) and
    // load returns the canonical content.
    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].messages[0].content).toBe('first');

    const loaded = await store.load('sess_a');
    expect(loaded?.messages[0].content).toBe('first');
  });
});

describe('getPeerSessionStore singleton', () => {
  it('returns the same instance across calls', () => {
    const a = getPeerSessionStore();
    const b = getPeerSessionStore();
    expect(a).toBe(b);
  });

  it('resetPeerSessionStore forces a fresh instance', () => {
    const a = getPeerSessionStore();
    resetPeerSessionStore();
    const b = getPeerSessionStore();
    expect(a).not.toBe(b);
  });
});
