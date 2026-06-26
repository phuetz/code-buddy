import { describe, it, expect, afterEach } from 'vitest';
import {
  makeVoiceReply,
  describeVoiceReadiness,
  resolveVoiceModel,
  resetVoiceModelCache,
  sayNow,
} from '../../src/sensory/voice-loop.js';

describe('voice loop — readiness (fail-loud prereqs)', () => {
  it('is not speak-ready and warns about the voice when none is configured', () => {
    const r = describeVoiceReadiness({});
    expect(r.speakReady).toBe(false);
    expect(r.voice).toBeUndefined();
    // No pinned model → the reply model is latency-routed at call time.
    expect(r.routed).toBe(true);
    expect(r.model).toBe('auto');
    expect(r.warnings.some((w) => w.includes('CODEBUDDY_TTS_VOICE'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('latency-routed'))).toBe(true);
  });

  it('is speak-ready and pins the model when a voice and model are configured', () => {
    const r = describeVoiceReadiness({
      CODEBUDDY_TTS_VOICE: '/voices/fr.onnx',
      CODEBUDDY_SENSORY_SPEAK_MODEL: 'qwen2.5:7b-instruct',
    });
    expect(r.speakReady).toBe(true);
    expect(r.voice).toBe('/voices/fr.onnx');
    expect(r.routed).toBe(false);
    expect(r.model).toBe('qwen2.5:7b-instruct');
    expect(r.warnings.some((w) => w.includes('HEAR but stay SILENT'))).toBe(false);
  });

  it('treats CODEBUDDY_SENSORY_SPEAK_MODEL=auto as routed', () => {
    const r = describeVoiceReadiness({ CODEBUDDY_SENSORY_SPEAK_MODEL: 'auto' });
    expect(r.routed).toBe(true);
    expect(r.model).toBe('auto');
  });
});

describe('voice loop — model resolution (env authoritative)', () => {
  const SAVED = {
    model: process.env.CODEBUDDY_SENSORY_SPEAK_MODEL,
    base: process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL,
    key: process.env.OLLAMA_API_KEY,
  };
  afterEach(() => {
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = SAVED.model;
    process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL = SAVED.base;
    process.env.OLLAMA_API_KEY = SAVED.key;
    if (SAVED.model === undefined) delete process.env.CODEBUDDY_SENSORY_SPEAK_MODEL;
    if (SAVED.base === undefined) delete process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL;
    if (SAVED.key === undefined) delete process.env.OLLAMA_API_KEY;
    resetVoiceModelCache();
  });

  it('pins the model from CODEBUDDY_SENSORY_SPEAK_MODEL (no routing)', async () => {
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = 'mistral-small:24b';
    process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL = 'http://localhost:9999/v1';
    process.env.OLLAMA_API_KEY = 'secret';
    const r = await resolveVoiceModel('Bonjour');
    expect(r.model).toBe('mistral-small:24b');
    expect(r.baseURL).toBe('http://localhost:9999/v1');
    expect(r.apiKey).toBe('secret');
    expect(r.reason).toContain('pinned');
  });
});

describe('sayNow — proactive speech (reminders/announcements)', () => {
  it('synthesizes then plays (in order)', async () => {
    const calls: string[] = [];
    await sayNow('bonjour', {
      synth: async (t) => {
        calls.push(`synth:${t}`);
        return '/tmp/none.wav';
      },
      play: async (w) => {
        calls.push(`play:${w}`);
      },
    });
    expect(calls).toEqual(['synth:bonjour', 'play:/tmp/none.wav']);
  });

  it('stays silent on empty text (no synth, no play)', async () => {
    let synthed = 0;
    await sayNow('   ', {
      synth: async () => {
        synthed += 1;
        return '/tmp/none.wav';
      },
      play: async () => {},
    });
    expect(synthed).toBe(0);
  });

  it('never throws when synthesis fails', async () => {
    await expect(
      sayNow('x', {
        synth: async () => {
          throw new Error('piper down');
        },
        play: async () => {},
      }),
    ).resolves.toBeUndefined();
  });
});

describe('voice loop — heard → think → speak', () => {
  it('thinks a reply, synthesizes it, and plays the synthesized wav', async () => {
    const calls: string[] = [];
    let spoke = '';
    const onHeard = makeVoiceReply({
      replyFn: async (heard) => {
        calls.push(`reply:${heard}`);
        return 'Salut Patrice, on progresse.';
      },
      synth: async (text) => {
        calls.push(`synth:${text}`);
        return '/tmp/reply.wav';
      },
      play: async (wav) => {
        calls.push(`play:${wav}`);
      },
      onSpoke: (t) => {
        spoke = t;
      },
    });

    await onHeard('Bonjour, où en est le robot ?');

    expect(calls).toEqual([
      'reply:Bonjour, où en est le robot ?',
      'synth:Salut Patrice, on progresse.',
      'play:/tmp/reply.wav',
    ]);
    expect(spoke).toBe('Salut Patrice, on progresse.');
  });

  it('stays silent (no synth, no play) when the reply is empty', async () => {
    let synthCalls = 0;
    let playCalls = 0;
    const onHeard = makeVoiceReply({
      replyFn: async () => '   ', // whitespace → nothing to say
      synth: async () => {
        synthCalls += 1;
        return '/tmp/x.wav';
      },
      play: async () => {
        playCalls += 1;
      },
    });

    await onHeard('mmh');

    expect(synthCalls).toBe(0);
    expect(playCalls).toBe(0);
  });

  it('never throws when synth fails, and does not play', async () => {
    let playCalls = 0;
    const onHeard = makeVoiceReply({
      replyFn: async () => 'something',
      synth: async () => {
        throw new Error('piper not installed');
      },
      play: async () => {
        playCalls += 1;
      },
    });

    await expect(onHeard('hello')).resolves.toBeUndefined();
    expect(playCalls).toBe(0);
  });

  it('never throws when the think step fails', async () => {
    const onHeard = makeVoiceReply({
      replyFn: async () => {
        throw new Error('ollama down');
      },
      synth: async () => '/tmp/x.wav',
      play: async () => {},
    });

    await expect(onHeard('hello')).resolves.toBeUndefined();
  });
});
