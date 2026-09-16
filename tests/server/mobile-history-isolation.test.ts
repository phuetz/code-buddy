import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createUserToken } from '../../src/server/auth/jwt.js';
import { appendConversationLog } from '../../src/companion/mobile-conversation-log.js';
import { mobilePwaRouter } from '../../src/server/mobile/index.js';

const SECRET = 'mobile-history-isolation-test-secret-32b';
const FIX_TMP = path.join(process.cwd(), '_qa/fix/tmp');

describe('mobile history isolation', () => {
  const previousDir = process.env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR;
  const previousSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (previousDir === undefined) delete process.env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR;
    else process.env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR = previousDir;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it('token A cannot read token B conversation history', async () => {
    mkdirSync(FIX_TMP, { recursive: true });
    const dir = mkdtempSync(path.join(FIX_TMP, 'cb-hist-iso-'));
    process.env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR = dir;
    process.env.JWT_SECRET = SECRET;
    const env = { ...process.env, CODEBUDDY_MOBILE_CONVERSATIONS_DIR: dir };
    appendConversationLog('user-a', [
      { id: 'a1', role: 'user', text: 'SECRET A', ts: 1 },
    ], env);
    appendConversationLog('user-b', [
      { id: 'b1', role: 'user', text: 'SECRET B', ts: 1 },
    ], env);
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
      const url = `http://127.0.0.1:${address.port}/__codebuddy__/mobile/history`;
      const resB = await fetch(url, { headers: { Authorization: `Bearer ${tokenB}` } });
      expect(resB.status).toBe(200);
      const bodyB = await resB.json() as { messages: Array<{ text: string }> };
      const textsB = bodyB.messages.map((row) => row.text);
      expect(textsB).toContain('SECRET B');
      expect(textsB).not.toContain('SECRET A');
      const resA = await fetch(url, { headers: { Authorization: `Bearer ${tokenA}` } });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json() as { messages: Array<{ text: string }> };
      const textsA = bodyA.messages.map((row) => row.text);
      expect(textsA).toContain('SECRET A');
      expect(textsA).not.toContain('SECRET B');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
