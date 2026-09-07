import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
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
    })).toBe(true);
    const seen: string[] = [];
    setMobilePushSenderForTests(async (sub, payload) => {
      seen.push(`${sub.endpoint}:${payload.body}`);
      return true;
    });
    expect(await sendMobilePush({ title: 'Lisa', body: 'coucou' })).toBe(1);
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
        expect(await savePushSubscription({ endpoint, keys: { p256dh: 'p', auth: 'a' } })).toBe(false);
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
