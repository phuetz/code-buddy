import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';
import { makeVoiceReply, type TwoSpeedTtsRouteHint } from '../../src/sensory/voice-loop.js';
import { selectTwoSpeedTtsRoute } from '../../src/voice/two-speed-voice.js';
import { _resetVoiceActivityForTests } from '../../src/sensory/voice-activity.js';

describe('DARK3 two-speed routing metadata', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CODEBUDDY_TTS_TWO_SPEED = 'true';
    process.env.CODEBUDDY_TTS_SHORT_MAX_CHARS = '20';
    process.env.CODEBUDDY_SENSORY_SHORT_FIRST = 'true';
    process.env.CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES = '2';
    process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'false';
    process.env.CODEBUDDY_SEMANTIC_GATE = 'false';
    _resetVoiceActivityForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetVoiceActivityForTests();
  });

  it('marks only the first useful CONV3 sentence for the forced local route', async () => {
    const segments: Array<{ text: string; hint?: TwoSpeedTtsRouteHint }> = [];
    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'Réponse bloquante inutilisée.',
      chitchatStream: async function* () {
        yield 'Première phrase autonome volontairement supérieure au seuil. ';
        yield 'La continuation reste également longue et doit prendre la voix A.';
      },
      agentReply: async () => 'Réponse agent inutilisée.',
    });
    const voice = makeVoiceReply({
      replyFn: hybrid,
      streamSpeak: async (text, options) => {
        segments.push({
          text,
          ...(options?.ttsRouteHint ? { hint: options.ttsRouteHint } : {}),
        });
        options?.onFirstAudio?.();
        return true;
      },
      synth: async () => '',
      play: async () => undefined,
      cameraShare: async () => null,
      visualGrounding: async () => ({ status: 'unavailable', response: '' }),
      avatarEnabled: false,
    });

    await voice('Lisa, réponds en deux phrases.');

    expect(segments).toHaveLength(2);
    expect(segments[0]?.hint).toBe('conv3-first');
    expect(segments[1]?.hint).toBeUndefined();
    expect(selectTwoSpeedTtsRoute(
      segments[0]!.text,
      process.env,
      segments[0]!.hint,
    ).route).toBe('local');
    expect(selectTwoSpeedTtsRoute(segments[1]!.text, process.env).route).toBe('elevenlabs');
  });
});
