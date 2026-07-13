import { describe, it, expect, afterEach } from 'vitest';
import {
  makeVoiceReply,
  describeVoiceReadiness,
  DEFAULT_TTS_PREWARM_PHRASES,
  fastCompanionReply,
  getDefaultVoicePrewarmPhrases,
  isFactualVoiceQuestion,
  resolveVoiceModel,
  resetVoiceModelCache,
  prewarmVoiceModel,
  prewarmVoiceRuntime,
  sayNow,
  buildSpokenPromptAugmentation,
  lookupInstantBackchannelWav,
  resolveResidentVoicePermissionMode,
} from '../../src/sensory/voice-loop.js';

describe('voice loop — readiness (fail-loud prereqs)', () => {
  it('uses Pocket/Estelle as the speak-ready default', () => {
    const r = describeVoiceReadiness({});
    expect(r.ttsEngine).toBe('pocket');
    expect(r.speakReady).toBe(true);
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
    expect(calls).toEqual([['Alors…', 'pocket:estelle']]);
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
    const route = {
      model: 'local-fast',
      apiKey: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      reason: 'fast',
    };
    const result = await prewarmVoiceRuntime({
      env: { CODEBUDDY_TTS_PREWARM_LIMIT: '999' },
      resolveRoute: async () => route,
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

  afterEach(() => {
    if (savedRelational === undefined) delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    else process.env.CODEBUDDY_COMPANION_RELATIONAL = savedRelational;
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
