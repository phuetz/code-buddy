import { describe, expect, it, vi } from 'vitest';

import { AvatarEventBus } from '../../src/avatar/avatar-event-bus.js';
import {
  AvatarPlaybackStateMachine,
  planAvatarPerformance,
  splitAvatarAudioChunk,
  MAX_AVATAR_AUDIO_CHUNK_BYTES,
} from '../../src/avatar/avatar-protocol.js';

describe('avatar performance protocol', () => {
  it('maps emotional and deliberative turns to restrained performance cues', () => {
    const sadness = planAvatarPerformance('Je suis vraiment triste aujourd’hui.');
    const philosophy = planAvatarPerformance("Penses-tu qu'une IA peut aimer ?");

    expect(sadness.affect).toBe('concerned');
    expect(sadness.intensity).toBeGreaterThan(0.7);
    expect(philosophy.affect).toBe('thoughtful');
    expect(philosophy.gesture).toBe('thinking_glance');
    expect(philosophy.speakingStyle).toBe('deliberative');
  });

  it('keeps ordered lifecycle state and ignores a late completion after interruption', () => {
    const bus = new AvatarEventBus();
    const state = new AvatarPlaybackStateMachine();
    const cue = planAvatarPerformance('Explique-moi cette idée.');
    const turnId = 'turn-1';

    state.consume(bus.publish({ type: 'avatar.turn.started', turnId, cue }));
    state.consume(
      bus.publish({ type: 'avatar.speech.prepared', turnId, cue, text: 'Une réponse.' })
    );
    state.consume(bus.publish({ type: 'avatar.speech.started', turnId }));
    expect(state.snapshot().phase).toBe('speaking');

    state.consume(
      bus.publish({ type: 'avatar.speech.interrupted', turnId, reason: 'barge_in' })
    );
    state.consume(
      bus.publish({
        type: 'avatar.speech.completed',
        turnId,
        text: 'Une réponse.',
        durationMs: 100,
      })
    );
    expect(state.snapshot().phase).toBe('interrupted');

    state.consume(bus.publish({ type: 'avatar.turn.started', turnId: 'turn-2', cue }));
    expect(state.snapshot().phase).toBe('thinking');
    expect(state.snapshot().turnId).toBe('turn-2');
  });

  it('offers bounded replay for a newly connected renderer', () => {
    const bus = new AvatarEventBus(10);
    const cue = planAvatarPerformance('Bonjour.');
    bus.publish({ type: 'avatar.turn.started', turnId: 'turn-1', cue });
    bus.publish({ type: 'avatar.turn.silent', turnId: 'turn-1' });

    expect(bus.history()).toHaveLength(2);
    expect(bus.history(1)[0]?.type).toBe('avatar.turn.silent');
  });

  it('delivers audio chunks live without retaining their binary payload', () => {
    const bus = new AvatarEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    bus.publish({
      type: 'avatar.audio.chunk',
      turnId: 'turn-1',
      format: 'wav_stream',
      chunkIndex: 0,
      data: 'UklGRg==',
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(bus.history()).toEqual([]);
  });

  it('bounds raw audio chunks and preserves the exact byte sequence', () => {
    const input = Buffer.alloc(MAX_AVATAR_AUDIO_CHUNK_BYTES * 2 + 17, 7);
    const chunks = splitAvatarAudioChunk(input);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.byteLength <= MAX_AVATAR_AUDIO_CHUNK_BYTES)).toBe(true);
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))).toEqual(input);
  });

  it('reconnects idle and ignores the remainder of an audio-less active turn', () => {
    const bus = new AvatarEventBus();
    const state = new AvatarPlaybackStateMachine();
    const cue = planAvatarPerformance('Explique-moi.');
    const started = bus.publish({ type: 'avatar.turn.started', turnId: 'lost-turn', cue });
    expect(
      state.applySync({
        events: [],
        latestSequence: started.sequence,
        ignoredTurnIds: ['lost-turn'],
      }).phase
    ).toBe('idle');
    state.consume(bus.publish({ type: 'avatar.speech.started', turnId: 'lost-turn' }));
    expect(state.snapshot().phase).toBe('idle');
    state.consume(
      bus.publish({
        type: 'avatar.speech.completed',
        turnId: 'lost-turn',
        text: 'Perdue.',
        durationMs: 10,
      })
    );
    state.consume(bus.publish({ type: 'avatar.turn.started', turnId: 'next-turn', cue }));
    expect(state.snapshot()).toMatchObject({ phase: 'thinking', turnId: 'next-turn' });
  });

  it('joins streamed speech segments with a natural boundary', () => {
    const bus = new AvatarEventBus();
    const state = new AvatarPlaybackStateMachine();
    const cue = planAvatarPerformance('Continue.');
    state.consume(bus.publish({ type: 'avatar.turn.started', turnId: 'turn-space', cue }));
    state.consume(
      bus.publish({
        type: 'avatar.speech.segment',
        turnId: 'turn-space',
        text: 'Première phrase.',
        cue,
      })
    );
    state.consume(
      bus.publish({
        type: 'avatar.speech.segment',
        turnId: 'turn-space',
        text: 'Deuxième phrase.',
        cue,
      })
    );
    expect(state.snapshot().text).toBe('Première phrase. Deuxième phrase.');
  });
});
