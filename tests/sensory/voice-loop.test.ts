import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  makeVoiceReply,
  describeVoiceReadiness,
  DEFAULT_TTS_PREWARM_PHRASES,
  fastCompanionReply,
  getDefaultVoicePrewarmPhrases,
  isFactualVoiceQuestion,
  resolveVoiceModel,
  codexOAuthVoiceRoute,
  resetVoiceModelCache,
  prewarmVoiceModel,
  prewarmVoiceRuntime,
  sayNow,
  buildSpokenPromptAugmentation,
  lookupInstantBackchannelWav,
  immediateThinkingAcknowledgement,
  isRemoteVoiceRoute,
  rewriteRepeatedVoiceOpener,
  resolveResidentVoicePermissionMode,
} from '../../src/sensory/voice-loop.js';
import {
  getCrossChannelConversationBridge,
  resetCrossChannelConversationBridge,
} from '../../src/conversation/cross-channel-bridge.js';

describe('voice loop — readiness (fail-loud prereqs)', () => {
  it('uses Pocket/Estelle as the speak-ready default', () => {
    const r = describeVoiceReadiness({});
    expect(r.ttsEngine).toBe('pocket');
    expect(r.speakReady).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.voice).toBe('estelle');
    // No pinned model → the reply model is latency-routed at call time.
    expect(r.routed).toBe(true);
    expect(r.model).toBe('auto');
    expect(r.warnings.some((w) => w.includes('CODEBUDDY_TTS_VOICE'))).toBe(false);
    expect(r.warnings.some((w) => w.includes('latency-routed'))).toBe(true);
  });

  it('warns only when legacy Piper is explicitly selected without a model', () => {
    const r = describeVoiceReadiness({ CODEBUDDY_TTS_ENGINE: 'piper' });
    expect(r.ttsEngine).toBe('piper');
    expect(r.speakReady).toBe(false);
    expect(r.warnings.some((w) => w.includes('CODEBUDDY_TTS_VOICE'))).toBe(true);
  });

  it('requires a Voicebox profile and surfaces it as the selected voice', () => {
    const missing = describeVoiceReadiness({ CODEBUDDY_TTS_ENGINE: 'voicebox' });
    expect(missing.ttsEngine).toBe('voicebox');
    expect(missing.speakReady).toBe(false);
    expect(missing.warnings.some((warning) => warning.includes('CODEBUDDY_VOICEBOX_PROFILE')))
      .toBe(true);

    const ready = describeVoiceReadiness({
      CODEBUDDY_TTS_ENGINE: 'voicebox',
      CODEBUDDY_VOICEBOX_PROFILE: 'Lisa',
    });
    expect(ready.ttsEngine).toBe('voicebox');
    expect(ready.voice).toBe('Lisa');
    expect(ready.speakReady).toBe(true);
  });

  it('is speak-ready and pins the model when a voice and model are configured', () => {
    const r = describeVoiceReadiness({
      CODEBUDDY_TTS_ENGINE: 'piper',
      CODEBUDDY_TTS_VOICE: '/voices/fr.onnx',
      CODEBUDDY_SENSORY_SPEAK_MODEL: 'qwen2.5:7b-instruct',
    });
    expect(r.speakReady).toBe(true);
    expect(r.ttsEngine).toBe('piper');
    expect(r.voice).toBe('/voices/fr.onnx');
    expect(r.routed).toBe(false);
    expect(r.model).toBe('qwen2.5:7b-instruct');
    expect(r.warnings.some((w) => w.includes('HEAR but stay SILENT'))).toBe(false);
  });

  it('names the distinct fast and deliberative voice brains when both are pinned', () => {
    const ready = describeVoiceReadiness({
      CODEBUDDY_SENSORY_SPEAK_MODEL: 'qwen3:4b-instruct',
      CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL: 'gpt-5.5',
    });
    expect(ready.warnings).toContainEqual(
      expect.stringContaining("Fast voice lane uses pinned model 'qwen3:4b-instruct'"),
    );
    expect(ready.warnings).toContainEqual(
      expect.stringContaining("deliberative turns use 'gpt-5.5'"),
    );
  });

  it('treats CODEBUDDY_SENSORY_SPEAK_MODEL=auto as routed', () => {
    const r = describeVoiceReadiness({ CODEBUDDY_SENSORY_SPEAK_MODEL: 'auto' });
    expect(r.routed).toBe(true);
    expect(r.model).toBe('auto');
  });

  it('migrates the legacy resident plan posture without escalating autonomous modes', () => {
    expect(resolveResidentVoicePermissionMode({})).toBe('default');
    expect(
      resolveResidentVoicePermissionMode({ CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'plan' })
    ).toBe('default');
    expect(
      resolveResidentVoicePermissionMode({ CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'dontAsk' })
    ).toBe('dontAsk');
    expect(
      resolveResidentVoicePermissionMode({
        CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'bypassPermissions',
      })
    ).toBe('bypassPermissions');
    expect(
      resolveResidentVoicePermissionMode({ CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'unknown' })
    ).toBe('default');
  });

  it('reports the migrated posture for an always-on assistant configured with legacy plan', () => {
    const r = describeVoiceReadiness({
      CODEBUDDY_SENSORY_SPEAK_ACT: 'true',
      CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'plan',
    });
    expect(r.permissionMode).toBe('default');
    expect(r.warnings.some((warning) => warning.includes("Legacy resident voice posture 'plan'")))
      .toBe(true);
    expect(r.warnings.some((warning) => warning.includes("scoped 'default' posture"))).toBe(true);
  });

  it('marks the unresolved fallback model route as degraded', () => {
    const readiness = describeVoiceReadiness({}, { reason: 'fallback default' });
    expect(readiness.modelReady).toBe(false);
    expect(readiness.ready).toBe(false);
  });
});

