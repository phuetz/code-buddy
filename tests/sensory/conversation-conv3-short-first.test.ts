import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';
import {
  buildShortFirstPrompt,
  makeVoiceReply,
  sensoryReplyMaxSentences,
  sensoryShortFirstEnabled,
} from '../../src/sensory/voice-loop.js';
import { _resetVoiceActivityForTests } from '../../src/sensory/voice-activity.js';

const STREAMED_SENTENCES = [
  'Voici déjà une réponse utile.',
  'La deuxième phrase apporte un détail.',
  'La troisième phrase complète le contexte.',
  'La quatrième phrase dépasse le plafond.',
  'La cinquième phrase ne doit pas être dite.',
  'La sixième phrase termine le faux flux.',
] as const;

const ENV_KEYS = [
  'CODEBUDDY_SENSORY_SHORT_FIRST',
  'CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES',
  'CODEBUDDY_VOICE_SPOKEN_PREFIX',
  'CODEBUDDY_SEMANTIC_GATE',
] as const;

function waitOneTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('CONV3 — short-first chitchat stream', () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'false';
    process.env.CODEBUDDY_SEMANTIC_GATE = 'false';
    delete process.env.CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES;
    _resetVoiceActivityForTests();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    _resetVoiceActivityForTests();
    vi.restoreAllMocks();
  });

  function createHarness(sentences: readonly string[] = STREAMED_SENTENCES) {
    let providerSentenceCount = 0;
    let providerCountAtFirstAudio: number | undefined;
    const spoken: string[] = [];
    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'Réponse bloquante inutilisée.',
      chitchatStream: async function* () {
        for (const sentence of sentences) {
          providerSentenceCount += 1;
          yield `${sentence} `;
          await waitOneTick();
        }
      },
      agentReply: async () => 'Réponse agent inutilisée.',
    });
    const voice = makeVoiceReply({
      replyFn: hybrid,
      streamSpeak: async (text, options) => {
        if (providerCountAtFirstAudio === undefined) {
          providerCountAtFirstAudio = providerSentenceCount;
        }
        spoken.push(text);
        options?.onFirstAudio?.();
        return true;
      },
      synth: async () => '',
      play: async () => undefined,
      cameraShare: async () => null,
      visualGrounding: async () => ({ status: 'unavailable', response: '' }),
      avatarEnabled: false,
    });
    return {
      voice,
      spoken,
      firstAudioProviderCount: () => providerCountAtFirstAudio,
    };
  }

  it('keeps the feature opt-in and asks for one useful sentence before at most three total', () => {
    expect(sensoryShortFirstEnabled({})).toBe(false);
    expect(sensoryShortFirstEnabled({ CODEBUDDY_SENSORY_SHORT_FIRST: 'true' })).toBe(true);
    expect(sensoryReplyMaxSentences({})).toBe(3);
    expect(sensoryReplyMaxSentences({ CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES: '' })).toBe(3);
    expect(sensoryReplyMaxSentences({ CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES: '2' })).toBe(2);

    const prompt = buildShortFirstPrompt({ maxSentences: 3 });
    expect(prompt).toContain("Une phrase d'abord, puis développe si utile.");
    expect(prompt).toContain('au plus 20 mots');
    expect(prompt).toContain('Ne dépasse pas 3 phrases au total');
  });

  it('plays the first useful sentence as soon as the first stable segment arrives and caps the continuation', async () => {
    process.env.CODEBUDDY_SENSORY_SHORT_FIRST = 'true';
    const logs: string[] = [];
    vi.spyOn(logger, 'info').mockImplementation((message) => {
      logs.push(String(message));
    });
    const harness = createHarness();

    await harness.voice('Lisa, raconte-moi quelque chose de simple.');

    expect(harness.firstAudioProviderCount()).toBe(1);
    expect(harness.spoken).toEqual(STREAMED_SENTENCES.slice(0, 3));
    expect(harness.spoken[0]?.trim().split(/\s+/u)).toHaveLength(5);
    expect(logs).toContainEqual(
      expect.stringMatching(/^\[voice] short-first: firstContentMs=\d+, sentences=3$/),
    );
  });

  it('splits a provider first sentence after at most twenty words', async () => {
    process.env.CODEBUDDY_SENSORY_SHORT_FIRST = 'true';
    process.env.CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES = '2';
    const longFirst =
      'Cette réponse contient volontairement beaucoup de mots afin de vérifier que la première unité audible reste vraiment courte même si le fournisseur ignore la consigne.';
    const harness = createHarness([longFirst, 'La suite arrive ensuite.']);

    await harness.voice('Donne-moi une explication simple.');

    expect(harness.firstAudioProviderCount()).toBe(1);
    expect(harness.spoken).toHaveLength(2);
    expect(harness.spoken[0]?.trim().split(/\s+/u).length).toBeLessThanOrEqual(20);
    expect(harness.spoken.join(' ')).toContain('fournisseur ignore la consigne.');
  });

  it('stops the continuation cleanly on the first barge-in', async () => {
    process.env.CODEBUDDY_SENSORY_SHORT_FIRST = 'true';
    let markSecondAudioStarted!: () => void;
    const secondAudioStarted = new Promise<void>((resolve) => {
      markSecondAudioStarted = resolve;
    });
    const spoken: string[] = [];
    const completed: string[] = [];
    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'Réponse bloquante inutilisée.',
      chitchatStream: async function* () {
        for (const sentence of STREAMED_SENTENCES) {
          yield `${sentence} `;
          await waitOneTick();
        }
      },
      agentReply: async () => 'Réponse agent inutilisée.',
    });
    const voice = makeVoiceReply({
      replyFn: hybrid,
      streamSpeak: async (text, options) => {
        spoken.push(text);
        options?.onFirstAudio?.();
        if (spoken.length === 1) {
          completed.push(text);
          return true;
        }
        markSecondAudioStarted();
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) return resolve();
          options?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return false;
      },
      synth: async () => '',
      play: async () => undefined,
      cameraShare: async () => null,
      visualGrounding: async () => ({ status: 'unavailable', response: '' }),
      avatarEnabled: false,
    });

    const turn = voice('Lisa, raconte-moi quelque chose de simple.');
    await secondAudioStarted;
    voice.interrupt();
    await turn;

    expect(spoken).toHaveLength(2);
    expect(spoken[0]).toContain('réponse utile.');
    expect(spoken[1]).toBe(STREAMED_SENTENCES[1]);
    expect(completed).toEqual([spoken[0]!]);
  });

  it('keeps a post-stream semantic correction inside the configured total cap', async () => {
    process.env.CODEBUDDY_SENSORY_SHORT_FIRST = 'true';
    process.env.CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES = '1';
    const semanticReview = vi.fn(async () => ({
      response: 'Une correction sémantique ne doit pas dépasser le plafond.',
      outcome: 'revised' as const,
      reason: 'revision_completed' as const,
      revisionAttempts: 1 as const,
    }));
    const spoken: string[] = [];
    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'Réponse bloquante inutilisée.',
      chitchatStream: async function* () {
        yield 'La première réponse suffit. Une suite serait déjà en trop.';
      },
      agentReply: async () => 'Réponse agent inutilisée.',
      semanticReview,
    });
    const voice = makeVoiceReply({
      replyFn: hybrid,
      streamSpeak: async (text, options) => {
        spoken.push(text);
        options?.onFirstAudio?.();
        return true;
      },
      synth: async () => '',
      play: async () => undefined,
      cameraShare: async () => null,
      visualGrounding: async () => ({ status: 'unavailable', response: '' }),
      avatarEnabled: false,
    });

    await voice("Pourquoi cette réponse mérite-t-elle d'être nuancée ?");

    expect(spoken).toHaveLength(1);
    expect(semanticReview).not.toHaveBeenCalled();
  });

  it('preserves the previous look-ahead and all six phrases when the opt-in is absent', async () => {
    delete process.env.CODEBUDDY_SENSORY_SHORT_FIRST;
    const defaultSentences = [
      'Une réponse ordinaire commence ici.',
      ...STREAMED_SENTENCES.slice(1),
    ];
    const logs: string[] = [];
    vi.spyOn(logger, 'info').mockImplementation((message) => {
      logs.push(String(message));
    });
    const harness = createHarness(defaultSentences);

    await harness.voice('Lisa, raconte-moi quelque chose de simple.');

    expect(harness.firstAudioProviderCount()).toBe(2);
    expect(harness.spoken).toEqual(defaultSentences);
    expect(logs.some((line) => line.startsWith('[voice] short-first:'))).toBe(false);
  });
});
