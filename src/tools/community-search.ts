/**
 * Recherche communautaire : ce que les GENS disent, pas ce que les éditeurs publient.
 *
 * Pourquoi cet outil existe
 * -------------------------
 * `web-search.ts` couvre SearXNG, Brave, Perplexity, Serper et DuckDuckGo. Tous
 * indexent des pages publiées. Aucun n'atteint un commentaire Reddit, un fil
 * Hacker News, une cote de marché ou un dépôt qui vient d'apparaître — c'est-à-
 * dire l'endroit où l'information existe AVANT d'être rédigée par quelqu'un.
 *
 * L'idée vient de `github.com/mvanhorn/last30days-skill`, dont la formule tient
 * en une ligne : « Google agrège les éditeurs, nous cherchons les gens. » Le code
 * n'en est pas repris — cette skill est en Python et porte des scripts, ce que le
 * pare-feu à skills quarantaine à juste titre. Ce qui est repris, c'est le
 * principe et le choix des sources.
 *
 * Ce qu'il interroge, et ce que ça coûte
 * ---------------------------------------
 * Cinq sources, TOUTES GRATUITES ET SANS CLÉ :
 *
 *   Hacker News    fils techniques                     Algolia, API publique
 *   Stack Exchange questions réelles, votées           API publique (300/jour)
 *   GitHub         dépôts, activité récente            API publique (60 req/h)
 *   arXiv          prépublications                     API publique
 *   Reddit         discussions et votes                API publique — VOIR PLUS BAS
 *
 * Deux constats de terrain, faits en interrogeant vraiment ces API depuis la
 * France le 6 août 2026 :
 *
 *   - REDDIT REND 403 sans authentification, quel que soit l'agent déclaré.
 *     La source est gardée parce que le blocage dépend du réseau et peut lever,
 *     et parce qu'une source absente doit se DIRE plutôt que disparaître. Elle
 *     est simplement rapportée comme indisponible.
 *   - POLYMARKET EST BLOQUÉ EN FRANCE : son DNS renvoie vers
 *     `offre-illegale.anj.fr`. Ce n'est pas une panne, c'est une décision de
 *     l'Autorité nationale des jeux. La source a été retirée, remplacée par
 *     Stack Exchange. Aucun contournement n'est proposé.
 *
 * Aucune n'exige d'inscription, de clé ni de cookie de navigateur. C'est
 * délibéré : la skill amont propose aussi X, TikTok et Instagram, qui demandent
 * soit une clé payante, soit l'extraction des cookies du navigateur de
 * l'utilisateur. Cette porte-là ne se franchit pas sans décision explicite.
 *
 * Ce qu'il ne fait pas
 * --------------------
 * Il ne juge pas. Il rapporte ce qui a été dit, avec son score d'engagement et sa
 * date, et laisse le modèle synthétiser. Un fil très voté n'est pas une vérité :
 * c'est un fait social, et l'outil le présente comme tel.
 */

import { assertSafeUrl } from '../security/ssrf-guard.js';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types/index.js';

const TIMEOUT_MS = 12_000;

/**
 * Reddit refuse les requêtes sans agent identifiable, et GitHub limite plus
 * durement les anonymes. Un agent explicite est la politesse minimale envers des
 * API qu'on interroge gratuitement.
 */
const USER_AGENT = 'code-buddy/1.1 (community-search)';

export interface CommunityHit {
  source: 'reddit' | 'hackernews' | 'stackexchange' | 'github' | 'arxiv';
  title: string;
  url: string;
  /** Score d'engagement dans l'unité de la source — votes, points, étoiles. */
  engagement: number;
  /** Ce que l'unité veut dire, pour que le modèle ne compare pas des pommes et des poires. */
  engagementUnit: string;
  /** ISO 8601, ou null quand la source ne le donne pas. */
  publishedAt: string | null;
  /** Extrait ou métadonnée courte. Jamais l'article entier. */
  excerpt?: string;
}

interface SourceResult {
  hits: CommunityHit[];
  error?: string;
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  // Le garde SSRF s'applique ici comme partout ailleurs : ces hôtes sont publics
  // et stables, mais l'URL est construite à partir d'une requête utilisateur.
  const check = await assertSafeUrl(url);
  if (!check.safe) {
    throw new Error(`URL bloquée par le garde SSRF : ${check.reason}`);
  }

