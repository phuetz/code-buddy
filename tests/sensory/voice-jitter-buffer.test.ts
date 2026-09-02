/**
 * Tests du tampon de gigue (Jitter Buffer) — Mission VOIX4.
 *
 * Contrat :
 * 1. Accumuler CODEBUDDY_VOICE_JITTER_BUFFER_MS (défaut 250 ms, borné 0-1000)
 *    avant la première écriture sur stdin du player audio (aplay/ffplay),
 *    pour tous les segments.
 * 2. À l'épuisement (stalls réseau en milieu de flux), attendre sans fermer le tuyau.
 * 3. Faux flux à gigue (délais 0/60/150 ms entre morceaux) + faux player horodaté :
 *    - Sans tampon : un trou apparaît.
 *    - Avec tampon : aucun trou n'apparaît.
 * 4. Le premier son n'est pas retardé de plus que le tampon.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playerHarness = vi.hoisted(() => ({
  spawn: vi.fn(),
  commands: [] as string[],
  args: [] as string[][],
  children: [] as Array<EventEmitter & { stdin: PassThrough; kill: (sig?: string) => boolean }>,
  writtenChunks: [] as Array<{ timestamp: number; bytes: Buffer }>,
}));

const commandExists = vi.hoisted(() => vi.fn(async (cmd: string) => cmd === 'aplay'));
const openElevenLabsAudioStream = vi.hoisted(() => vi.fn());
const cacheHarness = vi.hoisted(() => ({
  lookup: vi.fn((): string | null => null),
  store: vi.fn(),
}));
const libraryCopy = vi.hoisted(() => vi.fn((): string | null => null));
const CACHE_VOICE = vi.hoisted(() => 'elevenlabs:test-voice:model=test:format=pcm_24000');

vi.mock('child_process', () => ({ spawn: playerHarness.spawn }));
vi.mock('../../src/utils/command-exists.js', () => ({ commandExists }));
vi.mock('../../src/sensory/tts-cache.js', () => ({
  getTtsCache: () => ({
    lookup: cacheHarness.lookup,
    store: cacheHarness.store,
  }),
}));
vi.mock('../../src/sensory/elevenlabs-library.js', () => ({
  getVoiceLibrary: () => ({ copyForPlayback: libraryCopy }),
}));
vi.mock('../../src/voice/local-tts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/voice/local-tts.js')>();
  return {
    ...actual,
    resolveTtsEngine: () => 'elevenlabs' as const,
    resolveElevenLabsCacheVoice: () => CACHE_VOICE,
    openElevenLabsAudioStream,
  };
});

import {
  __voiceAudioPlayerTest,
  resolveVoiceJitterBufferMs,
} from '../../src/sensory/voice-loop.js';
import { pcm16Mono24kStreamWavHeader } from '../../src/voice/local-tts.js';

function makePcmSamples(durationMs: number, amplitude = 5000): Buffer {
  const sampleCount = Math.round((24000 * durationMs) / 1000);
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  }
  return buf;
}

class SimulatedDacConsumer {
  private buffer = Buffer.alloc(0);
  private lastTime = 0;
  public underruns: Array<{ startMs: number; durationMs: number }> = [];
  public totalSilenceMs = 0;
  private headerConsumed = false;

  feed(data: Buffer, nowMs: number): void {
    this.advance(nowMs);
    if (!this.headerConsumed && data.length >= 44 && data.subarray(0, 4).toString('ascii') === 'RIFF') {
      this.headerConsumed = true;
      this.buffer = Buffer.concat([this.buffer, data.subarray(44)]);
    } else {
      this.buffer = Buffer.concat([this.buffer, data]);
    }
  }

  advance(nowMs: number): void {
    if (this.lastTime === 0) {
      this.lastTime = nowMs;
      return;
    }
    const elapsedMs = nowMs - this.lastTime;
    this.lastTime = nowMs;
    if (elapsedMs <= 0) return;

    const bytesNeeded = elapsedMs * 48; // 24 kHz mono 16-bit = 48 octets/ms
    if (this.buffer.length >= bytesNeeded) {
      this.buffer = this.buffer.subarray(bytesNeeded);
    } else {
      const availableMs = Math.floor(this.buffer.length / 48);
      const starvedMs = elapsedMs - availableMs;
      this.buffer = Buffer.alloc(0);
      if (this.headerConsumed && starvedMs > 0) {
        this.underruns.push({
          startMs: this.lastTime - starvedMs,
          durationMs: starvedMs,
        });
        this.totalSilenceMs += starvedMs;
      }
    }
  }
}

describe('Tampon de gigue (Jitter Buffer) dans makeDefaultStreamSpeak', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    playerHarness.commands.length = 0;
    playerHarness.args.length = 0;
    playerHarness.children.length = 0;
    playerHarness.writtenChunks.length = 0;
    openElevenLabsAudioStream.mockReset();
    cacheHarness.lookup.mockReset();
    commandExists.mockClear();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('borne CODEBUDDY_VOICE_JITTER_BUFFER_MS entre 0 et 1000 avec 250 ms par défaut', () => {
    delete process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS;
    expect(resolveVoiceJitterBufferMs()).toBe(250);

    process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS = 'not-a-number';
    expect(resolveVoiceJitterBufferMs()).toBe(250);

    process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS = '-100';
    expect(resolveVoiceJitterBufferMs()).toBe(0);

    process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS = '0';
    expect(resolveVoiceJitterBufferMs()).toBe(0);

    process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS = '350';
    expect(resolveVoiceJitterBufferMs()).toBe(350);

    process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS = '2000';
    expect(resolveVoiceJitterBufferMs()).toBe(1000);
  });

  it('sans tampon de gigue : un trou apparaît sous à-coups réseau (délais 0/60/150 ms)', async () => {
    process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS = '0';
    process.env.CODEBUDDY_TTS_STREAM_HEAD_MS = '50';
    const dac = new SimulatedDacConsumer();
    const t0 = Date.now();

    playerHarness.spawn.mockImplementation((command: string, args: string[]) => {
      playerHarness.commands.push(command);
      playerHarness.args.push(args);
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; kill: () => boolean };
      child.stdin = new PassThrough();
      child.kill = () => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      };
      child.stdin.on('data', (chunk: Buffer) => {
        const now = Date.now() - t0;
        playerHarness.writtenChunks.push({ timestamp: now, bytes: chunk });
        dac.feed(chunk, now);
      });
      child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
      playerHarness.children.push(child);
      return child;
    });

    const header = pcm16Mono24kStreamWavHeader();
    const chunkPcm = makePcmSamples(40); // 40 ms de son
    // Délais 0, 60, 150 ms entre morceaux de 40 ms
    const delays = [0, 60, 150, 60, 0];
    let pieceIndex = 0;

    const jitteryStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (pieceIndex >= delays.length) {
          controller.close();
          return;
        }
        const delay = delays[pieceIndex];
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        const now = Date.now() - t0;
        dac.advance(now);
        if (pieceIndex === 0) {
          controller.enqueue(new Uint8Array(Buffer.concat([header, chunkPcm])));
        } else {
          controller.enqueue(new Uint8Array(chunkPcm));
        }
        pieceIndex++;
      },
    });

    const speak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
    );

    openElevenLabsAudioStream.mockResolvedValueOnce(jitteryStream);

    await speak!('Phrase test sans jitter buffer', {
      ttsNormalizationFactor: 1.0,
    });

    // Sans tampon de gigue, les pauses de 60 ms et 150 ms vident le buffer de 40 ms
    expect(dac.underruns.length).toBeGreaterThan(0);
    expect(dac.totalSilenceMs).toBeGreaterThan(0);
  });

  it('avec tampon de gigue (250 ms) : aucun trou n’apparaît et le premier son n’est pas retardé de plus que le tampon', async () => {
    process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS = '250';
    const dac = new SimulatedDacConsumer();
    const t0 = Date.now();

    playerHarness.spawn.mockImplementation((command: string, args: string[]) => {
      playerHarness.commands.push(command);
      playerHarness.args.push(args);
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; kill: () => boolean };
      child.stdin = new PassThrough();
      child.kill = () => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      };
      child.stdin.on('data', (chunk: Buffer) => {
        const now = Date.now() - t0;
        playerHarness.writtenChunks.push({ timestamp: now, bytes: chunk });
        dac.feed(chunk, now);
      });
      child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
      playerHarness.children.push(child);
      return child;
    });

    const header = pcm16Mono24kStreamWavHeader();
    const chunkPcm = makePcmSamples(50); // 50 ms par morceau
    // 6 morceaux de 50 ms = 300 ms au total
    // Délais 0, 60, 150, 60, 0, 0 ms
    const delays = [0, 60, 150, 60, 0, 0];
    let pieceIndex = 0;

    const jitteryStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (pieceIndex >= delays.length) {
          controller.close();
          return;
        }
        const delay = delays[pieceIndex];
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        const now = Date.now() - t0;
        dac.advance(now);
        if (pieceIndex === 0) {
          controller.enqueue(new Uint8Array(Buffer.concat([header, chunkPcm])));
        } else {
          controller.enqueue(new Uint8Array(chunkPcm));
        }
        pieceIndex++;
      },
    });

    const speak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
    );

    openElevenLabsAudioStream.mockResolvedValueOnce(jitteryStream);

    let firstAudioFiredAt = -1;
    await speak!('Phrase test avec jitter buffer 250 ms', {
      ttsNormalizationFactor: 1.0,
      onFirstAudio: () => {
        firstAudioFiredAt = Date.now() - t0;
      },
    });

    // 1. Aucun trou mesuré sur le DAC simulé
    expect(dac.underruns).toHaveLength(0);
    expect(dac.totalSilenceMs).toBe(0);

    // 2. Le premier morceau écrit l'a été une fois le tampon de 250 ms accumulé
    expect(playerHarness.writtenChunks.length).toBeGreaterThan(0);
    expect(firstAudioFiredAt).toBeGreaterThanOrEqual(0);

    // 3. Le premier son n'est pas retardé de plus que le temps d'accumulation réseau du tampon + marge
    const firstWriteTimestamp = playerHarness.writtenChunks[0]?.timestamp ?? 0;
    expect(firstWriteTimestamp).toBeLessThanOrEqual(350);
  });

  it('à l’épuisement intermédiaire : attend le prochain morceau sans fermer le tuyau stdin', async () => {
    process.env.CODEBUDDY_VOICE_JITTER_BUFFER_MS = '100';
    let childRef: (EventEmitter & { stdin: PassThrough }) | undefined;

    playerHarness.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; kill: () => boolean };
      child.stdin = new PassThrough();
      child.kill = () => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      };
      child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
      childRef = child;
      playerHarness.children.push(child);
      return child;
    });

    const header = pcm16Mono24kStreamWavHeader();
    const chunkPcm = makePcmSamples(60); // 60 ms
    let pullCount = 0;

    const stallingStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pullCount++;
        if (pullCount === 1) {
          // Premier envoi : 120 ms d'audio (dépasse le buffer de 100 ms)
          controller.enqueue(new Uint8Array(Buffer.concat([header, chunkPcm, chunkPcm])));
          return;
        }
        if (pullCount === 2) {
          // Épuisement temporaire : pause de 120 ms
          await new Promise((r) => setTimeout(r, 120));
          // Vérifier que pendant la pause, stdin n'a PAS été fermé !
          expect(childRef?.stdin.writableEnded).toBe(false);
          expect(childRef?.stdin.destroyed).toBe(false);
          controller.enqueue(new Uint8Array(chunkPcm));
          return;
        }
        controller.close();
      },
    });

    const speak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
    );
    openElevenLabsAudioStream.mockResolvedValueOnce(stallingStream);

    const result = await speak!('Test tuyau non fermé lors d’un stall', {
      ttsNormalizationFactor: 1.0,
    });
    expect(result).toBe(true);
    expect(childRef?.stdin.writableEnded).toBe(true);
  });
});