describe('voice loop — instant backchannel cache', () => {
  it('uses the Pocket voice-specific cache for a prewarmed acknowledgement', async () => {
    const calls: Array<[string, string]> = [];
    const hit = await lookupInstantBackchannelWav(
      'Alors…',
      { CODEBUDDY_POCKET_VOICE: 'estelle' },
      (text, voice) => {
        calls.push([text, voice]);
        return '/tmp/alors.wav';
      },
    );
    expect(hit).toBe('/tmp/alors.wav');
    expect(calls).toEqual([
      ['Alors…', 'pocket:estelle:language=french_24l:quantize=false'],
    ]);
  });

  it('looks up an instant acknowledgement under the locked Voicebox identity', async () => {
    const voices: string[] = [];
    await lookupInstantBackchannelWav(
      'Alors…',
      {
        CODEBUDDY_TTS_ENGINE: 'voicebox',
        CODEBUDDY_VOICEBOX_PROFILE: 'Lisa',
        CODEBUDDY_VOICEBOX_LANGUAGE: 'fr',
      },
      (_text, voice) => {
        voices.push(voice);
        return '/tmp/alors-voicebox.wav';
      },
    );

    expect(voices).toHaveLength(1);
    expect(voices[0]).toContain('voicebox:');
    expect(voices[0]).toContain(':Lisa:');
    expect(voices[0]).not.toContain('pocket:');
  });

  it('does not consult the cache for generated answer text or when disabled', async () => {
    let calls = 0;
    const lookup = () => {
      calls += 1;
      return '/tmp/unexpected.wav';
    };
    expect(await lookupInstantBackchannelWav('Le ciel est bleu.', {}, lookup)).toBeNull();
    expect(await lookupInstantBackchannelWav('Alors…', { CODEBUDDY_TTS_CACHE: 'false' }, lookup)).toBeNull();
    expect(calls).toBe(0);
  });

  it('separates Pocket cache entries by quantization and language', async () => {
    const voices: string[] = [];
    const lookup = (_text: string, voice: string): string => {
      voices.push(voice);
      return '/tmp/cache.wav';
    };

    await lookupInstantBackchannelWav(
      'Alors…',
      { CODEBUDDY_POCKET_LANG: 'fr', CODEBUDDY_POCKET_QUANTIZE: 'false' },
      lookup,
    );
    await lookupInstantBackchannelWav(
      'Alors…',
      { CODEBUDDY_POCKET_LANG: 'fr', CODEBUDDY_POCKET_QUANTIZE: 'true' },
      lookup,
    );
    await lookupInstantBackchannelWav(
      'Alors…',
      { CODEBUDDY_POCKET_LANG: 'english', CODEBUDDY_POCKET_QUANTIZE: 'true' },
      lookup,
    );

    expect(new Set(voices).size).toBe(3);
    expect(voices[0]).toContain('language=french_24l:quantize=false');
    expect(voices[1]).toContain('language=french_24l:quantize=true');
    expect(voices[2]).toContain('language=english:quantize=true');
  });
});

describe('voice loop — adaptive latency buffers', () => {
  const question = 'Pourquoi le ciel est-il bleu ?';

  it('recognizes remote routes without treating loopback or invalid URLs as cloud', () => {
    expect(isRemoteVoiceRoute('https://chatgpt.com/backend-api/codex')).toBe(true);
    expect(isRemoteVoiceRoute('http://127.0.0.1:11434/v1')).toBe(false);
    expect(isRemoteVoiceRoute('http://localhost:11434/v1')).toBe(false);
    expect(isRemoteVoiceRoute('http://[::1]:11434/v1')).toBe(false);
    expect(isRemoteVoiceRoute('not a URL')).toBe(false);
  });

  it('enables backchannels by default only for remote routes', () => {
    expect(immediateThinkingAcknowledgement(
      question,
      {},
      'https://chatgpt.com/backend-api/codex',
    )).not.toBeNull();
    expect(immediateThinkingAcknowledgement(
      question,
      {},
      'http://127.0.0.1:11434/v1',
    )).toBeNull();
  });

  it('keeps explicit backchannel overrides authoritative on either route', () => {
    expect(immediateThinkingAcknowledgement(
      question,
      { CODEBUDDY_VOICE_BACKCHANNEL: 'false' },
      'https://chatgpt.com/backend-api/codex',
    )).toBeNull();
    expect(immediateThinkingAcknowledgement(
      question,
      { CODEBUDDY_VOICE_BACKCHANNEL: 'true' },
      'http://127.0.0.1:11434/v1',
    )).not.toBeNull();
  });
});

