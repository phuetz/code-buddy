import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_AVATAR_AUDIO_CHUNK_BYTES,
  type AvatarEvent,
} from '../../src/avatar/avatar-protocol.js';
import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';
import { makeVoiceReply } from '../../src/sensory/voice-loop.js';

describe('voice to avatar lifecycle', () => {
  it('publishes prepared, real playback start and completion without exposing heard text', async () => {
    const events: AvatarEvent[] = [];
    const heard = 'MARQUEUR_UTILISATEUR_PRIVE';
    const handler = makeVoiceReply({
      replyFn: async () => 'Voici une réponse construite.',
      synth: async () => '/tmp/avatar-voice-test.wav',
      play: async () => undefined,
      onAvatarEvent: (event) => events.push(event),
    });

    await handler(heard);

    expect(events.map((event) => event.type)).toEqual([
      'avatar.turn.started',
      'avatar.speech.prepared',
      'avatar.speech.started',
      'avatar.speech.completed',
    ]);
    expect(JSON.stringify(events[0])).not.toContain(heard);
    expect(JSON.stringify(events)).toContain('Voici une réponse construite.');
    expect(events.every((event) => event.turnId === events[0]?.turnId)).toBe(true);
  });

  it('ends the avatar performance immediately when speech is interrupted', async () => {
    const events: AvatarEvent[] = [];
    let playbackStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      playbackStarted = resolve;
    });
    const handler = makeVoiceReply({
      replyFn: async () => 'Une réponse qui sera interrompue.',
      synth: async () => '/tmp/avatar-voice-interrupt.wav',
      play: async (_wav, options) =>
        new Promise<void>((resolve) => {
          playbackStarted();
          options?.signal?.addEventListener('abort', () => resolve(), { once: true });
        }),
      onAvatarEvent: (event) => events.push(event),
    });

    const pending = handler('Commence à parler.');
    await started;
    handler.interrupt();
    await pending;

    expect(events.map((event) => event.type)).toContain('avatar.speech.interrupted');
    expect(events.map((event) => event.type)).not.toContain('avatar.speech.completed');
  });

  it('describes and bounds a buffered WAV so MetaHuman can reconstruct it exactly', async () => {
    const previous = process.env.CODEBUDDY_AVATAR_STREAM_AUDIO;
    process.env.CODEBUDDY_AVATAR_STREAM_AUDIO = 'true';
    const dir = mkdtempSync(join(tmpdir(), 'avatar-wav-'));
    const wavPath = join(dir, 'speech.wav');
    const wav = Buffer.alloc(MAX_AVATAR_AUDIO_CHUNK_BYTES * 2 + 31, 9);
    writeFileSync(wavPath, wav);
    const events: AvatarEvent[] = [];
    try {
      const handler = makeVoiceReply({
        replyFn: async () => 'Audio borné.',
        synth: async () => wavPath,
        play: async () => undefined,
        onAvatarEvent: (event) => events.push(event),
      });
      await handler('Parle maintenant.');

      const audioStarted = events.find((event) => event.type === 'avatar.audio.started');
      const chunks = events.filter(
        (event): event is Extract<AvatarEvent, { type: 'avatar.audio.chunk' }> =>
          event.type === 'avatar.audio.chunk'
      );
      const audioEnded = events.find((event) => event.type === 'avatar.audio.ended');
      expect(audioStarted).toMatchObject({ source: 'buffered', encoding: 'base64' });
      expect(chunks).toHaveLength(3);
      expect(chunks.every((chunk) => (chunk.byteLength ?? 0) <= MAX_AVATAR_AUDIO_CHUNK_BYTES))
        .toBe(true);
      expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data, 'base64')))).toEqual(wav);
      expect(audioEnded).toMatchObject({
        totalBytes: wav.byteLength,
        chunks: 3,
        outcome: 'complete',
      });
      expect(events.indexOf(audioEnded!)).toBeLessThan(
        events.findIndex((event) => event.type === 'avatar.speech.started')
      );
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_AVATAR_STREAM_AUDIO;
      else process.env.CODEBUDDY_AVATAR_STREAM_AUDIO = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('streams a prefetched multi-segment answer to one coherent avatar turn', async () => {
    const previous = process.env.CODEBUDDY_AVATAR_STREAM_AUDIO;
    process.env.CODEBUDDY_AVATAR_STREAM_AUDIO = 'true';
    const events: AvatarEvent[] = [];
    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => 'Première actualité. Deuxième actualité.',
      jokes: () => null,
      classify: () => true,
      chitchat: async () => '',
      // eslint-disable-next-line require-yield -- prefetch must bypass the model stream
      chitchatStream: async function* () {},
      agentReply: async () => '',
    });
    try {
      const handler = makeVoiceReply({
        replyFn: hybrid,
        streamSpeak: async (_text, options) => {
          options?.onAudioChunk?.(new Uint8Array(56));
          options?.onFirstAudio?.();
          return true;
        },
        synth: async () => '',
        play: async () => undefined,
        onAvatarEvent: (event) => events.push(event),
      });

      await handler("quelles sont les actualités aujourd'hui ?");

      const eventTypes = events.map((event) => event.type);
      expect(eventTypes.filter((type) => type === 'avatar.speech.segment')).toHaveLength(2);
      expect(eventTypes.filter((type) => type === 'avatar.audio.started')).toHaveLength(2);
      expect(eventTypes.filter((type) => type === 'avatar.audio.ended')).toHaveLength(2);
      expect(eventTypes.filter((type) => type === 'avatar.speech.started')).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({
        type: 'avatar.speech.completed',
        text: 'Première actualité. Deuxième actualité.',
      });
      expect(new Set(events.map((event) => event.turnId)).size).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_AVATAR_STREAM_AUDIO;
      else process.env.CODEBUDDY_AVATAR_STREAM_AUDIO = previous;
    }
  });
});
