import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPocketServerArgs,
  openPocketAudioStream,
  resetPocketServer,
  resolvePocketServerUrl,
  resolveTtsEngine,
  synthesizePocketWav,
} from '../../src/voice/local-tts.js';

describe('Pocket TTS selection', () => {
  it('uses Pocket by default and accepts explicit Voicebox or Piper selection', () => {
    expect(resolveTtsEngine({})).toBe('pocket');
    expect(resolveTtsEngine({ CODEBUDDY_TTS_ENGINE: 'pocket' })).toBe('pocket');
    expect(resolveTtsEngine({ CODEBUDDY_TTS_ENGINE: 'voicebox' })).toBe('voicebox');
    expect(resolveTtsEngine({ CODEBUDDY_TTS_ENGINE: 'piper' })).toBe('piper');
    expect(resolveTtsEngine({ CODEBUDDY_TTS_ENGINE: 'unknown' })).toBe('pocket');
  });

  it('builds a loopback resident-server command on the non-AudioReader port', () => {
    expect(resolvePocketServerUrl({})).toBe('http://127.0.0.1:8766');
    expect(
      buildPocketServerArgs(
        { command: 'uvx', argsPrefix: ['pocket-tts'] },
        'http://127.0.0.1:8766',
        'french_24l',
        true
      )
    ).toEqual([
      'pocket-tts',
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '8766',
      '--language',
      'french_24l',
      '--quantize',
    ]);
  });
});

describe('Pocket resident server client', () => {
  let server: Server | null = null;
  let dir = '';

  afterEach(async () => {
    resetPocketServer();
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('uses an already-running Pocket server instead of spawning the one-shot CLI', async () => {
    const wav = Buffer.alloc(64, 1);
    server = createServer((req, res) => {
      if (req.url === '/health') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'healthy' }));
        return;
      }
      if (req.url === '/tts' && req.method === 'POST') {
        req.resume();
        req.on('end', () => {
          res.setHeader('content-type', 'audio/wav');
          res.end(wav);
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    dir = mkdtempSync(join(tmpdir(), 'pocket-server-test-'));
    const output = join(dir, 'speech.wav');

    const ok = await synthesizePocketWav(
      'Bonjour',
      output,
      {
        CODEBUDDY_TTS_ENGINE: 'pocket',
        CODEBUDDY_POCKET_SERVER: 'true',
        CODEBUDDY_POCKET_URL: `http://127.0.0.1:${address.port}`,
        CODEBUDDY_POCKET_VOICE: 'estelle',
      },
      2_000
    );

    expect(ok).toBe(true);
    expect(readFileSync(output)).toEqual(wav);
  });

  it('does not start synthesis when the spoken turn was already interrupted', async () => {
    const controller = new AbortController();
    controller.abort();
    const ok = await synthesizePocketWav(
      'Cette phrase ne doit pas démarrer.',
      join(tmpdir(), 'pocket-aborted.wav'),
      { CODEBUDDY_POCKET_SERVER: 'false' },
      2_000,
      controller.signal
    );
    expect(ok).toBe(false);
  });

  it('exposes Pocket WAV chunks without waiting for the complete response', async () => {
    server = createServer((req, res) => {
      if (req.url === '/health') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'healthy' }));
        return;
      }
      if (req.url === '/tts' && req.method === 'POST') {
        req.resume();
        req.on('end', () => {
          res.setHeader('content-type', 'audio/wav');
          res.write(Buffer.alloc(44, 1));
          setTimeout(() => res.end(Buffer.alloc(20, 2)), 10);
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');

    const stream = await openPocketAudioStream(
      'Bonjour en direct',
      {
        CODEBUDDY_POCKET_SERVER: 'true',
        CODEBUDDY_POCKET_URL: `http://127.0.0.1:${address.port}`,
        CODEBUDDY_POCKET_VOICE: 'estelle',
      },
      { timeoutMs: 2_000 }
    );
    expect(stream).not.toBeNull();
    const reader = stream!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value?.byteLength).toBe(44);
    const second = await reader.read();
    expect(second.done).toBe(false);
    expect(second.value?.byteLength).toBe(20);
  });
});