  const response = await fetch(url, {
    signal,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function daysAgoIso(days: number): number {
  return Math.floor((Date.now() - days * 86_400_000) / 1000);
}

// --- Les sources ------------------------------------------------------------

async function searchReddit(query: string, days: number, signal: AbortSignal): Promise<SourceResult> {
  // `t=` n'accepte que des paliers ; on prend le plus proche au-dessus de la
  // fenêtre demandée, puis on filtre nous-mêmes sur la date exacte.
  const palier = days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 31 ? 'month' : 'year';
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}`
    + `&sort=top&t=${palier}&limit=25`;

  const data = (await fetchJson(url, signal)) as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> };
  };
  const seuil = daysAgoIso(days);

  const hits: CommunityHit[] = [];
  for (const child of data.data?.children ?? []) {
    const p = child.data;
    if (!p) continue;
    const created = typeof p.created_utc === 'number' ? p.created_utc : 0;
    if (created < seuil) continue;
    hits.push({
      source: 'reddit',
      title: String(p.title ?? ''),
      url: `https://www.reddit.com${String(p.permalink ?? '')}`,
      engagement: Number(p.score ?? 0),
      engagementUnit: 'votes',
      publishedAt: created ? new Date(created * 1000).toISOString() : null,
      excerpt: [
        p.subreddit ? `r/${String(p.subreddit)}` : null,
        p.num_comments ? `${String(p.num_comments)} commentaires` : null,
      ].filter(Boolean).join(' · ') || undefined,
    });
  }
  return { hits };
}

async function searchHackerNews(query: string, days: number, signal: AbortSignal): Promise<SourceResult> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}`
    + `&tags=story&numericFilters=created_at_i>${daysAgoIso(days)}&hitsPerPage=20`;

  const data = (await fetchJson(url, signal)) as {
    hits?: Array<Record<string, unknown>>;
  };

  return {
    hits: (data.hits ?? []).map((h) => ({
      source: 'hackernews' as const,
      title: String(h.title ?? h.story_title ?? ''),
      // Un fil sans lien externe vaut par sa discussion : on pointe la discussion.
      url: String(h.url ?? `https://news.ycombinator.com/item?id=${String(h.objectID ?? '')}`),
      engagement: Number(h.points ?? 0),
      engagementUnit: 'points',
      publishedAt: h.created_at ? String(h.created_at) : null,
      excerpt: h.num_comments ? `${String(h.num_comments)} commentaires` : undefined,
    })),
  };
}

