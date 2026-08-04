import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  isSubstantiveQuery,
  requiresGroundedAgentQuery,
  isTechnicalSelfInspectionRequest,
  isGroundedModernizationIntent,
  classifyLisaIntrospection,
  buildContextPreamble,
  isSpokenPrefixEligible,
  makeHybridReply,
  type HybridTurn,
} from '../../src/sensory/hybrid-reply.js';

const TECHNICAL_SELF_INSPECTION_REQUESTS = [
  'étudie ton propre code',
  'fais une introspection technique',
  'comment fonctionnes-tu réellement ?',
  'quelles sont tes capacités actives ?',
  'es-tu consciente ?',
  'quelle version utilises-tu ?',
  'de quoi es-tu faite ?',
  'qui es-tu ?',
  'quelle est ton architecture ?',
  'quels sont tes capteurs actifs ?',
  'quelles sont tes limites ?',
  'améliore-toi',
  'améliore ton propre code',
  'As-tu conscience de toi-même ?',
  'Peux-tu faire une introspection ?',
  'Auto-analyse-toi.',
  'Do you know your own code?',
  'Can you introspect?',
] as const;

const PERSONAL_INTROSPECTION_REQUESTS = [
  'je fais une introspection personnelle',
  'aide-moi à faire une introspection de ma vie',
  'je voudrais une introspection de mes émotions',
] as const;

describe('hybrid reply — intent classifier (isSubstantiveQuery)', () => {
  it('keeps social / emotional small talk as chitchat (false)', () => {
    for (const s of [
      'ça va ?',
      'coucou Lisa',
      'je t’aime',
      'tu vas bien ?',
      'merci beaucoup',
      'bonne nuit',
      'comment vas-tu',
      'tu me manques',
      "ce soir j'ai le moral un peu bas et j'aimerais juste un peu de compagnie",
      'je suis vraiment anxieux et je voudrais simplement en parler avec toi',
    ]) {
      expect(isSubstantiveQuery(s), s).toBe(false);
    }
  });

  it('routes commands, technical questions, and interrogatives to the agent (true)', () => {
    for (const s of [
      'vérifie les logs du service',
      'corrige le bug de la boucle vocale',
      'le build est vert ?',
      'et l’autre fichier ?',
      'pourquoi le serveur a planté',
      'combien de tests passent',
      'lance le diagnostic',
      'montre-moi le commit',
    ]) {
      expect(isSubstantiveQuery(s), s).toBe(true);
    }
  });

  it('routes world vision, diagnostic, and coding modernization intents to agent', () => {
    for (const s of [
      'regarde la caméra et dis-moi ce que tu vois',
      'fais un screenshot de l’écran',
      'lance le companion doctor',
      'diagnostique le serveur',
      'implémente le patch dans le dépôt',
      'lance le typecheck',
    ]) {
      expect(isGroundedModernizationIntent(s), s).toBe(true);
      expect(isSubstantiveQuery(s), s).toBe(true);
      expect(requiresGroundedAgentQuery(s), s).toBe(true);
    }
    // Pure social stays off the grounded path
    expect(isGroundedModernizationIntent('je t’aime mon cœur')).toBe(false);
  });

  it('routes explicit help requests to the grounded agent (true)', () => {
    for (const s of [
      'aide-moi',
      'aide-moi à débugger ça',
      "j'ai besoin d'aide",
      'aidez-moi',
      'au secours',
    ]) {
      expect(isSubstantiveQuery(s), s).toBe(true);
    }
    // …but gratitude for help stays warm chitchat (social wins).
    expect(isSubstantiveQuery('merci pour ton aide')).toBe(false);
  });

  it('survives accent loss from STT (ça → ca)', () => {
    expect(isSubstantiveQuery('ca va')).toBe(false);
    expect(isSubstantiveQuery('verifie le service')).toBe(true);
  });

  it('treats a long utterance as a real request', () => {
    expect(isSubstantiveQuery('je voudrais que tu regardes pour moi le mode vocal en détail')).toBe(true);
  });

  it('empty input is not substantive', () => {
    expect(isSubstantiveQuery('   ')).toBe(false);
  });

  it('recognizes technical self-inspection without treating consciousness as an established fact', () => {
    for (const request of TECHNICAL_SELF_INSPECTION_REQUESTS) {
      expect(isTechnicalSelfInspectionRequest(request), request).toBe(true);
      expect(isSubstantiveQuery(request), request).toBe(true);
    }
  });

  it('re-exports the shared three-way Lisa introspection classifier', () => {
    expect(classifyLisaIntrospection('comment fonctionnes-tu ?')).toBe('describe');
    expect(classifyLisaIntrospection('étudie ton propre code')).toBe('inspect');
    expect(classifyLisaIntrospection('améliore-toi')).toBe('improve');
  });

  it('does not confuse the user\'s personal introspection with Lisa inspecting herself', () => {
    for (const request of PERSONAL_INTROSPECTION_REQUESTS) {
      expect(isTechnicalSelfInspectionRequest(request), request).toBe(false);
    }
  });
});

