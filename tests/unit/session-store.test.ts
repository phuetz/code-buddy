/**
 * SessionStore tests aligned with current async API.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  SessionStore,
  getSessionStore,
  resetSessionStore,
} from '../../src/persistence/session-store';

describe('SessionStore', () => {
  let testDir: string;
  let store: SessionStore;
  let previousDir: string | undefined;

  beforeEach(async () => {
    resetSessionStore();
    previousDir = process.env.CODEBUDDY_SESSIONS_DIR;

    testDir = path.join(
      os.tmpdir(),
      `codebuddy-session-store-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    process.env.CODEBUDDY_SESSIONS_DIR = testDir;
    await fs.mkdir(testDir, { recursive: true });

    store = new SessionStore({ useSQLite: false });
  });

  afterEach(async () => {
    resetSessionStore();

    if (previousDir === undefined) {
      delete process.env.CODEBUDDY_SESSIONS_DIR;
    } else {
      process.env.CODEBUDDY_SESSIONS_DIR = previousDir;
    }

    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('creates session metadata and persists to disk', async () => {
      const session = await store.createSession('My Session', 'grok-4-latest');

      expect(session.id).toMatch(/^session_[a-z0-9]+_[a-z0-9]+$/);
      expect(session.name).toBe('My Session');
      expect(session.model).toBe('grok-4-latest');
      expect(session.workingDirectory).toBe(process.cwd());
      expect(store.getCurrentSessionId()).toBe(session.id);

      const filePath = path.join(testDir, `${session.id}.json`);
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        id: string;
        createdAt: string;
        lastAccessedAt: string;
      };

      expect(parsed.id).toBe(session.id);
      expect(typeof parsed.createdAt).toBe('string');
      expect(typeof parsed.lastAccessedAt).toBe('string');
    });
  });

  describe('load and current session', () => {
    it('returns null when there is no active session', async () => {
      const current = await store.getCurrentSession();
      expect(current).toBeNull();
    });

    it('loads the created session and restores date types', async () => {
      const created = await store.createSession('Loaded Session');
      const loaded = await store.loadSession(created.id);

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(created.id);
      expect(loaded?.name).toBe('Loaded Session');
      expect(loaded?.createdAt).toBeInstanceOf(Date);
      expect(loaded?.lastAccessedAt).toBeInstanceOf(Date);
    });
  });

  describe('singleton', () => {
    it('returns same instance via getSessionStore', () => {
      resetSessionStore();
      const store1 = getSessionStore();
      const store2 = getSessionStore();
      expect(store1).toBe(store2);
    });
  });
});
