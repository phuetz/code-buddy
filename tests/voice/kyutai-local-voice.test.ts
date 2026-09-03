import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkKyutaiLocalHealth,
  openKyutaiPcm24kStream,
  resolveKyutaiCacheVoice,
  resolveKyutaiLocalTimeoutMs,
  resolveKyutaiLocalUrl,
} from '../../src/voice/kyutai-local-voice.js';
import {
  resetPocketServer,
  synthesizeKyutaiWithFallbackWav,
} from '../../src/voice/local-tts.js';
import { resetElevenLabsVoiceState } from '../../src/voice/elevenlabs-voice.js';

function pcm24k(samples = 240): Buffer {
  const pcm = Buffer.alloc(samples * 2);
  for (let offset = 0; offset < pcm.length; offset += 2) {
    pcm.writeInt16LE(offset % 8 === 0 ? 1_600 : -900, offset);
  }
  return pcm;
}

function pocketWav(): Buffer {
  const pcm = pcm24k();
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  wav.write('fmt ', 12, 4, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 4, 'ascii');
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    chunks.push(Buffer.from(value));
  }
}

describe('Kyutai local voice provider', () => {
  let server: Server | null = null;
  let home = '';

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cb-dark3-'));
    resetElevenLabsVoiceState();
    resetPocketServer();
  });

  afterEach(async () => {
    resetElevenLabsVoiceState();
    resetPocketServer();
    await close(server);
    server = null;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is opt-in by URL, defaults to 1500 ms, and isolates n_q in the cache identity', () => {
    expect(resolveKyutaiLocalUrl({})).toBeNull();
    expect(resolveKyutaiLocalTimeoutMs({})).toBe(1_500);
    expect(resolveKyutaiLocalTimeoutMs({ CODEBUDDY_TTS_LOCAL_TIMEOUT_MS: '75' })).toBe(75);

    const voice12 = resolveKyutaiCacheVoice({
      CODEBUDDY_TTS_LOCAL_URL: 'http://127.0.0.1:8300',
      CODEBUDDY_TTS_LOCAL_N_Q: '12',
    });
    const voice24 = resolveKyutaiCacheVoice({
      CODEBUDDY_TTS_LOCAL_URL: 'http://127.0.0.1:8300',
      CODEBUDDY_TTS_LOCAL_N_Q: '24',
    });
    expect(voice12).toContain('local:kyutai:12:');
    expect(voice24).toContain('local:kyutai:24:');
    expect(voice12).not.toBe(voice24);
    expect(voice12).not.toContain('elevenlabs:');
  });

  it('checks GET /health and reports the server n_q without sending speech', async () => {
    const requests: string[] = [];
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        engine: 'kyutai',
        n_q: 12,
        sample_rate: 24000,
        format: 'pcm_s16le_mono',
      }));
    });
    const url = await listen(server);

    await expect(checkKyutaiLocalHealth({
      CODEBUDDY_TTS_LOCAL_URL: url,
      CODEBUDDY_TTS_LOCAL_TIMEOUT_MS: '200',
    })).resolves.toMatchObject({ healthy: true, nQ: 12 });
    expect(requests).toEqual(['GET /health']);
  });

  it('POSTs the exact JSON phrase and resolves only after the first PCM byte, before stream end', async () => {
    let releaseFirst!: () => void;
    let releaseTail!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const tailGate = new Promise<void>((resolve) => { releaseTail = resolve; });
    let received = '';
    let responseEnded = false;
    server = createServer((req, res) => {
      req.setEncoding('utf8');
      req.on('data', (chunk) => { received += chunk; });
      req.on('end', () => {
        res.setHeader('content-type', 'audio/pcm;rate=24000;channels=1;format=s16le');
        res.setHeader('x-audio-sample-rate', '24000');
        res.setHeader('x-audio-format', 's16le');
        res.flushHeaders();
        void firstGate.then(() => {
          res.write(pcm24k(40));
          void tailGate.then(() => {
            responseEnded = true;
            res.end(pcm24k(20));
          });
        });
      });
    });
    const url = await listen(server);
    let settled = false;
    const opened = openKyutaiPcm24kStream(
      'Bonjour depuis Ministar.',
      { CODEBUDDY_TTS_LOCAL_URL: url, CODEBUDDY_TTS_LOCAL_TIMEOUT_MS: '500' },
    ).then((value) => {
      settled = true;
      return value;
    });

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(settled).toBe(false);
    releaseFirst();
    const stream = await opened;
    expect(stream).not.toBeNull();
    expect(responseEnded).toBe(false);
    expect(JSON.parse(received)).toEqual({ text: 'Bonjour depuis Ministar.' });
    releaseTail();
    await expect(readAll(stream!)).resolves.toHaveLength(pcm24k(40).length + pcm24k(20).length);
  });

  it('times out while waiting for the first PCM byte even when headers arrived', async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'audio/pcm');
        res.flushHeaders();
      });
    });
    const url = await listen(server);

    await expect(openKyutaiPcm24kStream('Ça ne doit pas rester bloqué.', {
      CODEBUDDY_TTS_LOCAL_URL: url,
      CODEBUDDY_TTS_LOCAL_TIMEOUT_MS: '25',
    })).resolves.toBeNull();
  });

  it.each(['cut', 'timeout'] as const)(
    'retries the unchanged phrase through ElevenLabs after a Kyutai %s',
    async (failure) => {
      const localBodies: string[] = [];
      server = createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          localBodies.push(body);
          res.setHeader('content-type', 'audio/pcm');
          res.flushHeaders();
          if (failure === 'cut') {
            res.write(pcm24k(20));
            res.socket?.destroy();
          }
        });
      });
      const url = await listen(server);
      const elevenBodies: string[] = [];
      const elevenFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        elevenBodies.push(String(init?.body));
        return new Response(pcm24k(), { status: 200 });
      });
      const output = join(home, `${failure}.wav`);
      const phrase = 'La phrase entière doit survivre au repli.';

      await expect(synthesizeKyutaiWithFallbackWav(phrase, output, {
        CODEBUDDY_HOME: home,
        CODEBUDDY_TTS_LOCAL_URL: url,
        CODEBUDDY_TTS_LOCAL_TIMEOUT_MS: '25',
        CODEBUDDY_TTS_VOICE: 'elevenlabs:test-voice',
        ELEVENLABS_API_KEY: 'test-key',
      }, {
        elevenLabs: { fetchImpl: elevenFetch as unknown as typeof fetch },
      })).resolves.toBe(true);

      expect(JSON.parse(localBodies[0]!)).toEqual({ text: phrase });
      expect(JSON.parse(elevenBodies[0]!)).toMatchObject({ text: phrase });
      expect(readFileSync(output).subarray(0, 4).toString('ascii')).toBe('RIFF');
    },
  );

  it('falls through ElevenLabs to Pocket with the exact same phrase', async () => {
    const phrase = 'Ne perds jamais cette phrase.';
    const localBodies: string[] = [];
    const pocketBodies: string[] = [];
    server = createServer((req, res) => {
      if (req.url === '/health') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'healthy' }));
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.headers['content-type'] === 'application/json') {
          localBodies.push(body);
          res.statusCode = 503;
          res.end();
          return;
        }
        pocketBodies.push(body);
        res.setHeader('content-type', 'audio/wav');
        res.end(pocketWav());
      });
    });
    const url = await listen(server);
    const externalFetch = vi.fn(async () => new Response(null, { status: 503 }));
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const target = String(input);
      if (target.startsWith(url)) return nativeFetch(input, init);
      throw new Error(`unexpected external request: ${target}`);
    });
    const output = join(home, 'pocket.wav');

    await expect(synthesizeKyutaiWithFallbackWav(phrase, output, {
      CODEBUDDY_HOME: home,
      CODEBUDDY_TTS_LOCAL_URL: url,
      CODEBUDDY_TTS_LOCAL_TIMEOUT_MS: '100',
      CODEBUDDY_TTS_VOICE: 'elevenlabs:test-voice',
      CODEBUDDY_POCKET_SERVER: 'true',
      CODEBUDDY_POCKET_URL: url,
      ELEVENLABS_API_KEY: 'test-key',
    }, {
      elevenLabs: { fetchImpl: externalFetch as unknown as typeof fetch },
    })).resolves.toBe(true);

    expect(externalFetch).toHaveBeenCalledTimes(1);
    expect(localBodies).toHaveLength(1);
    expect(JSON.parse(localBodies[0]!)).toEqual({ text: phrase });
    expect(pocketBodies.join('\n')).toContain(phrase);
    expect(readFileSync(output).subarray(0, 4).toString('ascii')).toBe('RIFF');
  });
});