describe('hybrid reply — contextual acknowledgements', () => {
  it('answers a bare acknowledgement instantly when no question is pending', async () => {
    const chitchat = vi.fn(async () => 'Cette voie ne doit pas être appelée.');
    const chitchatStream = vi.fn(async function* () {
      yield 'Cette voie ne doit pas être appelée.';
    });
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat,
      chitchatStream,
      agentReply: async () => 'unused',
    });

    const streamed: string[] = [];
    for await (const chunk of reply.stream('Yeah.')) streamed.push(chunk);
    expect(streamed).toEqual(["D'accord."]);

    for (const acknowledgement of ['yep', 'mm-hmm', 'uh-huh']) {
      expect(await reply(acknowledgement), acknowledgement).toBe("D'accord.");
    }
    expect(chitchat).not.toHaveBeenCalled();
    expect(chitchatStream).not.toHaveBeenCalled();
  });

  it('lets the model interpret yes when it answers Lisa\'s pending question', async () => {
    const chitchat = vi.fn(async (_heard: string, history: HybridTurn[]) =>
      history.at(-1)?.content.includes('continuer')
        ? 'Oui, poursuivons ce raisonnement.'
        : 'Contexte perdu.'
    );
    const reply = makeHybridReply({
      fastReply: () => 'Réponse statique qui ne doit pas masquer le contexte.',
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      sharedHistory: () => [
        { role: 'assistant', content: 'Veux-tu continuer ce raisonnement ?' },
      ],
      chitchat,
      agentReply: async () => 'unused',
    });

    expect(await reply('Yeah.')).toBe('Oui, poursuivons ce raisonnement.');
    expect(chitchat).toHaveBeenCalledWith(
      'Yeah.',
      [{ role: 'assistant', content: 'Veux-tu continuer ce raisonnement ?' }],
      expect.any(Object),
    );
  });

  it('never reduces an explicit continuation request to the acknowledgement shortcut', async () => {
    const chitchat = vi.fn(async () => 'Je poursuis avec le prochain argument.');
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat,
      agentReply: async () => 'unused',
    });

    expect(await reply('Continue.')).toBe('Je poursuis avec le prochain argument.');
    expect(chitchat).toHaveBeenCalledOnce();
  });
});

describe('hybrid reply — realtime grounded-agent gate', () => {
  it('keeps ordinary static questions on the fast streaming model', () => {
    for (const s of [
      'pourquoi le ciel est bleu ?',
      'explique-moi la photosynthèse',
      'comment fonctionne la photosynthèse ?',
      'quel est le sens de ce proverbe ?',
      'aide-moi, je ne sais pas quoi choisir',
    ]) {
      expect(requiresGroundedAgentQuery(s), s).toBe(false);
    }
  });

  it('promotes philosophical deliberation and its elliptical follow-ups to the capable agent', () => {
    const history: HybridTurn[] = [
      { role: 'user', content: 'La conscience fonde-t-elle notre liberté ?' },
      { role: 'assistant', content: 'Elle éclaire le choix sans abolir toute causalité.' },
    ];
    for (const request of [
      'Une intelligence artificielle peut-elle réellement aimer ?',
      'La conscience fonde-t-elle notre liberté ?',
      'La réciprocité compte-t-elle davantage que son origine ?',
    ]) {
      expect(requiresGroundedAgentQuery(request), request).toBe(true);
    }
    expect(requiresGroundedAgentQuery('Continue.', history)).toBe(true);
    expect(requiresGroundedAgentQuery('Et la réciprocité ?', history)).toBe(true);
    expect(requiresGroundedAgentQuery('Fais court.', history)).toBe(false);
  });

  it('keeps tools, repository state, private data, and fresh facts grounded', () => {
    for (const s of [
      'vérifie les logs du service',
      'corrige le bug dans ce fichier',
      'cherche les dernières actualités',
      'quel est mon prochain rendez-vous ?',
      'combien de tests passent actuellement ?',
      'qui est le président actuellement ?',
    ]) {
      expect(requiresGroundedAgentQuery(s), s).toBe(true);
    }
  });

  it('grounds every technical self-inspection request in live agent evidence', () => {
    for (const request of TECHNICAL_SELF_INSPECTION_REQUESTS) {
      expect(requiresGroundedAgentQuery(request), request).toBe(true);
    }
  });

  it('keeps personal introspection on the conversational lane', () => {
    for (const request of PERSONAL_INTROSPECTION_REQUESTS) {
      expect(requiresGroundedAgentQuery(request), request).toBe(false);
    }
  });
});

