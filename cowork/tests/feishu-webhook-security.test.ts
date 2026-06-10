/**
 * Feishu webhook security tests — V1 GA audit blocker WS8-T4.
 *
 * Validates the Lark Open Platform webhook verification chain:
 * - signature: SHA-256 hex of `timestamp + nonce + encrypt_key + body`
 *   (plain hash keyed by the encrypt key — NOT an HMAC, NOT the
 *   verification token), mandatory whenever an encrypt key is configured
 * - decryption: AES-256-CBC, key = SHA256(encrypt_key),
 *   body = base64(IV || ciphertext)
 * - verification token: echoed claim must match whenever configured
 * - fail closed when no shared secret is configured at all
 */

import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { FeishuChannel } from '../src/main/remote/channels/feishu/feishu-channel';
import type { FeishuChannelConfig } from '../src/main/remote/types';

const ENCRYPT_KEY = 'test-encrypt-key';
const VERIFICATION_TOKEN = 'test-verification-token';

function makeChannel(overrides: Partial<FeishuChannelConfig> = {}): FeishuChannel {
  const config: FeishuChannelConfig = {
    type: 'feishu',
    appId: 'cli_test',
    appSecret: 'secret_test',
    ...overrides,
  };
  return new FeishuChannel(config);
}

/** Spec-conform signature: sha256(timestamp + nonce + encrypt_key + body). */
function sign(body: string, timestamp: string, nonce: string, key = ENCRYPT_KEY): string {
  return crypto
    .createHash('sha256')
    .update(timestamp + nonce + key + body)
    .digest('hex');
}

/** Spec-conform encryption: base64(IV || AES-256-CBC(sha256(key), payload)). */
function encrypt(payload: unknown, key = ENCRYPT_KEY): string {
  const k = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', k, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ciphertext]).toString('base64');
}

function signedHeaders(body: string, ts = '1717000000', nonce = 'nonce-1'): Record<string, string> {
  return {
    'x-lark-signature': sign(body, ts, nonce),
    'x-lark-request-timestamp': ts,
    'x-lark-request-nonce': nonce,
  };
}

describe('FeishuChannel webhook security', () => {
  it('fails closed when neither encryptKey nor verificationToken is configured', async () => {
    const channel = makeChannel();
    const body = JSON.stringify({ type: 'url_verification', challenge: 'c-1', token: 'whatever' });

    const res = await channel.handleWebhook({}, body);
    expect(res.status).toBe(403);
  });

  describe('with encryptKey configured', () => {
    it('rejects requests with no X-Lark-Signature header', async () => {
      const channel = makeChannel({ encryptKey: ENCRYPT_KEY });
      const body = JSON.stringify({ encrypt: encrypt({ type: 'url_verification', challenge: 'c-1' }) });

      const res = await channel.handleWebhook({}, body);
      expect(res.status).toBe(403);
      expect(res.data).toEqual({ error: 'Missing signature' });
    });

    it('rejects requests with an invalid signature', async () => {
      const channel = makeChannel({ encryptKey: ENCRYPT_KEY });
      const body = JSON.stringify({ encrypt: encrypt({ type: 'url_verification', challenge: 'c-1' }) });

      const res = await channel.handleWebhook(
        {
          'x-lark-signature': sign(body, '1717000000', 'nonce-1', 'wrong-key'),
          'x-lark-request-timestamp': '1717000000',
          'x-lark-request-nonce': 'nonce-1',
        },
        body
      );
      expect(res.status).toBe(403);
      expect(res.data).toEqual({ error: 'Invalid signature' });
    });

    it('accepts a correctly signed encrypted url_verification challenge', async () => {
      const channel = makeChannel({ encryptKey: ENCRYPT_KEY });
      const body = JSON.stringify({
        encrypt: encrypt({ type: 'url_verification', challenge: 'c-decrypted' }),
      });

      const res = await channel.handleWebhook(signedHeaders(body), body);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ challenge: 'c-decrypted' });
    });

    it('dispatches a correctly signed encrypted v2 message event', async () => {
      const channel = makeChannel({ encryptKey: ENCRYPT_KEY });
      const handleSpy = vi
        .spyOn(channel as unknown as { handleMessageEvent: (e: unknown) => void }, 'handleMessageEvent')
        .mockImplementation(() => {});

      const event = { message: { message_id: 'om-1' } };
      const body = JSON.stringify({
        encrypt: encrypt({
          schema: '2.0',
          header: { event_type: 'im.message.receive_v1' },
          event,
        }),
      });

      const res = await channel.handleWebhook(signedHeaders(body), body);
      expect(res.status).toBe(200);
      expect(handleSpy).toHaveBeenCalledWith(event);
    });

    it('returns 401 when the ciphertext cannot be decrypted', async () => {
      const channel = makeChannel({ encryptKey: ENCRYPT_KEY });
      const body = JSON.stringify({ encrypt: Buffer.from('garbage-not-aes').toString('base64') });

      const res = await channel.handleWebhook(signedHeaders(body), body);
      expect(res.status).toBe(401);
    });

    it('verifies the token of the decrypted payload when both secrets are configured', async () => {
      const channel = makeChannel({
        encryptKey: ENCRYPT_KEY,
        verificationToken: VERIFICATION_TOKEN,
      });

      const goodBody = JSON.stringify({
        encrypt: encrypt({ type: 'url_verification', challenge: 'c-2', token: VERIFICATION_TOKEN }),
      });
      const good = await channel.handleWebhook(signedHeaders(goodBody), goodBody);
      expect(good.status).toBe(200);
      expect(good.data).toEqual({ challenge: 'c-2' });

      const badBody = JSON.stringify({
        encrypt: encrypt({ type: 'url_verification', challenge: 'c-3', token: 'spoofed' }),
      });
      const bad = await channel.handleWebhook(signedHeaders(badBody), badBody);
      expect(bad.status).toBe(403);
    });
  });

  describe('with verificationToken only (plaintext mode — Feishu sends no signature)', () => {
    it('accepts a url_verification challenge carrying the right token', async () => {
      const channel = makeChannel({ verificationToken: VERIFICATION_TOKEN });
      const body = JSON.stringify({
        type: 'url_verification',
        challenge: 'c-plain',
        token: VERIFICATION_TOKEN,
      });

      const res = await channel.handleWebhook({}, body);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ challenge: 'c-plain' });
    });

    it('rejects payloads with a wrong or missing token', async () => {
      const channel = makeChannel({ verificationToken: VERIFICATION_TOKEN });

      const wrong = await channel.handleWebhook(
        {},
        JSON.stringify({ type: 'url_verification', challenge: 'c', token: 'spoofed' })
      );
      expect(wrong.status).toBe(403);

      const missing = await channel.handleWebhook(
        {},
        JSON.stringify({ type: 'url_verification', challenge: 'c' })
      );
      expect(missing.status).toBe(403);
    });

    it('dispatches a v2 event whose header.token matches', async () => {
      const channel = makeChannel({ verificationToken: VERIFICATION_TOKEN });
      const handleSpy = vi
        .spyOn(channel as unknown as { handleMessageEvent: (e: unknown) => void }, 'handleMessageEvent')
        .mockImplementation(() => {});

      const event = { message: { message_id: 'om-2' } };
      const body = JSON.stringify({
        schema: '2.0',
        header: { event_type: 'im.message.receive_v1', token: VERIFICATION_TOKEN },
        event,
      });

      const res = await channel.handleWebhook({}, body);
      expect(res.status).toBe(200);
      expect(handleSpy).toHaveBeenCalledWith(event);
    });
  });
});
