import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { sendTelegramVoice } from '../../src/sensory/alert.js';

let ogg: string;

beforeEach(async () => {
  ogg = path.join(os.tmpdir(), `cb-voice-test-${process.pid}-${Date.now()}.ogg`);
  await writeFile(ogg, Buffer.from([0x4f, 0x67, 0x67, 0x53])); // "OggS"
});
afterEach(async () => {
  await rm(ogg, { force: true });
  delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
});

describe('sendTelegramVoice — voice note to the phone', () => {
  it('no-op (false) when the alert token/chat is unconfigured', async () => {
    let posted = false;
    const ok = await sendTelegramVoice('bonjour', {
      synthesize: async () => ogg,
      post: async () => {
        posted = true;
        return { ok: true };
      },
    });
    expect(ok).toBe(false);
    expect(posted).toBe(false); // never even synthesizes/sends
  });

  it('synthesizes to OGG and POSTs sendVoice when configured', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    const calls: Array<{ url: string; hasVoice: boolean; chat: unknown }> = [];
    const ok = await sendTelegramVoice("c'est l'heure de tes médicaments", {
      synthesize: async () => ogg,
      post: async (url, form) => {
        calls.push({ url, hasVoice: form.has('voice'), chat: form.get('chat_id') });
        return { ok: true };
      },
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/bottok/sendVoice');
    expect(calls[0]!.hasVoice).toBe(true);
    expect(calls[0]!.chat).toBe('123');
  });

  it('never throws when synthesis fails (falls back, returns false)', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    await expect(
      sendTelegramVoice('x', {
        synthesize: async () => {
          throw new Error('piper/ffmpeg missing');
        },
        // text fallback also goes through global fetch; stub post is unused on the throw path.
        post: async () => ({ ok: true }),
      }),
    ).resolves.toBe(false);
  });
});
