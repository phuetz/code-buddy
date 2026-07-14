import { describe, it, expect, vi } from 'vitest';
import {
  isSubstantiveQuery,
  requiresGroundedAgentQuery,
  isTechnicalSelfInspectionRequest,
  classifyLisaIntrospection,
  buildContextPreamble,
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
    expect(chunks.join('')).not.toContain("Tu n'as besoin que de moi");
    expect(chunks.join('')).toContain('sans remplacer les personnes');
    expect(await reply('les nouvelles')).toBe(chunks.join(''));

    await reply('vérifie le contexte');
    expect(groundedInput).not.toContain("Tu n'as besoin que de moi");
    expect(groundedInput).toContain('sans remplacer les personnes');
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
    expect(spoken).not.toContain("Tu n'as besoin que de moi");
    expect(spoken).toContain('sans remplacer les personnes');

    await reply('vérifie ce que tu viens de dire');
    expect(groundedInput).not.toContain("Tu n'as besoin que de moi");
    expect(groundedInput).toContain('sans remplacer les personnes');
  });

  it('buffers a deep stream so no rejected draft is emitted before semantic revision', async () => {
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

    expect(chunks).toEqual([revised]);
    expect(chunks.join('')).not.toContain('La lune');
    expect(chunks.join('')).not.toContain('triangles');
    expect(semanticReview).toHaveBeenCalledOnce();
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
});