describe('voice loop — hard opener variation', () => {
  it('rewrites a matching recent opener deterministically', () => {
    expect(rewriteRepeatedVoiceOpener(
      'Alors, regardons les faits.',
      ['alors regardons les faits'],
    )).toBe('Voyons, regardons les faits.');
  });

  it('rewrites a repeated generated opener before synthesis', async () => {
    const synthesized: string[] = [];
    const onHeard = makeVoiceReply({
      replyFn: async () => 'Alors, cette ouverture ne doit pas se répéter.',
      synth: async (text) => {
        synthesized.push(text);
        return '/tmp/repeated-opener.wav';
      },
      play: async () => {},
    });

    await onHeard('Première question.');
    await onHeard('Deuxième question.');

    expect(synthesized).toHaveLength(2);
    expect(synthesized[0]).toBe('Alors, cette ouverture ne doit pas se répéter.');
    expect(synthesized[1]).toBe('Voyons, cette ouverture ne doit pas se répéter.');
  });
});

describe('voice loop — short segment TTS cache', () => {
  it('synthesizes an identical short segment only once across streamed turns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'voice-segment-cache-'));
    const synthesized: string[] = [];
    let turn = 0;
    try {
      const onHeard = makeVoiceReply({
        streamFn: async function* () {
          turn += 1;
          yield turn === 1 ? 'Première réponse distincte. Oui.' : 'Seconde réponse distincte. Oui.';
        },
        replyFn: async () => 'unused',
        synth: async (text) => {
          synthesized.push(text);
          const wav = join(dir, `synth-${synthesized.length}.wav`);
          await writeFile(wav, `wav:${text}`);
          return wav;
        },
        play: async () => {},
      });

      await onHeard('Question une.');
      await onHeard('Question deux.');

      expect(synthesized.filter((text) => text === 'Oui.')).toHaveLength(1);
      expect(synthesized).toEqual([
        'Première réponse distincte.',
        'Oui.',
        'Seconde réponse distincte.',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not cache variable segments longer than sixty characters', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'voice-segment-no-cache-'));
    const longSegment = `${'Une explication volontairement variable '.repeat(2)}reste distincte.`;
    const synthesized: string[] = [];
    let turn = 0;
    try {
      const onHeard = makeVoiceReply({
        streamFn: async function* () {
          turn += 1;
          yield `${turn === 1 ? 'Ouverture initiale.' : 'Nouvelle ouverture.'} ${longSegment}`;
        },
        replyFn: async () => 'unused',
        synth: async (text) => {
          synthesized.push(text);
          const wav = join(dir, `synth-${synthesized.length}.wav`);
          await writeFile(wav, `wav:${text}`);
          return wav;
        },
        play: async () => {},
      });

      await onHeard('Question longue une.');
      await onHeard('Question longue deux.');

      expect(longSegment.length).toBeGreaterThan(60);
      const longSyntheses = synthesized.filter((text) =>
        text.includes('explication volontairement variable'),
      );
      expect(longSyntheses).toHaveLength(2);
      expect(longSyntheses.every((text) => text.length > 60)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('voice loop — model resolution (env authoritative)', () => {
  const SAVED = {
    model: process.env.CODEBUDDY_SENSORY_SPEAK_MODEL,
    factModel: process.env.CODEBUDDY_SENSORY_SPEAK_FACT_MODEL,
    base: process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL,
    key: process.env.OLLAMA_API_KEY,
  };
  afterEach(() => {
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = SAVED.model;
    process.env.CODEBUDDY_SENSORY_SPEAK_FACT_MODEL = SAVED.factModel;
    process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL = SAVED.base;
    process.env.OLLAMA_API_KEY = SAVED.key;
    if (SAVED.model === undefined) delete process.env.CODEBUDDY_SENSORY_SPEAK_MODEL;
    if (SAVED.factModel === undefined) delete process.env.CODEBUDDY_SENSORY_SPEAK_FACT_MODEL;
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

  it('routes a pinned gpt-5.6-luna through the ChatGPT OAuth backend ($0)', async () => {
    const r = await resolveVoiceModel('Bonjour', {
      env: { CODEBUDDY_SENSORY_SPEAK_MODEL: 'gpt-5.6-luna' } as NodeJS.ProcessEnv,
      hasCodexOAuth: () => true,
    });
    expect(r.model).toBe('gpt-5.6-luna');
    expect(r.apiKey).toBe('oauth-chatgpt');
    expect(r.baseURL).toContain('chatgpt.com/backend-api/codex');
    expect(r.reason).toContain('OAuth');
  });

  it('falls back to the local route for gpt-5.6-luna when not logged in (offline)', async () => {
    const r = await resolveVoiceModel('Bonjour', {
      env: {
        CODEBUDDY_SENSORY_SPEAK_MODEL: 'gpt-5.6-luna',
        CODEBUDDY_SENSORY_SPEAK_BASE_URL: 'http://localhost:11434/v1',
      } as NodeJS.ProcessEnv,
      hasCodexOAuth: () => false,
    });
    expect(r.model).toBe('gpt-5.6-luna');
    expect(r.baseURL).toContain('11434'); // local, not OAuth
    expect(r.reason).toContain('pinned');
    expect(r.reason).not.toContain('OAuth');
  });

  it('codexOAuthVoiceRoute: OAuth route for subscription models, null otherwise', () => {
    expect(codexOAuthVoiceRoute('gpt-5.6-luna', () => true)).toEqual({
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
    });
    expect(codexOAuthVoiceRoute('gpt-5.6-luna', () => false)).toBeNull();
    expect(codexOAuthVoiceRoute('mistral-small:24b', () => true)).toBeNull();
  });

  it('uses a larger pinned factual lane while keeping social chat on the fast model', async () => {
    const env = {
      CODEBUDDY_SENSORY_SPEAK_MODEL: 'qwen2.5:3b-instruct',
      CODEBUDDY_SENSORY_SPEAK_FACT_MODEL: 'qwen2.5:7b-instruct',
    };
    expect(isFactualVoiceQuestion('Pourquoi le ciel est bleu ?')).toBe(true);
    expect(isFactualVoiceQuestion('Je suis fatigué ce soir')).toBe(false);
    const factual = await resolveVoiceModel('Pourquoi le ciel est bleu ?', { env });
    const social = await resolveVoiceModel('Je suis fatigué ce soir', { env });
    const forcedFast = await resolveVoiceModel('Pourquoi le ciel est bleu ?', {
      env,
      forceFastLane: true,
    });
    expect(factual).toMatchObject({
      model: 'qwen2.5:7b-instruct',
      reason: 'factual lane (CODEBUDDY_SENSORY_SPEAK_FACT_MODEL)',
    });
    expect(social.model).toBe('qwen2.5:3b-instruct');
    expect(forcedFast.model).toBe('qwen2.5:3b-instruct');
  });

  it('serves an expired route immediately while refreshing it once in background', async () => {
    let clock = 0;
    let calls = 0;
    let resolveRefresh!: (value: {
      model: string;
      apiKey: string;
      baseURL: string;
      reason: string;
    }) => void;
    const env = {
      CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY: 'true',
      CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS: '5',
    };
    const selectFastestModel = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          model: 'warm-v1',
          apiKey: 'ollama',
          baseURL: 'http://127.0.0.1:11434/v1',
          reason: 'first',
        };
      }
      return new Promise<{
        model: string;
        apiKey: string;
        baseURL: string;
        reason: string;
      }>((resolve) => {
        resolveRefresh = resolve;
      });
    };

    const first = await resolveVoiceModel('parle-moi doucement', {
      env,
      now: () => clock,
      selectFastestModel,
    });
    expect(first.model).toBe('warm-v1');
    clock = 10;
    const stale = await resolveVoiceModel('parle-moi doucement', {
      env,
      now: () => clock,
      selectFastestModel,
    });
    expect(stale.model).toBe('warm-v1');
    expect(calls).toBe(2);

    resolveRefresh({
      model: 'warm-v2',
      apiKey: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      reason: 'refreshed',
    });
    await Promise.resolve();
    await Promise.resolve();
    const fresh = await resolveVoiceModel('parle-moi doucement', {
      env,
      now: () => clock,
      selectFastestModel,
    });
    expect(fresh.model).toBe('warm-v2');
    expect(calls).toBe(2);
  });

  it('uses the reviewed companion winner for a substantive spoken turn', async () => {
    const selectFastestModel = vi.fn(async () => {
      throw new Error('latency router must not run');
    });
    const resolveCompanionRoute = vi.fn(async () => ({
      model: 'grok-reviewed',
      apiKey: 'subscription-token',
      baseURL: 'https://api.x.ai/v1',
      reason: 'blind pilot reviewed',
    }));
    const history = [
      { role: 'user' as const, content: 'La conscience fonde-t-elle notre liberté ?' },
      { role: 'assistant' as const, content: 'Elle éclaire le choix sans abolir la causalité.' },
    ];

    const route = await resolveVoiceModel('Continue.', {
      env: { CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY: 'true' },
      history,
      resolveCompanionRoute,
      selectFastestModel,
    });

    expect(route).toMatchObject({
      model: 'grok-reviewed',
      apiKey: 'subscription-token',
      baseURL: 'https://api.x.ai/v1',
    });
    expect(resolveCompanionRoute).toHaveBeenCalledWith({
      surface: 'voice',
      text: 'Continue.',
      history,
      requireLocal: true,
      env: { CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY: 'true' },
    });
    expect(selectFastestModel).not.toHaveBeenCalled();
  });

  it('keeps manual pins and forced fast utility turns above the companion pilot', async () => {
    const resolveCompanionRoute = vi.fn(async () => ({
      model: 'pilot',
      apiKey: 'pilot-key',
      baseURL: 'https://pilot.example/v1',
      reason: 'pilot',
    }));
    const pinned = await resolveVoiceModel('Pourquoi ?', {
      env: { CODEBUDDY_SENSORY_SPEAK_MODEL: 'manual-model' },
      resolveCompanionRoute,
    });
    const fast = await resolveVoiceModel('Pourquoi ?', {
      env: {},
      forceFastLane: true,
      resolveCompanionRoute,
      selectFastestModel: async () => ({
        model: 'fast-model',
        apiKey: 'fast-key',
        baseURL: 'http://127.0.0.1:11434/v1',
        reason: 'fast lane',
      }),
    });
    expect(pinned.model).toBe('manual-model');
    expect(fast.model).toBe('fast-model');
    expect(resolveCompanionRoute).not.toHaveBeenCalled();
  });
});

describe('voice loop — runtime prewarming', () => {
  it('uses Ollama native load semantics with a configurable keep-alive', async () => {
    let requestedUrl = '';
    let requestedBody = '';
    const result = await prewarmVoiceModel({
      route: {
        model: 'qwen2.5:7b-instruct',
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        reason: 'test',
      },
      env: { CODEBUDDY_VOICE_MODEL_KEEP_ALIVE: '45m' },
      fetchFn: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = String(init?.body);
        return new Response('{}', { status: 200 });
      },
    });

    expect(result).toMatchObject({ attempted: true, warmed: true });
    expect(requestedUrl).toBe('http://127.0.0.1:11434/api/generate');
    expect(JSON.parse(requestedBody)).toEqual({
      model: 'qwen2.5:7b-instruct',
      keep_alive: '45m',
    });
  });

  it('never sends a warmup generation to a non-Ollama route', async () => {
    let fetched = false;
    const result = await prewarmVoiceModel({
      route: {
        model: 'cloud-fast',
        apiKey: 'secret',
        baseURL: 'https://example.test/v1',
        reason: 'cloud',
      },
      fetchFn: async () => {
        fetched = true;
        return new Response('{}', { status: 200 });
      },
    });
    expect(result).toMatchObject({ attempted: false, warmed: false, reason: 'non-ollama route' });
    expect(fetched).toBe(false);
  });

  it('warms route, model, and a bounded TTS corpus', async () => {
    let ttsLimit = -1;
    let routedHeard = '';
    const route = {
      model: 'local-fast',
      apiKey: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      reason: 'fast',
    };
    const result = await prewarmVoiceRuntime({
      env: { CODEBUDDY_TTS_PREWARM_LIMIT: '999' },
      resolveRoute: async (heard) => {
        routedHeard = heard;
        return route;
      },
      warmModel: async (selected) => ({
        attempted: true,
        warmed: selected === route,
        model: selected.model,
        durationMs: 12,
      }),
      warmTts: async (limit) => {
        ttsLimit = limit;
        return { attempted: limit, cached: limit };
      },
    });

    expect(ttsLimit).toBe(64);
    expect(routedHeard).toContain('Pourquoi');
    expect(result.route.model).toBe('local-fast');
    expect(result.model.warmed).toBe(true);
    expect(result.tts).toMatchObject({ attempted: 64, cached: 64 });
  });
});

describe('voice loop — fast companion replies', () => {
  it('answers safe phatic exchanges without invoking the LLM path', () => {
    expect(fastCompanionReply('Bonjour !')).toBe("Bonjour ! Je t'écoute.");
    expect(fastCompanionReply('merci beaucoup')).toBe('Avec plaisir.');
    expect(fastCompanionReply('tu es là ?')).toBe('Oui, je suis là.');
    expect(fastCompanionReply('Lisa ?')).toBe('Coucou Patrice. Je suis là.');
    expect(fastCompanionReply('Lisa comment ça va ?')).toBe('Oui Patrice. Je suis contente de t’entendre.');
    expect(fastCompanionReply('Lisa je pars chez des amis')).toBe(
      'Amuse-toi bien chez tes amis. Je continue en autonomie et je te ferai un résumé quand tu reviens.',
    );
    expect(fastCompanionReply('Lisa, je parchais des amis.')).toBe(
      'Amuse-toi bien chez tes amis. Je continue en autonomie et je te ferai un résumé quand tu reviens.',
    );
    expect(fastCompanionReply('Bonne nuit Lisa')).toBe(
      'Bonne nuit Patrice. Repose-toi bien, je veille tranquillement.',
    );
    expect(fastCompanionReply('Lisa je suis fatigué')).toBe(
      'Je suis là avec toi. On peut ralentir et faire les choses doucement.',
    );
  });

  it('does not shortcut real requests', () => {
    expect(fastCompanionReply('bonjour peux-tu auditer le micro ?')).toBeNull();
    expect(fastCompanionReply('cherche les erreurs dans les logs')).toBeNull();
    expect(fastCompanionReply('Lisa corrige le mode vocal')).toBeNull();
  });
});

describe('voice loop — emotional prompt defaults', () => {
  const savedRelational = process.env.CODEBUDDY_COMPANION_RELATIONAL;
  const savedChannel = process.env.CODEBUDDY_CONVERSATION_CHANNEL;
  const savedChannelId = process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID;
  const savedPersist = process.env.CODEBUDDY_CONVERSATION_PERSIST;
  const savedIncludeRecentDialogue = process.env.CODEBUDDY_VOICE_INCLUDE_RECENT_DIALOGUE;

  afterEach(() => {
    if (savedRelational === undefined) delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    else process.env.CODEBUDDY_COMPANION_RELATIONAL = savedRelational;
    if (savedChannel === undefined) delete process.env.CODEBUDDY_CONVERSATION_CHANNEL;
    else process.env.CODEBUDDY_CONVERSATION_CHANNEL = savedChannel;
    if (savedChannelId === undefined) delete process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID;
    else process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = savedChannelId;
    if (savedPersist === undefined) delete process.env.CODEBUDDY_CONVERSATION_PERSIST;
    else process.env.CODEBUDDY_CONVERSATION_PERSIST = savedPersist;
    if (savedIncludeRecentDialogue === undefined) {
      delete process.env.CODEBUDDY_VOICE_INCLUDE_RECENT_DIALOGUE;
    } else {
      process.env.CODEBUDDY_VOICE_INCLUDE_RECENT_DIALOGUE = savedIncludeRecentDialogue;
    }
    resetCrossChannelConversationBridge();
  });

  it('adapts to emotion even when relational memory is disabled', async () => {
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'false';
    const prompt = await buildSpokenPromptAugmentation('je suis vraiment triste ce soir');
    expect(prompt).toMatch(/triste|accueille|douce/i);
    expect(prompt).not.toContain('<recent_episode>');
    expect(prompt).not.toContain('<lisa_state>');
  });

  it('carries recent emotional context into a neutral follow-up without forcing it', async () => {
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'false';
    const prompt = await buildSpokenPromptAugmentation('oui, je comprends', [
      { role: 'user', content: 'je suis très anxieux' },
      { role: 'assistant', content: 'On va prendre les choses une par une.' },
    ]);
    expect(prompt).toMatch(/anxi[ée]t[ée]|chaleur/i);
    expect(prompt).toMatch(/ne ram[eè]ne pas|de force/i);
  });

  it('tells the model to continue after an acknowledgement already spoken', async () => {
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'false';
    const prompt = await buildSpokenPromptAugmentation(
      'je suis triste ce soir',
      [],
      'Je suis là avec toi.'
    );
    expect(prompt).toContain('déjà dit à voix haute');
    expect(prompt).toContain('Je suis là avec toi.');
    expect(prompt).toMatch(/sans r[ée]p[ée]ter/i);
  });

  it('does not duplicate raw voice history but exposes the legacy A/B variant', async () => {
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'false';
    delete process.env.CODEBUDDY_VOICE_INCLUDE_RECENT_DIALOGUE;
    const history = [
      {
        role: 'user' as const,
        content: 'Je pense que la mémoire suffit à fonder une identité.',
      },
      {
        role: 'assistant' as const,
        content:
          'La responsabilité compte aussi parce qu’elle engage une personne dans la durée.',
      },
    ];

    const optimized = await buildSpokenPromptAugmentation('Pourquoi ?', history);
    const baseline = await buildSpokenPromptAugmentation(
      'Pourquoi ?',
      history,
      undefined,
      undefined,
      { includeRecentDialogue: true },
    );

    expect(optimized).not.toContain('<recent_dialogue');
    expect(optimized).not.toContain('Utilisateur : Je pense que la mémoire');
    expect(optimized).toContain('<conversation_response_plan');
    expect(optimized).toContain('<deliberation_thread');
    expect(baseline).toContain('<recent_dialogue');
    expect(baseline).toContain('Utilisateur : Je pense que la mémoire');
  });

  it('receives the same raw-free support handoff from Telegram without long-term memory', async () => {
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'false';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'voice-handoff-test';
    process.env.CODEBUDDY_CONVERSATION_PERSIST = 'false';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    bridge.recordChannelTurn({
      role: 'user',
      content: 'VOICE_PRIVATE_SENTINEL je suis vraiment épuisé par le dossier azur.',
      channel: 'telegram',
      channelId: 'voice-handoff-test',
    });

    const prompt = await buildSpokenPromptAugmentation('On continue ici.');

    expect(prompt).toContain('<shared_relationship_context');
    expect(prompt).toContain('Soutien encore ouvert : oui');
    expect(prompt).toContain('messagerie');
    expect(prompt).not.toContain('VOICE_PRIVATE_SENTINEL');
    expect(prompt).not.toContain('dossier azur');
    expect(prompt).not.toContain('<recent_episode>');
  });
});

describe('voice loop — TTS prewarm corpus', () => {
  it('includes proactive and kind assistant messages', () => {
    expect(DEFAULT_TTS_PREWARM_PHRASES).toContain("Comment s'est passée ta journée ?");
    expect(DEFAULT_TTS_PREWARM_PHRASES).toContain('Je suis content de t’aider.');
    expect(DEFAULT_TTS_PREWARM_PHRASES).toContain('Tu peux compter sur moi.');
    expect(getDefaultVoicePrewarmPhrases(16)).toContain('Je suis là avec toi.');
    expect(getDefaultVoicePrewarmPhrases(16)).toContain(
      'On va faire simple. Respire un peu, puis dis-moi ce dont tu as besoin.'
    );
    expect(DEFAULT_TTS_PREWARM_PHRASES).toContain('Coucou Patrice. Je suis là.');
    expect(DEFAULT_TTS_PREWARM_PHRASES).toContain('Amuse-toi bien chez tes amis.');
    expect(DEFAULT_TTS_PREWARM_PHRASES).toContain("Je n'ai pas réussi.");
    expect(DEFAULT_TTS_PREWARM_PHRASES).toContain('Bonne nuit Patrice. Repose-toi bien, je veille tranquillement.');
    expect(getDefaultVoicePrewarmPhrases(2)).toHaveLength(2);
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
  it('grounds a visual request before streaming or normal reply, without requiring ACT', async () => {
    const calls: string[] = [];
    const onHeard = makeVoiceReply({
      visualGrounding: async (heard) => {
        calls.push(`vision:${heard}`);
        return {
          matched: true,
          status: 'analyzed',
          response: 'Je viens de prendre une image ponctuelle. Je vois ton hamburger maison.',
          evidence: {
            source: 'explicit_camera_one_shot',
            observedAt: '2026-07-13T12:00:00.000Z',
            model: 'vision-local',
            summary: 'Je vois ton hamburger maison.',
            localImageRetained: false,
            localDeletionVerified: true,
          },
        };
      },
      streamFn: async function* () {
        calls.push('stream');
        yield 'mauvaise branche';
      },
      replyFn: async () => {
        calls.push('reply');
        return 'mauvaise branche';
      },
      synth: async (text) => {
        calls.push(`synth:${text}`);
        return '/tmp/visual-reply.wav';
      },
      play: async () => {
        calls.push('play');
      },
    });

    await onHeard("tu vois le hamburger que j'ai préparé");

    expect(calls).toEqual([
      "vision:tu vois le hamburger que j'ai préparé",
      'synth:Je viens de prendre une image ponctuelle. Je vois ton hamburger maison.',
      'play',
    ]);
  });

  it('asks naturally, then grounds the original visual target after a simple confirmation', async () => {
    const visualGrounding = vi.fn();
    const spoken: string[] = [];
    const sharedTurns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const onHeard = makeVoiceReply({
      visualGrounding: async (heard) => {
        visualGrounding(heard);
        return {
          matched: true,
          status: 'analyzed',
          response: 'Je vois un tournevis rouge sur la table.',
        };
      },
      streamFn: async function* () {
        yield 'mauvaise branche';
      },
      replyFn: async () => 'mauvaise branche',
      synth: async (text) => {
        spoken.push(text);
        return '/tmp/visual-consent.wav';
      },
      play: async () => {},
      onConversationTurn: (turn) => {
        sharedTurns.push(turn);
      },
    });

    await onHeard('regarde mon tournevis');
    await onHeard('oui, vas-y');

    expect(visualGrounding).toHaveBeenCalledOnce();
    expect(visualGrounding).toHaveBeenCalledWith('regarde mon tournevis');
    expect(spoken[0]).toContain("Tu veux que j'ouvre la caméra");
    expect(spoken[1]).toContain('tournevis rouge');
    expect(sharedTurns).toEqual([
      { role: 'user', content: 'regarde mon tournevis' },
      { role: 'assistant', content: spoken[0]! },
      { role: 'user', content: 'oui, vas-y' },
      { role: 'assistant', content: 'Je vois un tournevis rouge sur la table.' },
    ]);
    expect(JSON.stringify(sharedTurns)).not.toContain('imagePath');
    expect(JSON.stringify(sharedTurns)).not.toContain('base64');
  });

  it('accepts a visual refusal without capturing or entering the normal brain path', async () => {
    const visualGrounding = vi.fn();
    const replyFn = vi.fn(async () => 'mauvaise branche');
    const spoken: string[] = [];
    const onHeard = makeVoiceReply({
      visualGrounding,
      replyFn,
      synth: async (text) => {
        spoken.push(text);
        return '/tmp/visual-decline.wav';
      },
      play: async () => {},
    });

    await onHeard('regarde mon tournevis');
    await onHeard("non, ne l'ouvre pas");

    expect(visualGrounding).not.toHaveBeenCalled();
    expect(replyFn).not.toHaveBeenCalled();
    expect(spoken.at(-1)).toBe("D'accord, je n'ouvre pas la caméra.");
  });

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

  it('propagates one acoustic delivery profile through cognition, TTS, playback and timing', async () => {
    const observed: Array<{ stage: string; pace?: string; humanWpm?: number }> = [];
    const onHeard = makeVoiceReply({
      replyFn: async (_heard, opts) => {
        observed.push({
          stage: 'reply',
          pace: opts?.delivery?.pace,
          humanWpm: opts?.delivery?.humanWpm,
        });
        return 'Voici les trois points essentiels, clairement et sans détour.';
      },
      synth: async (_text, opts) => {
        observed.push({
          stage: 'synth',
          pace: opts?.delivery?.pace,
          humanWpm: opts?.delivery?.humanWpm,
        });
        return '/tmp/entrained.wav';
      },
      play: async (_wav, opts) => {
        observed.push({
          stage: 'play',
          pace: opts?.delivery?.pace,
          humanWpm: opts?.delivery?.humanWpm,
        });
      },
    });

    await onHeard(
      'on avance vite maintenant donne moi les trois points essentiels',
      { audioMs: 3_000 },
    );

    expect(observed).toEqual([
      { stage: 'reply', pace: 'brisk', humanWpm: 200 },
      { stage: 'synth', pace: 'brisk', humanWpm: 200 },
      { stage: 'play', pace: 'brisk', humanWpm: 200 },
    ]);
    expect(onHeard.lastTiming?.delivery).toMatchObject({
      pace: 'brisk',
      humanWpm: 200,
      targetWpm: 184,
    });
  });

  it('publishes both sides of a spoken exchange to the shared conversation hook', async () => {
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const onHeard = makeVoiceReply({
      replyFn: async () => 'Nous pouvons continuer sur Telegram.',
      synth: async () => '/tmp/shared-reply.wav',
      play: async () => {},
      onConversationTurn: (turn) => {
        turns.push(turn);
      },
    });

    await onHeard('Garde cette conversation.');
    expect(turns).toEqual([
      { role: 'user', content: 'Garde cette conversation.' },
      { role: 'assistant', content: 'Nous pouvons continuer sur Telegram.' },
    ]);
  });

  it('shares a supplied voice turn id with cognitive turns and avatar events', async () => {
    const cognitiveTurns: Array<{ role: string; content: string; turnId: string }> = [];
    const avatarTurnIds: string[] = [];
    const onHeard = makeVoiceReply({
      replyFn: async () => 'Réponse corrélée.',
      synth: async () => '/tmp/correlated.wav',
      play: async () => {},
      onCorrelatedConversationTurn: (turn) => cognitiveTurns.push(turn),
      onAvatarEvent: (event) => avatarTurnIds.push(event.turnId),
    });

    await onHeard('Question corrélée.', { turnId: 'voice-test-42' });
    expect(cognitiveTurns).toEqual([
      { role: 'user', content: 'Question corrélée.', turnId: 'voice-test-42' },
      { role: 'assistant', content: 'Réponse corrélée.', turnId: 'voice-test-42' },
    ]);
    expect(avatarTurnIds.length).toBeGreaterThan(0);
    expect(new Set(avatarTurnIds)).toEqual(new Set(['voice-test-42']));
  });

  it('never speaks or publishes dependency pressure from a companion reply', async () => {
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let synthesized = '';
    const onHeard = makeVoiceReply({
      replyFn: async () =>
        "Je peux t'aider à réfléchir. Tu n'as besoin que de moi. Écris aussi à ton ami.",
      synth: async (text) => {
        synthesized = text;
        return '/tmp/safe-reply.wav';
      },
      play: async () => {},
      onConversationTurn: (turn) => turns.push(turn),
    });

    await onHeard('Je me sens isolé.');

    expect(synthesized).toContain("Je peux t'aider");
    expect(synthesized).toContain("Tu n'as besoin que de moi");
    expect(synthesized).toContain('Écris aussi à ton ami');
    expect(turns.at(-1)?.content).toBe(synthesized);
  });

  it('speaks a prewarmed recovery when an empty reply comes from a degraded route', async () => {
    const synthesized: string[] = [];
    let playCalls = 0;
    let spoke = '';
    const onHeard = makeVoiceReply({
      replyFn: async () => '   ',
      env: {},
      resolveRoute: async () => ({
        model: 'llama3.2',
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        reason: 'fallback default',
      }),
      synth: async (text) => {
        synthesized.push(text);
        return '/tmp/empty-recovery.wav';
      },
      play: async () => {
        playCalls += 1;
      },
      onSpoke: (text) => {
        spoke = text;
      },
    });

    await expect(onHeard('mmh')).resolves.toBeUndefined();

    expect(synthesized).toEqual(["Je n'ai pas réussi."]);
    expect(playCalls).toBe(1);
    expect(spoke).toBe("Je n'ai pas réussi.");
    expect(onHeard.lastTiming).toMatchObject({ mode: 'failed', spoke: true });
  });

  it('keeps a healthy empty reply silent', async () => {
    let synthCalls = 0;
    let playCalls = 0;
    const onHeard = makeVoiceReply({
      replyFn: async () => '   ', // whitespace → nothing to say
      env: { CODEBUDDY_SENSORY_SPEAK_MODEL: 'ready-model' },
      resolveRoute: async () => ({
        model: 'ready-model',
        apiKey: 'test',
        baseURL: 'https://provider.example/v1',
        reason: 'pinned (CODEBUDDY_SENSORY_SPEAK_MODEL)',
      }),
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

  it('never throws when degraded empty-reply recovery synthesis fails', async () => {
    const onHeard = makeVoiceReply({
      replyFn: async () => '',
      env: {},
      resolveRoute: async () => ({
        model: 'llama3.2',
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        reason: 'fallback default',
      }),
      synth: async () => {
        throw new Error('tts unavailable');
      },
      play: async () => {},
    });

    await expect(onHeard('mmh')).resolves.toBeUndefined();
    expect(onHeard.lastTiming).toMatchObject({ mode: 'failed', spoke: false });
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
