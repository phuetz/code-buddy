import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

function cutWavStreamWithAudioPlayed(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(pcm16Mono24kStreamWavHeader());
      // 9 600 octets = 200 ms d'audio PCM 24kHz déjà émis et consommés par aplay
      controller.enqueue(new Uint8Array(Buffer.alloc(9_600, 1)));
      // Le serveur tronque proprement le corps ; le lecteur signale ensuite
      // l'échec du premier flux avec un code non nul.
      controller.close();
    },
  });
}

function healthyWavStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(pcm16Mono24kStreamWavHeader());
      controller.enqueue(new Uint8Array(Buffer.alloc(4_800, 2)));
      controller.close();
    },
  });
}

describe('Mission SENSE6 — Trou 6 : Repli Kyutai -> ElevenLabs rejouant une phrase déjà partiellement dite', () => {
  const bytesSentToPlayer: number[] = [];
  const savedStreamHeadMs = process.env.CODEBUDDY_TTS_STREAM_HEAD_MS;

  beforeEach(() => {
    bytesSentToPlayer.length = 0;
    let playerIndex = 0;
    playerHarness.spawn.mockImplementation(() => {
      const currentPlayer = playerIndex++;
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        kill: () => boolean;
      };
      const stdin = new PassThrough();
      stdin.on('data', (chunk: Buffer) => {
        bytesSentToPlayer.push(chunk.length);
      });
      child.stdin = stdin;
      child.kill = () => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      };
      child.stdin.once('finish', () => {
        queueMicrotask(() => child.emit('close', currentPlayer === 0 ? 1 : 0));
      });
      return child;
    });
    cache.lookup.mockReset();
    cache.lookup.mockReturnValue(null);
    cache.store.mockReset();
    streams.kyutai.mockReset();
    streams.elevenlabs.mockReset();
    streams.pocket.mockReset();
    // La fixture diffuse 200 ms : une tête de 50 ms garantit qu'ils atteignent
    // réellement le lecteur avant la coupure synchrone du flux.
    process.env.CODEBUDDY_TTS_STREAM_HEAD_MS = '50';
  });

  afterEach(() => {
    if (savedStreamHeadMs === undefined) delete process.env.CODEBUDDY_TTS_STREAM_HEAD_MS;
    else process.env.CODEBUDDY_TTS_STREAM_HEAD_MS = savedStreamHeadMs;
    vi.restoreAllMocks();
  });

  it('ne doit pas renvoyer et faire rejouer l\'intégralité de la phrase à ElevenLabs si Kyutai a déjà diffusé de l\'audio', async () => {
    // Kyutai commence à parler et coupe au milieu (des octets ont été envoyés au player)
    streams.kyutai.mockResolvedValue(cutWavStreamWithAudioPlayed());
    let localBytesBeforeFallback = 0;
    streams.elevenlabs.mockImplementation(async () => {
      localBytesBeforeFallback = bytesSentToPlayer.reduce((total, bytes) => total + bytes, 0);
      return healthyWavStream();
    });

    const phrase = 'Bonjour Patrice, je commence à t expliquer le plan pour aujourd hui.';

    const speak = __voiceAudioPlayerTest.makeRoutedStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
      { CODEBUDDY_TTS_TWO_SPEED: 'true', CODEBUDDY_TTS_SHORT_MAX_CHARS: '80' },
    );

    const progress: Array<{ pcmBytes: number; byteRate: number }> = [];
    await speak!(phrase, { onAudioProgress: (value) => progress.push(value) });

    expect(progress).not.toEqual([]);
    expect(localBytesBeforeFallback).toBeGreaterThan(44);

    // GARANTIE DE QUALITÉ / EXPÉRIENCE UTILISATEUR ATTENDUE :
    // Si l'utilisateur a déjà entendu le début de la phrase via Kyutai,
    // le repli ne doit pas faire rejouer la phrase complète depuis le mot 0 sur ElevenLabs (effet bègue / perroquet).
    //
    // TROU PROUVÉ :
    // Dans voice-loop.ts (lignes 3014-3017) :
    // if (await local?.(text, opts)) return true;
    // ...
    // if (await cloud?.(text, opts)) return true;
    // Le texte intégral "phrase" est réinjecté sans troncation à ElevenLabs après l'échec de Kyutai,
    // alors que des paquets audio ont déjà été transmis au player !
    // Le premier segment lexical déjà engagé n'est pas rejoué ; ElevenLabs
    // reprend à la frontière suivante.
    expect(streams.elevenlabs.mock.calls[0]?.[0]).toBe(
      'Patrice, je commence à t expliquer le plan pour aujourd hui.',
    );
  });
});
