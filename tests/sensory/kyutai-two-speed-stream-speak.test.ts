import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playerHarness = vi.hoisted(() => ({ spawn: vi.fn() }));
const commandExists = vi.hoisted(() => vi.fn(async () => true));
const streams = vi.hoisted(() => ({
  kyutai: vi.fn(),
  elevenlabs: vi.fn(),
  pocket: vi.fn(),
}));
const cache = vi.hoisted(() => ({ lookup: vi.fn((): string | null => null), store: vi.fn() }));

vi.mock('child_process', () => ({ spawn: playerHarness.spawn }));
vi.mock('../../src/utils/command-exists.js', () => ({ commandExists }));
vi.mock('../../src/sensory/tts-cache.js', () => ({ getTtsCache: () => cache }));
vi.mock('../../src/sensory/elevenlabs-library.js', () => ({
  getVoiceLibrary: () => ({ copyForPlayback: () => null }),
}));
vi.mock('../../src/voice/local-tts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/voice/local-tts.js')>();
  return {
    ...actual,
    openKyutaiAudioStream: streams.kyutai,
    openElevenLabsAudioStream: streams.elevenlabs,
    openPocketAudioStream: streams.pocket,
  };
});

import { __voiceAudioPlayerTest } from '../../src/sensory/voice-loop.js';
import { pcm16Mono24kStreamWavHeader } from '../../src/voice/local-tts.js';
import { logger } from '../../src/utils/logger.js';

function healthyWavStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(pcm16Mono24kStreamWavHeader());
      controller.enqueue(new Uint8Array(Buffer.alloc(4_800, 2)));
      controller.close();
    },
  });
}

function cutWavStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(pcm16Mono24kStreamWavHeader());
      controller.enqueue(new Uint8Array(Buffer.alloc(480, 2)));
      controller.error(new Error('fake mid-stream cut'));
    },
  });
}

describe('Kyutai production two-speed stream routing', () => {
  beforeEach(() => {
    playerHarness.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        kill: () => boolean;
      };
      child.stdin = new PassThrough();
      child.kill = () => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      };
      child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
      return child;
    });
    cache.lookup.mockReset();
    cache.lookup.mockReturnValue(null);
    cache.store.mockReset();
    streams.kyutai.mockReset();
    streams.elevenlabs.mockReset();
    streams.pocket.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps the default disabled path byte-for-byte on ElevenLabs', async () => {
    streams.elevenlabs.mockResolvedValue(healthyWavStream());
    const speak = __voiceAudioPlayerTest.makeRoutedStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
      { CODEBUDDY_TTS_TWO_SPEED: 'false' },
    );

    await expect(speak!('Court.')).resolves.toBe(true);
    expect(streams.kyutai).not.toHaveBeenCalled();
    expect(streams.elevenlabs).toHaveBeenCalledWith('Court.', process.env, expect.any(Object));
  });

  it('routes a short segment locally and logs the decision', async () => {
    streams.kyutai.mockResolvedValue(healthyWavStream());
    const info = vi.spyOn(logger, 'info');
    const speak = __voiceAudioPlayerTest.makeRoutedStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
      { CODEBUDDY_TTS_TWO_SPEED: 'true', CODEBUDDY_TTS_SHORT_MAX_CHARS: '20' },
    );

    await expect(speak!('Réponse courte.')).resolves.toBe(true);
    expect(streams.kyutai).toHaveBeenCalledWith('Réponse courte.', process.env, expect.any(Object));
    expect(streams.elevenlabs).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('[voice] route=local reason=short<=20');
  });

  it('retries the unchanged phrase when Kyutai cuts before PCM reaches the player', async () => {
    streams.kyutai.mockResolvedValue(cutWavStream());
    streams.elevenlabs.mockResolvedValue(healthyWavStream());
    const phrase = 'Phrase courte intacte.';
    const speak = __voiceAudioPlayerTest.makeRoutedStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
      { CODEBUDDY_TTS_TWO_SPEED: 'true', CODEBUDDY_TTS_SHORT_MAX_CHARS: '80' },
    );

    await expect(speak!(phrase)).resolves.toBe(true);
    expect(streams.kyutai.mock.calls[0]?.[0]).toBe(phrase);
    expect(streams.elevenlabs.mock.calls[0]?.[0]).toBe(phrase);
    expect(streams.pocket).not.toHaveBeenCalled();
  });

  it('falls through to Pocket without changing the phrase', async () => {
    streams.kyutai.mockResolvedValue(null);
    streams.elevenlabs.mockResolvedValue(null);
    streams.pocket.mockResolvedValue(healthyWavStream());
    const phrase = 'Toujours la même phrase.';
    const speak = __voiceAudioPlayerTest.makeRoutedStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
      { CODEBUDDY_TTS_TWO_SPEED: 'true', CODEBUDDY_TTS_SHORT_MAX_CHARS: '80' },
    );

    await expect(speak!(phrase)).resolves.toBe(true);
    expect(streams.kyutai.mock.calls[0]?.[0]).toBe(phrase);
    expect(streams.elevenlabs.mock.calls[0]?.[0]).toBe(phrase);
    expect(streams.pocket.mock.calls[0]?.[0]).toBe(phrase);
  });

  it('sends a long continuation directly to ElevenLabs', async () => {
    streams.elevenlabs.mockResolvedValue(healthyWavStream());
    const phrase = 'Cette continuation est volontairement bien plus longue que le seuil.';
    const speak = __voiceAudioPlayerTest.makeRoutedStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'pocket',
      { CODEBUDDY_TTS_TWO_SPEED: 'true', CODEBUDDY_TTS_SHORT_MAX_CHARS: '20' },
    );

    await expect(speak!(phrase)).resolves.toBe(true);
    expect(streams.kyutai).not.toHaveBeenCalled();
    expect(streams.elevenlabs.mock.calls[0]?.[0]).toBe(phrase);
  });
});
