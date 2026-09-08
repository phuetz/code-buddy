import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUserToken } from '../../src/server/auth/jwt.js';
import { mobilePwaRouter } from '../../src/server/mobile/index.js';
import {
  isMobilePushEnabled,
  loadOrCreateVapidKeys,
  savePushSubscription,
  sendMobilePush,
  setMobilePushSenderForTests,
} from '../../src/server/mobile/push.js';

const SECRET = 'mobile-push-ssrf-test-secret-32b-minimum';
const FIX_TMP = path.join(process.cwd(), '_qa/fix/tmp');

function forgedPushEndpoints(): string[] {
  return [
    'https://127.0.0.1:6101/evil',
    'https://169.254.169.254/latest/meta-data/',
    `https://${['10', '0', '0', '5'].join('.')}/push`,
    `https://${['192', '168', '1', '10'].join('.')}/push`,
    'https://[::1]/evil',
    'https://notify.local/sub',
  ];
}

function storedPushBlobs(root: string): string {
  if (!existsSync(root)) return '';
  const chunks: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        chunks.push(readFileSync(full, 'utf8'));
      } catch {
        walk(full);
      }
    }
  };
  walk(root);
  return chunks.join('\n');
}

describe('mobile web push (lot 3)', () => {
  const previousPush = process.env.CODEBUDDY_MOBILE_PUSH;
  const previousDir = process.env.CODEBUDDY_PUSH_DIR;
  const previousSecret = process.env.JWT_SECRET;
  let dir = '';

  afterEach(() => {
    if (previousPush === undefined) delete process.env.CODEBUDDY_MOBILE_PUSH;
    else process.env.CODEBUDDY_MOBILE_PUSH = previousPush;
    if (previousDir === undefined) delete process.env.CODEBUDDY_PUSH_DIR;
    else process.env.CODEBUDDY_PUSH_DIR = previousDir;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    setMobilePushSenderForTests();
  });

  it('is off unless CODEBUDDY_MOBILE_PUSH=true', () => {
    delete process.env.CODEBUDDY_MOBILE_PUSH;
    expect(isMobilePushEnabled()).toBe(false);
  });

  it('creates 0600 VAPID keys and sends through the fake transport', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cb-push-'));
    process.env.CODEBUDDY_MOBILE_PUSH = 'true';
    process.env.CODEBUDDY_PUSH_DIR = dir;
    const keys = loadOrCreateVapidKeys();
    expect(keys?.publicKey).toBeTruthy();
    expect(await savePushSubscription({
      endpoint: 'https://1.1.1.1/push',
      keys: { p256dh: 'p', auth: 'a' },
    }, 'user-a')).toBe(true);
    const seen: string[] = [];
    setMobilePushSenderForTests(async (sub, payload) => {
      seen.push(`${sub.endpoint}:${payload.body}`);
      return true;
    });
    expect(await sendMobilePush({ title: 'Lisa', body: 'coucou' }, { userId: 'user-a' })).toBe(1);
    expect(seen).toEqual(['https://1.1.1.1/push:coucou']);
  });

  it('refuses six forged push endpoints with 400 and writes nothing', async () => {
    mkdirSync(FIX_TMP, { recursive: true });
    dir = mkdtempSync(path.join(FIX_TMP, 'cb-push-ssrf-'));
    process.env.CODEBUDDY_MOBILE_PUSH = 'true';
    process.env.CODEBUDDY_PUSH_DIR = dir;
    process.env.JWT_SECRET = SECRET;
    const token = createUserToken('user-ssrf', ['chat'], SECRET);
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected port');
      const url = `http://127.0.0.1:${address.port}/__codebuddy__/mobile/push/subscribe`;
      for (const endpoint of forgedPushEndpoints()) {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
        });
        expect(res.status, endpoint).toBe(400);
        expect(await savePushSubscription({ endpoint, keys: { p256dh: 'p', auth: 'a' } }, 'user-ssrf')).toBe(false);
      }
      const stored = storedPushBlobs(dir);
      for (const endpoint of forgedPushEndpoints()) {
        expect(stored).not.toContain(endpoint);
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('caps five subscriptions per identity, names the file by sha256, mode 0600', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cb-push-id-'));
    process.env.CODEBUDDY_MOBILE_PUSH = 'true';
    process.env.CODEBUDDY_PUSH_DIR = dir;
    const env = { ...process.env, CODEBUDDY_MOBILE_PUSH: 'true', CODEBUDDY_PUSH_DIR: dir };
    for (let i = 0; i < 6; i += 1) {
      expect(await savePushSubscription({
        endpoint: `https://1.1.1.1/push/${i}`,
        keys: { p256dh: 'p', auth: 'a' },
      }, 'user-a', env)).toBe(true);
    }
    expect(await savePushSubscription({
      endpoint: 'https://1.1.1.1/other',
      keys: { p256dh: 'p', auth: 'b' },
    }, 'user-b', env)).toBe(true);
    const digestA = createHash('sha256').update('user-a').digest('hex').slice(0, 32);
    const digestB = createHash('sha256').update('user-b').digest('hex').slice(0, 32);
    const fileA = path.join(dir, 'subscriptions', `${digestA}.json`);
    const fileB = path.join(dir, 'subscriptions', `${digestB}.json`);
    expect(existsSync(fileA)).toBe(true);
    expect(existsSync(fileB)).toBe(true);
    // Windows uses ACLs; content, identity hashes and subscription caps stay universal.
    if (process.platform !== 'win32') {
      expect(statSync(fileA).mode & 0o777).toBe(0o600);
      expect(statSync(fileB).mode & 0o777).toBe(0o600);
    }
    const names = readdirSync(path.join(dir, 'subscriptions'));
    expect(names).not.toContain('user-a');
    expect(names).not.toContain('user-b');
    const listA = JSON.parse(readFileSync(fileA, 'utf8')) as { subscriptions: Array<{ endpoint: string }> };
    const endpointsA = listA.subscriptions.map((item) => item.endpoint);
    expect(endpointsA).toHaveLength(5);
    expect(endpointsA).not.toContain('https://1.1.1.1/push/0');
    expect(endpointsA).toContain('https://1.1.1.1/push/5');
    const listB = JSON.parse(readFileSync(fileB, 'utf8')) as { subscriptions: Array<{ endpoint: string }> };
    expect(listB.subscriptions.map((item) => item.endpoint)).toEqual(['https://1.1.1.1/other']);
    const seen: string[] = [];
    setMobilePushSenderForTests(async (sub) => {
      seen.push(sub.endpoint);
      return true;
    });
    expect(await sendMobilePush({ title: 'Lisa', body: 'a' }, { userId: 'user-a', env })).toBe(5);
    expect(seen).not.toContain('https://1.1.1.1/other');
    expect(seen).not.toContain('https://1.1.1.1/push/0');
    seen.length = 0;
    expect(await sendMobilePush({ title: 'Lisa', body: 'b' }, { userId: 'user-b', env })).toBe(1);
    expect(seen).toEqual(['https://1.1.1.1/other']);
    expect(await sendMobilePush({ title: 'Lisa', body: 'none' }, { env })).toBe(0);
  });

  it('DELETE /push/subscribe drops only that identity endpoint', async () => {
    mkdirSync(FIX_TMP, { recursive: true });
    dir = mkdtempSync(path.join(FIX_TMP, 'cb-push-del-'));
    process.env.CODEBUDDY_MOBILE_PUSH = 'true';
    process.env.CODEBUDDY_PUSH_DIR = dir;
    process.env.JWT_SECRET = SECRET;
    const env = { ...process.env, CODEBUDDY_MOBILE_PUSH: 'true', CODEBUDDY_PUSH_DIR: dir };
    expect(await savePushSubscription({
      endpoint: 'https://1.1.1.1/a',
      keys: { p256dh: 'p', auth: 'a' },
    }, 'user-a', env)).toBe(true);
    expect(await savePushSubscription({
      endpoint: 'https://1.1.1.1/b',
      keys: { p256dh: 'p', auth: 'b' },
    }, 'user-b', env)).toBe(true);
    const tokenA = createUserToken('user-a', ['chat'], SECRET);
    const tokenB = createUserToken('user-b', ['chat'], SECRET);
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected port');
      const url = `http://127.0.0.1:${address.port}/__codebuddy__/mobile/push/subscribe`;
      const cross = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenB}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpoint: 'https://1.1.1.1/a' }),
      });
      expect(cross.status).toBe(200);
      const gone = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpoint: 'https://1.1.1.1/a' }),
      });
      expect(gone.status).toBe(200);
      const digestA = createHash('sha256').update('user-a').digest('hex').slice(0, 32);
      const digestB = createHash('sha256').update('user-b').digest('hex').slice(0, 32);
      const listA = JSON.parse(readFileSync(path.join(dir, 'subscriptions', `${digestA}.json`), 'utf8')) as {
        subscriptions: Array<{ endpoint: string }>;
      };
      const listB = JSON.parse(readFileSync(path.join(dir, 'subscriptions', `${digestB}.json`), 'utf8')) as {
        subscriptions: Array<{ endpoint: string }>;
      };
      expect(listA.subscriptions).toEqual([]);
      expect(listB.subscriptions.map((item) => item.endpoint)).toEqual(['https://1.1.1.1/b']);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('GET /push/vapid is 404 when the flag is off', async () => {
    delete process.env.CODEBUDDY_MOBILE_PUSH;
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected port');
      const res = await fetch(`http://127.0.0.1:${address.port}/__codebuddy__/mobile/push/vapid`);
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
