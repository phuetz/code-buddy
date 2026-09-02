/**
 * makeDefaultStreamSpeak × ElevenLabs — the native audio stream that replaces
 * the per-sentence blocking synth+play couple (the "haché" defect), with its
 * two economic guarantees:
 *   - a phrase already paid for (permanent library, TTS cache) NEVER reopens
 *     the billed network stream;
 *   - a freshly streamed phrase is written back to the TTS cache so repeating
 *     it costs zero.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playerHarness = vi.hoisted(() => ({
  spawn: vi.fn(),
  commands: [] as string[],
  args: [] as string[][],
  written: [] as Buffer[],
}));
const commandExists = vi.hoisted(() => vi.fn(async (command: string) => command === 'aplay'));
const cacheHarness = vi.hoisted(() => ({
  lookup: vi.fn((): string | null => null),
  store: vi.fn(),
  storedWavs: [] as Buffer[],
}));
const libraryCopy = vi.hoisted(() => vi.fn((): string | null => null));
const openElevenLabsAudioStream = vi.hoisted(() => vi.fn());
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

import { __voiceAudioPlayerTest } from '../../src/sensory/voice-loop.js';
import { pcm16Mono24kStreamWavHeader } from '../../src/voice/local-tts.js';

function pcmBody(): Buffer {
  const pcm = Buffer.alloc(4_800);
  for (let offset = 0; offset < pcm.length; offset += 2) {
    pcm.writeInt16LE(offset % 6 === 0 ? 3_000 : -2_000, offset);
  }
  return pcm;
}

function wavStreamOf(...parts: Buffer[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(new Uint8Array(part));
      controller.close();
    },
  });
}

describe('makeDefaultStreamSpeak — ElevenLabs engine', () => {
  beforeEach(() => {
    playerHarness.commands.length = 0;
    playerHarness.args.length = 0;
    playerHarness.written.length = 0;
    playerHarness.spawn.mockImplementation((command: string, args: string[], options: {
      stdio: unknown;
    }) => {
      playerHarness.commands.push(command);
      playerHarness.args.push(args);
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough | null;
        kill: () => boolean;
      };
      child.stdin = Array.isArray(options.stdio) ? new PassThrough() : null;
      child.kill = () => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      };
      if (child.stdin) {
        child.stdin.on('data', (chunk: Buffer) => playerHarness.written.push(chunk));
        child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
      } else {
        queueMicrotask(() => child.emit('close', 0));
      }
      return child;
    });
    commandExists.mockClear();
    cacheHarness.lookup.mockReset();
    cacheHarness.lookup.mockReturnValue(null);
    cacheHarness.store.mockReset();
    cacheHarness.storedWavs.length = 0;
    cacheHarness.store.mockImplementation((_text: string, _voice: string, wavPath: string) => {
      cacheHarness.storedWavs.push(readFileSync(wavPath));
    });
    libraryCopy.mockReset();
    libraryCopy.mockReturnValue(null);
    openElevenLabsAudioStream.mockReset();
    openElevenLabsAudioStream.mockImplementation(async () =>
      wavStreamOf(pcm16Mono24kStreamWavHeader(), pcmBody())
    );
    delete process.env.CODEBUDDY_ELEVENLABS_AUDIO_STREAM;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CODEBUDDY_ELEVENLABS_AUDIO_STREAM;
  });

  it('is DEFINED for the elevenlabs engine and pipes the stream into the stdin player', async () => {
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs');

    expect(streamSpeak).toBeDefined();
    expect(await streamSpeak!('Voici une phrase toute neuve.')).toBe(true);

    expect(openElevenLabsAudioStream).toHaveBeenCalledTimes(1);
    expect(playerHarness.commands).toEqual(['aplay']);
    expect(playerHarness.args[0]).toContain('-');
    const streamed = Buffer.concat(playerHarness.written);
    expect(streamed.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(streamed.length).toBeGreaterThan(44);
  });

  it('stays undefined when the operator opts out via CODEBUDDY_ELEVENLABS_AUDIO_STREAM=false', () => {
    process.env.CODEBUDDY_ELEVENLABS_AUDIO_STREAM = 'false';
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    expect(
      __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs')
    ).toBeUndefined();
  });

  it('plays a TTS-cache hit from disk and NEVER opens the billed stream', async () => {
    cacheHarness.lookup.mockReturnValue('/tmp/cb-test-cached-elevenlabs.wav');
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs');

    expect(await streamSpeak!('Bonjour Patrice.')).toBe(true);

    expect(cacheHarness.lookup).toHaveBeenCalledWith('Bonjour Patrice.', CACHE_VOICE);
    expect(openElevenLabsAudioStream).not.toHaveBeenCalled();
    expect(playerHarness.args[0]).toContain('/tmp/cb-test-cached-elevenlabs.wav');
  });

  it('plays a paid-library hit and NEVER opens the billed stream', async () => {
    libraryCopy.mockReturnValue('/tmp/cb-test-library-phrase.wav');
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs');

    expect(await streamSpeak!('Oui je t’entends.')).toBe(true);

    expect(libraryCopy).toHaveBeenCalled();
    expect(cacheHarness.lookup).not.toHaveBeenCalled();
    expect(openElevenLabsAudioStream).not.toHaveBeenCalled();
    expect(playerHarness.args[0]).toContain('/tmp/cb-test-library-phrase.wav');
  });

  it('writes the completed streamed clip back to the TTS cache (repetition is free)', async () => {
    let completeHook: ((pcm: Buffer) => void) | undefined;
    openElevenLabsAudioStream.mockImplementation(
      async (_text: string, _env: NodeJS.ProcessEnv, options: {
        onPcmComplete?: (pcm: Buffer) => void;
      }) => {
        completeHook = options.onPcmComplete;
        return wavStreamOf(pcm16Mono24kStreamWavHeader(), pcmBody());
      }
    );
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs');

    expect(await streamSpeak!('Phrase fraîchement facturée.')).toBe(true);
    expect(completeHook).toBeDefined();

    completeHook!(pcmBody());
    await vi.waitFor(() => expect(cacheHarness.store).toHaveBeenCalledTimes(1));
    expect(cacheHarness.store.mock.calls[0]![0]).toBe('Phrase fraîchement facturée.');
    expect(cacheHarness.store.mock.calls[0]![1]).toBe(CACHE_VOICE);
    // The stored WAV is a complete normalized container, not raw PCM.
    const stored = cacheHarness.storedWavs[0]!;
    expect(stored.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(stored.length).toBe(44 + pcmBody().length);
  });

  it('returns false (WAV fallback contract) when the stream cannot be opened', async () => {
    openElevenLabsAudioStream.mockResolvedValue(null);
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs');

    expect(await streamSpeak!('Une phrase sans réseau.')).toBe(false);
    expect(playerHarness.commands).toEqual([]);
  });

  describe('look-ahead (prefetch) — inherits the engine harness above', () => {
  it('prefetch(text) opens the billed stream ONCE and the later streamSpeak(text) reuses it', async () => {
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs')!;
    expect(typeof streamSpeak.prefetch).toBe('function');

    streamSpeak.prefetch!('Phrase préchargée pendant la précédente.');
    await new Promise((r) => setTimeout(r, 0));
    expect(openElevenLabsAudioStream).toHaveBeenCalledTimes(1);

    expect(await streamSpeak('Phrase préchargée pendant la précédente.')).toBe(true);
    expect(openElevenLabsAudioStream).toHaveBeenCalledTimes(1);
    const streamed = Buffer.concat(playerHarness.written);
    expect(streamed.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(streamed.length).toBeGreaterThan(44);
  });

  it('a prefetched paid-library hit is played from disk and never opens the billed stream', async () => {
    libraryCopy.mockReturnValue('/tmp/cb-test-library-prefetched.wav');
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs')!;

    streamSpeak.prefetch!('Oui je t’entends.');
    await new Promise((r) => setTimeout(r, 0));
    expect(await streamSpeak('Oui je t’entends.')).toBe(true);

    expect(openElevenLabsAudioStream).not.toHaveBeenCalled();
    expect(playerHarness.args[0]).toContain('/tmp/cb-test-library-prefetched.wav');
  });

  it('is not exposed for Pocket (single-request server)', () => {
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'pocket');
    expect(streamSpeak?.prefetch).toBeUndefined();
  });

  it('an aborted prefetch is dropped: the sentence is opened fresh when finally spoken', async () => {
    const playerPromise = __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    const streamSpeak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(playerPromise, 'elevenlabs')!;
    const controller = new AbortController();
    streamSpeak.prefetch!('Phrase interrompue.', { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();

    expect(await streamSpeak('Phrase interrompue.')).toBe(true);
    // One open for the cancelled look-ahead, one honest reopen for the real turn.
    expect(openElevenLabsAudioStream).toHaveBeenCalledTimes(2);
  });
});
});
