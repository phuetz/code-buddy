import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mobilePwaRouter } from '../../src/server/mobile/index.js';
import {
  isMobilePushEnabled,
  loadOrCreateVapidKeys,
  savePushSubscription,
  sendMobilePush,
  setMobilePushSenderForTests,
} from '../../src/server/mobile/push.js';

describe('mobile web push (lot 3)', () => {
  const previousPush = process.env.CODEBUDDY_MOBILE_PUSH;
  const previousDir = process.env.CODEBUDDY_PUSH_DIR;
  let dir = '';

  afterEach(() => {
    if (previousPush === undefined) delete process.env.CODEBUDDY_MOBILE_PUSH;
    else process.env.CODEBUDDY_MOBILE_PUSH = previousPush;
    if (previousDir === undefined) delete process.env.CODEBUDDY_PUSH_DIR;
    else process.env.CODEBUDDY_PUSH_DIR = previousDir;
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
    expect(savePushSubscription({
      endpoint: 'https://push.example/sub',
      keys: { p256dh: 'p', auth: 'a' },
    })).toBe(true);
    const seen: string[] = [];
    setMobilePushSenderForTests(async (sub, payload) => {
      seen.push(`${sub.endpoint}:${payload.body}`);
      return true;
    });
    expect(await sendMobilePush({ title: 'Lisa', body: 'coucou' })).toBe(1);
    expect(seen).toEqual(['https://push.example/sub:coucou']);
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