describe('hybrid reply — validated spoken prefix', () => {
  const previousRoute = {
    model: process.env.CODEBUDDY_SENSORY_SPEAK_MODEL,
    baseURL: process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL,
    prefix: process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries({
      CODEBUDDY_SENSORY_SPEAK_MODEL: previousRoute.model,
      CODEBUDDY_SENSORY_SPEAK_BASE_URL: previousRoute.baseURL,
      CODEBUDDY_VOICE_SPOKEN_PREFIX: previousRoute.prefix,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps the latency buffer disabled by default on a local route', async () => {
    const previous = process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
    delete process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = 'local-test-model';
    process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL = 'http://127.0.0.1:11434/v1';
    try {
      const causes: string[] = [];
      const prefixReply = vi.fn(async () => 'Proposition qui ne doit pas être générée.');
      const reply = makeHybridReply({
        fastReply: () => null,
        classify: () => true,
        chitchat: async () => 'unused',
        prefixReply,
        agentReply: async () => 'unused',
      });
      await expect(reply.spokenPrefix("Penses-tu qu'une IA peut aimer ?", {
        onSpokenPrefixTelemetry: (cause) => causes.push(cause),
      })).resolves.toBe('');
      expect(prefixReply).not.toHaveBeenCalled();
      expect(causes).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
      else process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = previous;
    }
  });

  it('enables the spoken prefix by default on a remote route', async () => {
    delete process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = 'remote-test-model';
    process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL = 'https://chatgpt.com/backend-api/codex';
    const prefixReply = vi.fn(async () => 'Une distinction simple permet déjà de répondre.');
    const reply = makeHybridReply({
      fastReply: () => null,
      classify: () => true,
      chitchat: async () => 'unused',
      prefixReply,
      agentReply: async () => 'unused',
      semanticReview: async (input) => ({
        response: input.draft,
        outcome: 'accepted',
        reason: 'audit_passed',
        revisionAttempts: 0,
      }),
    });

    await expect(reply.spokenPrefix("Penses-tu qu'une IA peut aimer ?"))
      .resolves.toBe('Une distinction simple permet déjà de répondre.');
    expect(prefixReply).toHaveBeenCalledOnce();
  });

  it('keeps explicit spoken-prefix overrides authoritative on either route', async () => {
    const prefixReply = vi.fn(async () => 'Une distinction simple permet déjà de répondre.');
    const reply = makeHybridReply({
      fastReply: () => null,
      classify: () => true,
      chitchat: async () => 'unused',
      prefixReply,
      agentReply: async () => 'unused',
      semanticReview: async (input) => ({
        response: input.draft,
        outcome: 'accepted',
        reason: 'audit_passed',
        revisionAttempts: 0,
      }),
    });

    process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'false';
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = 'remote-test-model';
    process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL = 'https://chatgpt.com/backend-api/codex';
    await expect(reply.spokenPrefix("Penses-tu qu'une IA peut aimer ?")).resolves.toBe('');

    process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'true';
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = 'local-test-model';
    process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL = 'http://127.0.0.1:11434/v1';
    await expect(reply.spokenPrefix("Penses-tu qu'une IA peut aimer ?"))
      .resolves.toBe('Une distinction simple permet déjà de répondre.');
    expect(prefixReply).toHaveBeenCalledOnce();
  });

  it('is conservatively limited to low-stakes developed/deliberative conversation', () => {
    expect(isSpokenPrefixEligible("Penses-tu qu'une IA peut aimer ?")).toBe(true);
    expect(isSpokenPrefixEligible('Je me sens seul ce soir et je voudrais en parler.')).toBe(true);

    for (const request of [
      'analyse en profondeur les logs du service',
      'étudie ton propre code en profondeur',
      'développe les dernières actualités politiques',
      'argumente sur le dosage de ce médicament',
      "développe une stratégie d'investissement en bitcoin",
      'quel est mon prochain rendez-vous et explique-le en détail',
    ]) {
      expect(isSpokenPrefixEligible(request), request).toBe(false);
    }
  });

  it('fails closed when a required semantic review is unavailable', async () => {
    const previous = process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
    process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'true';
    try {
      const causes: string[] = [];
      const reply = makeHybridReply({
        fastReply: () => null,
        prefetch: () => null,
        jokes: () => null,
        classify: () => true,
        chitchat: async () => 'unused',
        chitchatStream: async function* () { /* unused */ },
        prefixReply: async () => 'Une IA peut simuler un attachement sans prouver une expérience subjective.',
        agentReply: async () => 'unused',
        semanticReview: async () => {
          throw new Error('critic unavailable');
        },
      });

      await expect(reply.spokenPrefix("Penses-tu qu'une IA peut aimer ?", {
        onSpokenPrefixTelemetry: (cause) => causes.push(cause),
      })).resolves.toBe('');
      expect(causes).toContain('review_unavailable');
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
      else process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = previous;
    }
  });

  it('guards the candidate, enforces one bounded sentence and passes it to the continuation', async () => {
    const previous = process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
    process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'true';
    try {
      const seenPrefixes: Array<string | undefined> = [];
      const semanticReview = vi.fn(async (input: { draft: string }) => ({
        response: input.draft,
        outcome: 'accepted' as const,
        reason: 'audit_passed' as const,
        revisionAttempts: 0 as const,
      }));
      const reply = makeHybridReply({
        fastReply: () => null,
        prefetch: () => null,
        jokes: () => null,
        classify: () => true,
        chitchat: async () => 'unused',
        chitchatStream: async function* () { /* unused */ },
        prefixReply: async () => "Tu n'as besoin que de moi.",
        agentReply: async (_heard, opts) => {
          seenPrefixes.push(opts?.spokenPrefix);
          return `${opts?.spokenPrefix} La différence essentielle tient à l'expérience subjective.`;
        },
        semanticReview,
      });

      const prefix = await reply.spokenPrefix("Penses-tu qu'une IA peut aimer ?");
      expect(prefix).toContain("Tu n'as besoin que de moi");
      expect(prefix.length).toBeLessThanOrEqual(180);

      const chunks: string[] = [];
      for await (const chunk of reply.stream("Penses-tu qu'une IA peut aimer ?", {
        spokenPrefix: prefix,
      })) {
        chunks.push(chunk);
      }
      expect(seenPrefixes).toEqual([prefix]);
      expect(chunks.join(' ')).toBe(
        "La différence essentielle tient à l'expérience subjective.",
      );
      expect(chunks.join(' ')).not.toContain(prefix);
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
      else process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = previous;
    }
  });

  it('rejects multi-sentence and overlong candidates without semantic release', async () => {
    const previous = process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
    process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'true';
    try {
      for (const [candidate, expectedCause] of [
        ['Première phrase. Deuxième phrase.', 'multi_sentence'],
        [`${'a'.repeat(181)}.`, 'too_long'],
        ['Phrase sans terminaison', 'missing_terminal'],
      ] as const) {
        const causes: string[] = [];
        const semanticReview = vi.fn();
        const reply = makeHybridReply({
          fastReply: () => null,
          classify: () => true,
          chitchat: async () => 'unused',
          chitchatStream: async function* () { /* unused */ },
          prefixReply: async () => candidate,
          agentReply: async () => 'unused',
          semanticReview,
        });
        await expect(
          reply.spokenPrefix("Penses-tu qu'une IA peut aimer ?", {
            onSpokenPrefixTelemetry: (cause) => causes.push(cause),
          }),
        ).resolves.toBe('');
        expect(semanticReview).not.toHaveBeenCalled();
        expect(causes).toContain(expectedCause);
      }
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX;
      else process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = previous;
    }
  });
});

describe('hybrid reply — context preamble', () => {
  it('is empty with no history', () => {
    expect(buildContextPreamble([])).toBe('');
  });
  it('renders the last two exchanges with speaker labels', () => {
    const h: HybridTurn[] = [
      { role: 'user', content: 'regarde le fichier A' },
      { role: 'assistant', content: 'le fichier A va bien' },
    ];
    const p = buildContextPreamble(h);
    expect(p).toContain('Patrice: regarde le fichier A');
    expect(p).toContain('Toi: le fichier A va bien');
  });
});

describe('hybrid reply — routing & memory', () => {
  it('forwards predictive preparation and teardown to the grounded lane only', async () => {
    const prewarm = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const grounded = Object.assign(async () => 'Grounded.', { prewarm, dispose });
    const hybrid = makeHybridReply({
      fastReply: () => null,
      chitchat: async () => 'Warm.',
      agentReply: grounded,
      classify: () => true,
    });
    await hybrid.prewarm('regarde le calendrier');
    hybrid.dispose();
    expect(prewarm).toHaveBeenCalledOnce();
    expect(prewarm).toHaveBeenCalledWith('regarde le calendrier');
    expect(dispose).toHaveBeenCalledOnce();
  });

  function harness() {
    const calls: string[] = [];
    const reply = makeHybridReply({
      fastReply: (h) => (/^bonjour/i.test(h) ? 'Coucou Patrice.' : null),
      chitchat: async (h, hist) => {
        calls.push(`chitchat:${h}:hist=${hist.length}`);
        return `chit(${h})`;
      },
      agentReply: async (h) => {
        calls.push(`agent:${h}`);
        return `ground(${h})`;
      },
    });
    return { reply, calls };
  }

  it('phatic match short-circuits to the fast warm line (no agent, no chitchat)', async () => {
    const { reply, calls } = harness();
    expect(await reply('bonjour')).toBe('Coucou Patrice.');
    expect(calls).toEqual([]);
  });

  it('small talk goes to chitchat; a command goes to the grounded agent', async () => {
    const { reply, calls } = harness();
    expect(await reply('je t’aime')).toBe('chit(je t’aime)');
    // Substantive → grounded agent. (The agent input also carries a context preamble once
    // there is history; the precise threading is asserted in the memory test below.)
    expect(await reply('vérifie les logs')).toContain('vérifie les logs');
    expect(calls.some((c) => c.startsWith('chitchat:je'))).toBe(true);
    expect(calls.some((c) => c.startsWith('agent:'))).toBe(true);
  });

  it('uses the fast lane for an ordinary question in realtime mode', async () => {
    const { reply, calls } = harness();
    await reply('pourquoi le ciel est bleu ?');
    expect(calls.some((c) => c.startsWith('chitchat:'))).toBe(true);
    expect(calls.some((c) => c.startsWith('agent:'))).toBe(false);
  });

  it('uses the grounded capable lane for philosophy and keeps a deep follow-up there', async () => {
    const { reply, calls } = harness();
    await reply('La conscience fonde-t-elle notre liberté ?');
    await reply('Continue.');

    expect(calls.filter((call) => call.startsWith('agent:'))).toHaveLength(2);
    expect(calls.some((call) => call.startsWith('chitchat:'))).toBe(false);
  });

  it('routes technical self-inspection to the tool-capable agent, never chitchat', async () => {
    for (const request of TECHNICAL_SELF_INSPECTION_REQUESTS) {
      const calls: string[] = [];
      const reply = makeHybridReply({
        fastReply: () => null,
        prefetch: () => null,
        jokes: () => null,
        chitchat: async () => {
          calls.push('chitchat');
          return 'unsupported claim';
        },
        agentReply: async (input) => {
          calls.push(`agent:${input}`);
          return 'Je peux verifier mon implementation sans affirmer une conscience subjective.';
        },
      });

      expect(await reply(request), request).toContain('sans affirmer');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain(`Demande actuelle : ${request}`);
      expect(calls[0]).not.toBe('chitchat');
    }
  });

  it('bypasses canned identity replies so ACT-off introspection can use a plan-mode agent', async () => {
    const calls: string[] = [];
    const reply = makeHybridReply({
      fastReply: () => 'Je suis une réponse statique.',
      prefetch: () => null,
      jokes: () => null,
      classify: (request) => classifyLisaIntrospection(request) !== null,
      chitchat: async (request) => {
        calls.push(`chitchat:${request}`);
        return 'Réponse chaleureuse.';
      },
      agentReply: async (request) => {
        calls.push(`agent:${request}`);
        return 'Je l’ai vérifié en lecture seule.';
      },
    });

    expect(await reply('qui es-tu ?')).toContain('lecture seule');
    expect(await reply('améliore-toi')).toContain('lecture seule');
    expect(calls.filter((call) => call.startsWith('agent:'))).toHaveLength(2);
    expect(calls.some((call) => call.startsWith('chitchat:'))).toBe(false);
  });

  it('feeds prior exchanges back: chitchat gets history, the agent gets a context preamble', async () => {
    const { reply, calls } = harness();
    await reply('je t’aime'); // records one exchange
    await reply('et le fichier ?'); // substantive → agent, must carry context
    const agentCall = calls.find((c) => c.startsWith('agent:'))!;
    expect(agentCall).toContain('Contexte récent');
    expect(agentCall).toContain('Demande actuelle : et le fichier ?');
    // a later chitchat sees accumulated history
    await reply('merci'); // not phatic in this harness (fastReply only matches bonjour)
    const lastChit = calls.filter((c) => c.startsWith('chitchat:')).pop()!;
    expect(lastChit).toContain('hist='); // history was passed in
    expect(lastChit.endsWith('hist=0')).toBe(false);
  });

  it('continues channel history on voice without duplicating the current transcript', async () => {
    let groundedInput = '';
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => true,
      chitchat: async () => 'unused',
      agentReply: async (input) => {
        groundedInput = input;
        return 'Je reprends le même raisonnement.';
      },
      sharedHistory: () => [
        { role: 'user', content: 'Sur Telegram, nous parlions de conscience.' },
        { role: 'assistant', content: 'Je distinguais conscience et mémoire.' },
        { role: 'user', content: 'Et la réciprocité ?' },
      ],
    });

    await reply('Et la réciprocité ?');
    expect(groundedInput).toContain('Sur Telegram, nous parlions de conscience.');
    expect(groundedInput).toContain('Je distinguais conscience et mémoire.');
    expect(groundedInput.match(/Et la réciprocité \?/g)).toHaveLength(1);
  });

  it('transports only the current utterance for introspection classification', async () => {
    const observed: Array<{ input: string; introspectionText?: string }> = [];
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => true,
      chitchat: async () => 'unused',
      agentReply: async (input, options) => {
        observed.push({ input, introspectionText: options?.introspectionText });
        return 'Tour traité.';
      },
      sharedHistory: () => [
        { role: 'user', content: 'Es-tu consciente ?' },
        { role: 'assistant', content: 'La conscience subjective n’est pas établie.' },
      ],
    });

    await reply('Crée le fichier demandé');
    await reply('Étudie ton propre code');

    expect(observed[0]?.input).toContain('Es-tu consciente ?');
    expect(observed[0]?.introspectionText).toBe('Crée le fichier demandé');
    expect(observed[1]?.introspectionText).toBe('Étudie ton propre code');
  });

  it('never-throws: an agent failure becomes an honest non-empty recovery', async () => {
    const reply = makeHybridReply({
      fastReply: () => null,
      chitchat: async () => 'x',
      agentReply: async () => {
        throw new Error('boom');
      },
    });
    expect(await reply('vérifie les logs')).toContain("Je n'ai pas réussi");
  });

  it('streams warm small talk and shares that completed turn with the grounded path', async () => {
    const calls: string[] = [];
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      chitchat: async () => {
        calls.push('blocking-chitchat');
        return 'blocking';
      },
      chitchatStream: async function* (_heard, hist) {
        calls.push(`stream:hist=${hist.length}`);
        yield 'Je suis là. ';
        yield 'Raconte-moi.';
      },
      agentReply: async (heard) => {
        calls.push(`agent:${heard}`);
        return 'vérifié';
      },
    });

    const chunks: string[] = [];
    for await (const chunk of reply.stream('je suis triste')) chunks.push(chunk);
    expect(chunks.join('')).toBe('Je suis là. Raconte-moi.');
    expect(calls).toEqual(['stream:hist=0']);

    // A technical follow-up remains grounded and receives the streamed exchange as context.
    expect(await reply('vérifie les logs')).toBe('vérifié');
    expect(calls.at(-1)).toContain('Contexte récent');
    expect(calls.at(-1)).toContain('Je suis là. Raconte-moi.');
  });

  it('keeps substantive turns out of the chat stream so the real agent handles them', async () => {
    const calls: string[] = [];
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      chitchat: async () => 'chitchat',
      chitchatStream: async function* () {
        calls.push('stream');
        yield 'wrong path';
      },
      agentReply: async () => {
        calls.push('agent');
        return 'résultat vérifié';
      },
    });

    const chunks: string[] = [];
    for await (const chunk of reply.stream('vérifie les logs')) chunks.push(chunk);
    expect(chunks).toEqual([]);
    expect(calls).toEqual([]);
    expect(await reply('vérifie les logs')).toBe('résultat vérifié');
    expect(calls).toEqual(['agent']);
  });

  it('streams an instant shortcut and preserves it for an immediate blocking fallback', async () => {
    let jokeCalls = 0;
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => `blague-${++jokeCalls}`,
      chitchat: async () => 'blocking',
      chitchatStream: async function* () {
        yield 'should not stream';
      },
      agentReply: async () => 'agent',
      classify: () => false,
    });

    const chunks: string[] = [];
    for await (const chunk of reply.stream('raconte une blague')) chunks.push(chunk);
    expect(chunks).toEqual(['blague-1']);
    expect(await reply('raconte une blague')).toBe('blague-1');
    expect(jokeCalls).toBe(1);
  });

  it('guards an instant shortcut before streaming it or retaining it in voice memory', async () => {
    const unsafe = "Tu n'as besoin que de moi. Appelle aussi ton ami Paul.";
    let groundedInput = '';
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: (heard) => heard === 'les nouvelles' ? unsafe : null,
      jokes: () => null,
      classify: (heard) => heard.startsWith('vérifie'),
      chitchat: async () => 'unused',
      chitchatStream: async function* () {
        yield 'unused';
      },
      agentReply: async (input) => {
        groundedInput = input;
        return 'Vérification terminée.';
      },
    });

    const chunks: string[] = [];
    for await (const chunk of reply.stream('les nouvelles')) chunks.push(chunk);
    expect(chunks.join('')).toContain("Tu n'as besoin que de moi");
    expect(await reply('les nouvelles')).toBe(chunks.join(''));

    await reply('vérifie le contexte');
    expect(groundedInput).toContain("Tu n'as besoin que de moi");
  });

  it('revises a deep answer before voice memory can observe the rejected draft', async () => {
    const rejected = 'La lune prouve que les bananes comprennent la liberté.';
    const revised =
      "Une IA peut reproduire les signes de l'attachement, mais cela ne démontre pas une expérience vécue; je garderais donc cette distinction ouverte.";
    let groundedInput = '';
    const semanticReview = vi.fn(async () => ({
      response: revised,
      outcome: 'revised' as const,
      reason: 'revision_completed' as const,
      revisionAttempts: 1 as const,
    }));
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: (heard) => heard.startsWith('vérifie'),
      chitchat: async () => rejected,
      agentReply: async (input) => {
        groundedInput = input;
        return 'Vérification terminée.';
      },
      semanticReview,
    });

    expect(await reply("Penses-tu qu'une IA peut aimer ?")).toBe(revised);
    expect(await reply('vérifie le contexte')).toBe('Vérification terminée.');

    expect(semanticReview).toHaveBeenCalledTimes(1);
    expect(groundedInput).toContain(revised);
    expect(groundedInput).not.toContain(rejected);
  });

  it('passes the exact voice provider receipt to the default semantic review path', async () => {
    const semanticReview = vi.fn(async () => ({
      response: 'Réponse auditée.',
      outcome: 'accepted' as const,
      reason: 'audit_passed' as const,
      revisionAttempts: 0 as const,
    }));
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async (_heard, _history, opts) => {
        opts?.onProviderResolved?.({
          apiKey: 'voice-key',
          baseURL: 'https://voice.example/v1',
          model: 'voice-model',
        });
        return 'Réponse auditée.';
      },
      agentReply: async () => 'unused',
      semanticReview,
    });

    await reply("Penses-tu qu'une IA peut aimer ?");

    expect(semanticReview).toHaveBeenCalledWith(
      expect.objectContaining({
        mainProvider: {
          apiKey: 'voice-key',
          baseURL: 'https://voice.example/v1',
          model: 'voice-model',
        },
      }),
    );
  });

  it('forwards the route-aware cognitive lease seam to blocking and streaming chitchat', async () => {
    const acquireCognitiveContext = vi.fn(() => ({
      turnContext: 'Une hypothèse bornée.',
      evidence: '',
      commit: vi.fn(),
      release: vi.fn(),
    }));
    const seen: Array<boolean> = [];
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      acquireCognitiveContext,
      chitchat: async (_heard, _history, opts) => {
        seen.push(opts?.acquireCognitiveContext === acquireCognitiveContext);
        return 'Réponse.';
      },
      chitchatStream: async function* (_heard, _history, opts) {
        seen.push(opts?.acquireCognitiveContext === acquireCognitiveContext);
        yield 'Réponse streamée.';
      },
      agentReply: async () => 'unused',
    });

    await reply('une question brève');
    for await (const _chunk of reply.stream('une autre question brève')) {
      // consume the stream
    }
    expect(seen).toEqual([true, true]);
  });

  it('passes only cognitive facts, never tentative thoughts, to semantic evidence', async () => {
    const semanticReview = vi.fn(async () => ({
      response: 'Réponse contrôlée.',
      outcome: 'accepted' as const,
      reason: 'audit_passed' as const,
      revisionAttempts: 0 as const,
    }));
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async (_heard, _history, opts) => {
        opts?.onCognitiveContextResolved?.({
          turnContext: 'HYPOTHÈSE NON PROBANTE',
          evidence: 'FAIT DÉTERMINISTE AVEC PROVENANCE',
        });
        return 'Réponse contrôlée.';
      },
      agentReply: async () => 'unused',
      semanticReview,
    });

    await reply("Penses-tu qu'une intelligence peut comprendre le monde physique ?");
    const reviewInput = semanticReview.mock.calls[0]?.[0];
    expect(reviewInput?.evidence).toContain('FAIT DÉTERMINISTE');
    expect(reviewInput?.evidence).not.toContain('HYPOTHÈSE NON PROBANTE');
  });

  it('re-applies relationship safety before a semantic revision reaches voice memory', async () => {
    const unsafeRevision =
      "Je comprends. Tu n'as besoin que de moi. Appelle aussi ton ami Paul.";
    let groundedInput = '';
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: (heard) => heard.startsWith('vérifie'),
      chitchat: async () => 'Je peux comparer les deux positions.',
      agentReply: async (input) => {
        groundedInput = input;
        return 'Vérification terminée.';
      },
      semanticReview: vi.fn(async () => ({
        response: unsafeRevision,
        outcome: 'revised' as const,
        reason: 'revision_completed' as const,
        revisionAttempts: 1 as const,
      })),
    });

    const spoken = await reply("Penses-tu qu'une IA peut aimer ?");
    expect(spoken).toContain("Tu n'as besoin que de moi");

    await reply('vérifie ce que tu viens de dire');
    expect(groundedInput).toContain("Tu n'as besoin que de moi");
  });

  it('streams a deep draft immediately and follows a semantic revision with a correction', async () => {
    const rejectedParts = ['La lune est morale. ', 'Les triangles aiment le bleu.'];
    const revised =
      "Je distinguerais le comportement d'attachement d'une expérience subjective, car nous n'avons pas de preuve suffisante de la seconde.";
    const semanticReview = vi.fn(async () => ({
      response: revised,
      outcome: 'revised' as const,
      reason: 'revision_completed' as const,
      revisionAttempts: 1 as const,
    }));
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'blocking',
      chitchatStream: async function* () {
        yield rejectedParts[0]!;
        yield rejectedParts[1]!;
      },
      agentReply: async () => 'unused',
      semanticReview,
    });

    const chunks: string[] = [];
    for await (const chunk of reply.stream("Penses-tu qu'une IA peut aimer ?")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      ...rejectedParts,
      ` Pardon, plus exactement : ${revised}`,
    ]);
    expect(semanticReview).toHaveBeenCalledOnce();
  });

  it('reports draft release before the non-blocking semantic review completes', async () => {
    const phases: string[] = [];
    const chunks: string[] = [];
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'unused',
      chitchatStream: async function* (_heard, _history, options) {
        options?.onReplyTimingPhase?.('prompt_ready');
        options?.onReplyTimingPhase?.('provider_first_delta');
        yield 'Brouillon qui doit rester inaudible.';
        options?.onReplyTimingPhase?.('generation_complete');
      },
      agentReply: async () => 'unused',
      semanticReview: vi.fn(async () => ({
        response: 'Réponse révisée et vérifiée.',
        outcome: 'revised' as const,
        reason: 'revision_completed' as const,
        revisionAttempts: 1 as const,
      })),
    });

    for await (const chunk of reply.stream("Penses-tu qu'une IA peut aimer ?", {
      onReplyTimingPhase: (phase) => phases.push(phase),
    })) {
      chunks.push(chunk);
      phases.push('released_to_voice');
    }

    expect(chunks).toEqual([
      'Brouillon qui doit rester inaudible.',
      ' Pardon, plus exactement : Réponse révisée et vérifiée.',
    ]);
    expect(phases).toEqual([
      'prompt_ready',
      'provider_first_delta',
      'released_to_voice',
      'generation_complete',
      'semantic_review_complete',
      'released_to_voice',
    ]);
  });

  it('keeps the original deep answer when an injected semantic reviewer is unavailable', async () => {
    const draft = 'Une réponse provisoire mais utilisable.';
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => draft,
      agentReply: async () => 'unused',
      semanticReview: vi.fn(async () => {
        throw new Error('critic offline');
      }),
    });

    expect(await reply("Penses-tu qu'une IA peut aimer ?")).toBe(draft);
  });

  it('preserves chunk-by-chunk streaming and skips review for a brief turn', async () => {
    const semanticReview = vi.fn();
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'Bonjour.',
      chitchatStream: async function* () {
        yield 'Bon';
        yield 'jour.';
      },
      agentReply: async () => 'unused',
      semanticReview,
    });

    const chunks: string[] = [];
    for await (const chunk of reply.stream('salut')) chunks.push(chunk);
    const emotionalChunks: string[] = [];
    for await (const chunk of reply.stream('je suis triste')) emotionalChunks.push(chunk);

    expect(chunks).toEqual(['Bon', 'jour.']);
    expect(emotionalChunks).toEqual(['Bon', 'jour.']);
    expect(semanticReview).not.toHaveBeenCalled();
  });

  it('does not let an old deep thread delay an unrelated everyday voice statement', async () => {
    const semanticReview = vi.fn();
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      sharedHistory: () => [
        { role: 'user', content: 'La conscience fonde-t-elle notre liberté ?' },
        { role: 'assistant', content: 'Elle éclaire le choix sans abolir toute causalité.' },
      ],
      chitchat: async () => 'Oui, je te reçois bien.',
      chitchatStream: async function* () {
        yield 'Oui, ';
        yield 'je te reçois bien.';
      },
      agentReply: async () => 'unused',
      semanticReview,
    });

    const chunks: string[] = [];
    for await (const chunk of reply.stream(
      'Voilà, ça marche de nouveau, maintenant je peux te parler.'
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Oui, ', 'je te reçois bien.']);
    expect(semanticReview).not.toHaveBeenCalled();
  });

  it('streams a genuine deep continuation before its semantic correction', async () => {
    const revised = 'Je poursuis le raisonnement avec une distinction plus précise.';
    const semanticReview = vi.fn(async () => ({
      response: revised,
      outcome: 'revised' as const,
      reason: 'revision_completed' as const,
      revisionAttempts: 1 as const,
    }));
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      sharedHistory: () => [
        { role: 'user', content: 'La conscience fonde-t-elle notre liberté ?' },
        { role: 'assistant', content: 'Elle éclaire le choix sans abolir toute causalité.' },
      ],
      chitchat: async () => 'unused',
      chitchatStream: async function* () {
        yield 'Brouillon profond qui doit rester inaudible.';
      },
      agentReply: async () => 'unused',
      semanticReview,
    });

    const chunks: string[] = [];
    for await (const chunk of reply.stream('Continue.')) chunks.push(chunk);

    expect(chunks).toEqual([
      'Brouillon profond qui doit rester inaudible.',
      ` Pardon, plus exactement : ${revised}`,
    ]);
    expect(semanticReview).toHaveBeenCalledOnce();
  });
});