async function searchStackExchange(query: string, days: number, signal: AbortSignal): Promise<SourceResult> {
  // Remplace Polymarket, qui figurait au départ pour une bonne raison — un marché
  // de prédiction dit ce que des gens sont prêts à PAYER pour avoir raison, ce
  // qui est une opinion coûteuse donc informative.
  //
  // Il est retiré pour une raison qui n'a rien de technique : POLYMARKET EST
  // BLOQUÉ EN FRANCE. Le DNS de `gamma-api.polymarket.com` renvoie vers
  // `offre-illegale.anj.fr` — l'Autorité nationale des jeux le classe comme offre
  // illégale. Aucun contournement n'est proposé ici : ce serait sortir du rôle de
  // l'outil.
  //
  // Stack Exchange le remplace utilement : des questions réelles, votées par des
  // gens qui avaient le problème. Gratuit, sans clé, 300 requêtes par jour.
  const depuis = daysAgoIso(days);
  const url = 'https://api.stackexchange.com/2.3/search/advanced'
    + `?order=desc&sort=votes&q=${encodeURIComponent(query)}`
    + `&fromdate=${depuis}&site=stackoverflow&pagesize=15`;

  const data = (await fetchJson(url, signal)) as { items?: Array<Record<string, unknown>> };

  return {
    hits: (data.items ?? []).map((q) => ({
      source: 'stackexchange' as const,
      title: String(q.title ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
      url: String(q.link ?? ''),
      engagement: Number(q.score ?? 0),
      engagementUnit: 'votes',
      publishedAt: q.creation_date
        ? new Date(Number(q.creation_date) * 1000).toISOString()
        : null,
      excerpt: [
        q.is_answered ? 'résolue' : 'sans réponse acceptée',
        q.answer_count ? `${String(q.answer_count)} réponses` : null,
      ].filter(Boolean).join(' · ') || undefined,
    })),
  };
}

async function searchGitHub(query: string, days: number, signal: AbortSignal): Promise<SourceResult> {
  const depuis = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const url = 'https://api.github.com/search/repositories?q='
    + encodeURIComponent(`${query} pushed:>${depuis}`)
    + '&sort=stars&order=desc&per_page=15';

  const data = (await fetchJson(url, signal)) as { items?: Array<Record<string, unknown>> };

  return {
    hits: (data.items ?? []).map((r) => ({
      source: 'github' as const,
      title: String(r.full_name ?? ''),
      url: String(r.html_url ?? ''),
      engagement: Number(r.stargazers_count ?? 0),
      engagementUnit: 'étoiles',
      publishedAt: r.pushed_at ? String(r.pushed_at) : null,
      excerpt: r.description ? String(r.description).slice(0, 180) : undefined,
    })),
  };
}

async function searchArxiv(query: string, days: number, signal: AbortSignal): Promise<SourceResult> {
  // arXiv rend de l'Atom, pas du JSON : on extrait au motif plutôt que d'ajouter
  // une dépendance XML pour cinq champs.
  const url = 'http://export.arxiv.org/api/query?search_query='
    + encodeURIComponent(`all:${query}`)
    + '&sortBy=submittedDate&sortOrder=descending&max_results=12';

  const check = await assertSafeUrl(url);
  if (!check.safe) throw new Error(`URL bloquée par le garde SSRF : ${check.reason}`);

  const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();

  const seuil = Date.now() - days * 86_400_000;
  const hits: CommunityHit[] = [];
  for (const entree of xml.split('<entry>').slice(1)) {
    const titre = /<title>([\s\S]*?)<\/title>/.exec(entree)?.[1]?.trim().replace(/\s+/g, ' ');
    const lien = /<id>([\s\S]*?)<\/id>/.exec(entree)?.[1]?.trim();
    const date = /<published>([\s\S]*?)<\/published>/.exec(entree)?.[1]?.trim();
    if (!titre || !lien) continue;
    if (date && Date.parse(date) < seuil) continue;
    hits.push({
      source: 'arxiv',
      title: titre,
      url: lien,
      // arXiv ne publie pas de compteur d'engagement : mettre 0 plutôt
      // qu'inventer un score. Le classement les placera en fin, ce qui est
      // honnête — leur intérêt est la fraîcheur, pas la popularité.
      engagement: 0,
      engagementUnit: 'aucun score public',
      publishedAt: date ?? null,
    });
  }
  return { hits };
}

const SOURCES = {
  reddit: searchReddit,
  hackernews: searchHackerNews,
  stackexchange: searchStackExchange,
  github: searchGitHub,
  arxiv: searchArxiv,
} as const;

export type CommunitySource = keyof typeof SOURCES;

// --- Le classement ----------------------------------------------------------

/**
 * Classer des sources qui ne comptent pas la même chose.
 *
 * Cent votes Reddit, cent points Hacker News et cent étoiles GitHub ne valent pas
 * la même chose, et aucune conversion honnête n'existe entre elles. On classe
 * donc PAR RANG DANS SA PROPRE SOURCE, puis on entrelace — la meilleure de
 * chaque source d'abord, la deuxième de chaque source ensuite.
 *
 * C'est moins malin qu'un score unifié, et c'est précisément pour cela que c'est
 * mieux : un score unifié donnerait une fausse précision à une comparaison qui
 * n'a pas de sens.
 */
function entrelacer(parSource: Map<CommunitySource, CommunityHit[]>, max: number): CommunityHit[] {
  for (const hits of parSource.values()) {
    hits.sort((a, b) => {
      if (b.engagement !== a.engagement) return b.engagement - a.engagement;
      return (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0);
    });
  }

  const sorties: CommunityHit[] = [];
  const vues = new Set<string>();
  const profondeurMax = Math.max(0, ...[...parSource.values()].map((h) => h.length));

  for (let rang = 0; rang < profondeurMax && sorties.length < max; rang += 1) {
    for (const hits of parSource.values()) {
      const hit = hits[rang];
      if (!hit || sorties.length >= max) continue;
      // Une même URL peut remonter de deux sources : on garde la première.
      if (vues.has(hit.url)) continue;
      vues.add(hit.url);
      sorties.push(hit);
    }
  }
  return sorties;
}

function rendre(hits: CommunityHit[], erreurs: string[], query: string, days: number): string {
  if (!hits.length) {
    return `Aucune discussion trouvée sur « ${query} » dans les ${days} derniers jours.\n`
      + (erreurs.length ? `\nSources indisponibles : ${erreurs.join(' · ')}\n` : '')
      + '\nCe silence est une information : soit le sujet n’est pas discuté publiquement, '
      + 'soit il est nommé autrement. Ne pas le combler par une recherche web — ce serait '
      + 'répondre à une autre question.';
  }

  const lignes = [`${hits.length} discussion(s) sur « ${query} », ${days} derniers jours.`, ''];
  for (const h of hits) {
    const quand = h.publishedAt ? new Date(h.publishedAt).toISOString().slice(0, 10) : 'date inconnue';
    const score = h.engagement > 0 ? `${h.engagement} ${h.engagementUnit}` : h.engagementUnit;
    lignes.push(`[${h.source}] ${h.title}`);
    lignes.push(`  ${score} · ${quand} · ${h.url}`);
    if (h.excerpt) lignes.push(`  ${h.excerpt}`);
    lignes.push('');
  }

  if (erreurs.length) {
    lignes.push(`Sources indisponibles : ${erreurs.join(' · ')}`);
    lignes.push('');
  }
  lignes.push('Les scores mesurent l’engagement, pas la véracité : un fil très voté '
    + 'dit ce que des gens pensent, pas ce qui est vrai.');
  return lignes.join('\n');
}

export interface CommunitySearchOptions {
  /** Fenêtre en jours. 30 par défaut — au-delà, ce n'est plus de l'actualité. */
  days?: number;
  /** Sous-ensemble de sources. Toutes par défaut. */
  sources?: CommunitySource[];
  /** Nombre de résultats rendus. */
  limit?: number;
}

export class CommunitySearchTool {
  async search(query: string, options: CommunitySearchOptions = {}): Promise<ToolResult> {
    const terme = query.trim();
    if (!terme) {
      return { success: false, output: '', error: 'Requête vide' };
    }

    const days = Math.max(1, Math.min(365, options.days ?? 30));
    const limit = Math.max(1, Math.min(60, options.limit ?? 25));
    const choisies = options.sources?.length
      ? options.sources.filter((s) => s in SOURCES)
      : (Object.keys(SOURCES) as CommunitySource[]);

    if (!choisies.length) {
      return { success: false, output: '', error: 'Aucune source valide demandée' };
    }

    const controller = new AbortController();
    const minuteur = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // Toutes les sources en parallèle : la plus lente ne doit pas décider du
      // temps total, et une source morte ne doit pas emporter les autres.
      const resultats = await Promise.allSettled(
        choisies.map((s) => SOURCES[s](terme, days, controller.signal)),
      );

      const parSource = new Map<CommunitySource, CommunityHit[]>();
      const erreurs: string[] = [];

      resultats.forEach((r, i) => {
        const nom = choisies[i]!;
        if (r.status === 'fulfilled') {
          parSource.set(nom, r.value.hits);
        } else {
          const raison = r.reason instanceof Error ? r.reason.message : String(r.reason);
          erreurs.push(`${nom} (${raison})`);
          logger.warn(`community_search: ${nom} indisponible`, { raison });
        }
      });

      const hits = entrelacer(parSource, limit);
      return {
        success: true,
        output: rendre(hits, erreurs, terme, days),
        data: { query: terme, days, hits, unavailable: erreurs },
      };
    } finally {
      clearTimeout(minuteur);
    }
  }
}

export const communitySearchTool = new CommunitySearchTool();
