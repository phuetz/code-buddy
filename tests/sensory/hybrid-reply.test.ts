import { describe, it, expect, vi } from 'vitest';
import {
  isSubstantiveQuery,
  requiresGroundedAgentQuery,
  buildContextPreamble,
  makeHybridReply,
  type HybridTurn,
} from '../../src/sensory/hybrid-reply.js';

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
});

describe('hybrid reply — realtime grounded-agent gate', () => {
  it('keeps ordinary static questions on the fast streaming model', () => {
    for (const s of [
      'pourquoi le ciel est bleu ?',
      'explique-moi la photosynthèse',
      'quel est le sens de ce proverbe ?',
      'aide-moi, je ne sais pas quoi choisir',
    ]) {
      expect(requiresGroundedAgentQuery(s), s).toBe(false);
    }
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
    await hybrid.prewarm();
    hybrid.dispose();
    expect(prewarm).toHaveBeenCalledOnce();
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
});
