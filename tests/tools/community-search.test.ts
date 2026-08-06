/**
 * La recherche communautaire : ce que les gens disent, pas ce que les éditeurs
 * publient.
 *
 * Ces tests n'appellent aucune API réelle — `fetch` est simulé. Ce qu'ils
 * vérifient est le comportement qu'on ne peut PAS tester en interrogeant le
 * réseau : qu'une source morte n'emporte pas les autres, qu'un silence se dise
 * au lieu d'être comblé, et que le classement n'invente pas de comparaison entre
 * des unités qui n'en admettent pas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/security/ssrf-guard.js', () => ({
  assertSafeUrl: vi.fn(async () => ({ safe: true })),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { CommunitySearchTool } = await import('../../src/tools/community-search.js');

const MAINTENANT = Math.floor(Date.now() / 1000);

function reponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** Un jeu de réponses par hôte, pour n'avoir à décrire que ce qui compte. */
function simuler(parHote: Record<string, unknown>, morts: string[] = []) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    for (const mort of morts) {
      if (u.includes(mort)) throw new Error('réseau injoignable');
    }
    for (const [hote, body] of Object.entries(parHote)) {
      if (u.includes(hote)) return reponse(body);
    }
    return reponse({}, false, 404);
  });
}

const HN_UN_RESULTAT = {
  hits: [{
    title: 'Un fil qui a fait parler',
    url: 'https://example.test/fil',
    points: 412,
    num_comments: 260,
    created_at: new Date(MAINTENANT * 1000).toISOString(),
    objectID: '1',
  }],
};

const GITHUB_UN_RESULTAT = {
  items: [{
    full_name: 'org/depot',
    html_url: 'https://github.test/org/depot',
    stargazers_count: 9100,
    pushed_at: new Date(MAINTENANT * 1000).toISOString(),
    description: 'Ce que fait le dépôt',
  }],
};

describe('community_search', () => {
  let fetchOriginal: typeof globalThis.fetch;

  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.clearAllMocks();
  });

  it('rend les discussions avec leur engagement et leur date', async () => {
    globalThis.fetch = simuler({ 'hn.algolia.com': HN_UN_RESULTAT }) as typeof fetch;

    const r = await new CommunitySearchTool().search('sujet', { sources: ['hackernews'] });

    expect(r.success).toBe(true);
    expect(r.output).toContain('Un fil qui a fait parler');
    expect(r.output).toContain('412 points');
    expect(r.output).toContain('260 commentaires');
  });

  it('une source morte n’emporte pas les autres', async () => {
    // C'est la propriété qui justifie le parallélisme : cinq sources
    // interrogées, une qui tombe, quatre qui répondent — le résultat doit
    // rester utile et DIRE ce qui manque.
    globalThis.fetch = simuler(
      { 'hn.algolia.com': HN_UN_RESULTAT, 'api.github.com': GITHUB_UN_RESULTAT },
      ['reddit.com'],
    ) as typeof fetch;

    const r = await new CommunitySearchTool().search('sujet', {
      sources: ['hackernews', 'github', 'reddit'],
    });

    expect(r.success).toBe(true);
    expect(r.output).toContain('Un fil qui a fait parler');
    expect(r.output).toContain('org/depot');
    expect(r.output).toContain('Sources indisponibles');
    expect(r.output).toContain('reddit');
  });

  it('un silence se dit, il ne se comble pas', async () => {
    // Zéro résultat n'est pas un échec : c'est une information. Le message doit
    // interdire explicitement d'aller chercher ailleurs pour meubler — ce serait
    // répondre à une autre question que celle posée.
    globalThis.fetch = simuler({ 'hn.algolia.com': { hits: [] } }) as typeof fetch;

    const r = await new CommunitySearchTool().search('sujet introuvable', {
      sources: ['hackernews'],
    });

    expect(r.success).toBe(true);
    expect(r.output).toContain('Aucune discussion');
    expect(r.output).toMatch(/silence est une information/);
  });

  it('entrelace les sources au lieu de comparer des unités incomparables', async () => {
    // 9 100 étoiles GitHub ne « valent » pas plus que 412 points Hacker News :
    // aucune conversion honnête n'existe. Le classement doit donc faire remonter
    // le meilleur de CHAQUE source avant le deuxième de n'importe laquelle.
    globalThis.fetch = simuler({
      'hn.algolia.com': {
        hits: [
          // URLs distinctes : deux résultats à la même URL sont volontairement
          // fusionnés par l'outil, ce qui rendrait ce test faux pour une raison
          // qui n'est pas celle qu'il mesure.
          { ...HN_UN_RESULTAT.hits[0], title: 'HN premier', url: 'https://example.test/a', points: 400, objectID: 'a' },
          { ...HN_UN_RESULTAT.hits[0], title: 'HN second', url: 'https://example.test/b', points: 300, objectID: 'b' },
        ],
      },
      'api.github.com': GITHUB_UN_RESULTAT,
    }) as typeof fetch;

    const r = await new CommunitySearchTool().search('sujet', {
      sources: ['hackernews', 'github'],
    });

    const lignes = (r.data as { hits: Array<{ source: string }> }).hits;
    expect(lignes[0]!.source).toBe('hackernews');
    expect(lignes[1]!.source).toBe('github');   // le dépôt passe AVANT le second HN
    expect(lignes[2]!.source).toBe('hackernews');
  });

  it('écarte ce qui est plus vieux que la fenêtre demandée', async () => {
    const vieux = MAINTENANT - 200 * 86_400;
    globalThis.fetch = simuler({
      'api.github.com': {
        items: [{
          full_name: 'org/abandonne',
          html_url: 'https://github.test/org/abandonne',
          stargazers_count: 50_000,
          pushed_at: new Date(vieux * 1000).toISOString(),
        }],
      },
    }) as typeof fetch;

    // GitHub filtre côté serveur via `pushed:>`, donc on vérifie que la requête
    // porte bien la borne — c'est elle qui fait le travail.
    await new CommunitySearchTool().search('sujet', { sources: ['github'], days: 7 });

    const appel = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0];
    expect(String(appel)).toContain('pushed');
  });

  it('refuse une requête vide plutôt que d’interroger cinq API pour rien', async () => {
    const r = await new CommunitySearchTool().search('   ');
    expect(r.success).toBe(false);
    expect(r.error).toContain('vide');
  });

  it('borne la fenêtre et le nombre de résultats', async () => {
    globalThis.fetch = simuler({ 'hn.algolia.com': HN_UN_RESULTAT }) as typeof fetch;

    const r = await new CommunitySearchTool().search('sujet', {
      sources: ['hackernews'],
      days: 99_999,
      limit: 10_000,
    });

    expect((r.data as { days: number }).days).toBe(365);
  });

  it('rappelle que l’engagement n’est pas la véracité', async () => {
    // Un fil très voté dit ce que des gens pensent, pas ce qui est vrai. L'outil
    // ne juge pas — mais il doit empêcher que son classement soit lu comme un
    // classement de vérité.
    globalThis.fetch = simuler({ 'hn.algolia.com': HN_UN_RESULTAT }) as typeof fetch;

    const r = await new CommunitySearchTool().search('sujet', { sources: ['hackernews'] });
    expect(r.output).toMatch(/engagement, pas la véracité/);
  });
});
