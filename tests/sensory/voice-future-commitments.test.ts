import { describe, expect, it, vi } from 'vitest';
import { makeVoiceReply } from '../../src/sensory/voice-loop.js';

describe('voice future commitment gate', () => {
  it('guards the text before synthesis and does not release an unguarded stream', async () => {
    const streamed = vi.fn(async function* () {
      yield 'Je vais surveiller ce traitement.';
    });
    const synthesized: string[] = [];
    const spoken: string[] = [];
    const onHeard = makeVoiceReply({
      env: { CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'true' },
      streamFn: streamed,
      replyFn: async () => 'Je vais surveiller ce traitement.',
      synth: async (text) => { synthesized.push(text); return '/tmp/future-commitment.wav'; },
      play: async () => {},
      onSpoke: (text) => { spoken.push(text); },
    });
    await onHeard('Bonjour, où en est le robot ?');
    expect(streamed).not.toHaveBeenCalled();
    expect(synthesized).toEqual(['Je ne surveille pas cela pour le moment.']);
    expect(spoken).toEqual(['Je ne surveille pas cela pour le moment.']);
  });

  it('guards a later semantic correction before it is spoken', async () => {
    const synthesized: string[] = [];
    const onHeard = makeVoiceReply({
      env: { CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'true' },
      replyFn: async (_heard, options) => {
        options?.onSemanticCorrection?.(Promise.resolve('Je te préviens quand le build finit.'));
        return 'Le build est en cours.';
      },
      synth: async (text) => { synthesized.push(text); return '/tmp/future-correction.wav'; },
      play: async () => {},
    });
    await onHeard('Bonjour, où en est le robot ?');
    expect(synthesized).toEqual([
      'Le build est en cours.',
      "Je n'ai pas de suivi programmé pour te prévenir plus tard.",
    ]);
  });
});
