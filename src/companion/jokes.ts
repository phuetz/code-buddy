/**
 * Jokes — Lisa's humour capability. A curated list of clean, spoken-friendly
 * French jokes served INSTANTLY (no LLM) when the user asks, with anti-repetition,
 * plus an optional background LLM "top-up" pool for variety.
 *
 * Wired as an instant seam in the hybrid reply (before the slow agent path), so
 * "raconte-moi une blague" is answered immediately. Stores under
 * ~/.codebuddy/companion/ (voice-guidance.ts template): never-throws, bounded.
 *
 * @module companion/jokes
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Curated, clean, audibly-working French jokes (no spelling-only puns). */
export const CURATED_JOKES: string[] = [
  'Quel est le comble pour un électricien ? De ne pas être au courant.',
  'Que dit un escargot quand il croise une limace ? « Oh, un nudiste ! »',
  "Comment appelle-t-on un chien sans pattes ? On ne l'appelle pas, on va le chercher.",
  'Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon, ils tombent dans le bateau.',
  'Quel est le comble pour un jardinier ? De raconter des salades.',
  "Qu'est-ce qui est jaune et qui attend ? Jonathan.",
  "Pourquoi les poissons détestent-ils l'ordinateur ? Parce qu'ils ont peur du Net.",
  'Que fait une fraise sur un cheval ? Tagada, tagada.',
  'Quel est le sport le plus fruité ? La boxe : on y prend des pêches, des marrons et des pruneaux.',
  "Monsieur et Madame Térieur ont un fils. Comment s'appelle-t-il ? Alain. Alain Térieur.",
  'Pourquoi les vaches ferment-elles les yeux quand on les trait ? Pour garder le lait concentré.',
  "Quelle est la femelle du hamster ? L'Amsterdam.",
  "Qu'est-ce qui est vert et qui monte et descend ? Un petit pois dans un ascenseur.",
  "Pourquoi les squelettes ne se battent-ils jamais ? Parce qu'ils n'ont pas de tripes.",
  'Quel est le comble pour un joueur de bowling ? De perdre la boule.',
  'Comment appelle-t-on un chat tombé dans un pot de peinture le jour de Noël ? Un chat-peint de Noël.',
  "Deux frites discutent. L'une dit : « On est bien, dans l'huile ! » L'autre répond : « Oui… mais on va finir grillées. »",
  "Qu'est-ce qu'un yaourt qui fait de la musique ? Un yaourt à boire.",
  "Pourquoi le livre de mathématiques est-il triste ? Parce qu'il a trop de problèmes.",
  "Quel est le comble pour un marin ? D'avoir le mal de terre.",
  "Comment fait-on pleurer un légume ? On lui raconte une histoire d'oignons.",
  "Que se disent deux chats amoureux ? « On est faits l'un pour l'autre, c'est félin. »",
  "Pourquoi les canards sont-ils toujours à l'heure ? Parce qu'ils ont un bec… d'horloge.",
  "Quel est l'animal le plus heureux ? Le hibou, parce que sa femme est chouette.",
  "Qu'est-ce qui est petit, carré et jaune ? Un petit carré jaune.",
  'Un zéro dit à un huit : « Joli, ta ceinture ! »',
  "Pourquoi les abeilles ont-elles les cheveux collants ? Parce qu'elles utilisent du miel comme gel.",
  'Quel est le comble pour un pêcheur ? De ne pas avoir un thon de voix.',
  "Que dit un oignon quand il se cogne ? « Aïe… j'ai les larmes aux yeux. »",
  'Comment appelle-t-on un dinosaure qui dort ? Un dino-ronfle.',
];

const MAX_TOLD = 20;
const MAX_POOL = 60;

// ---------------------------------------------------------------------------
// Request detection (pure)
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const JOKE_REQUEST =
  /\b(raconte (moi )?(une |une autre )?blague|(fais|dis) moi (une |une autre )?blague|une (autre )?blague|tu connais (une |des )?blagues?|fais moi rire|raconte (moi )?(quelque chose de |un truc )?dr[oô]le|dis moi (quelque chose de |un truc )?dr[oô]le)\b/;

/** True when the utterance asks for a joke. Pure, STT-robust. */
export function isJokeRequest(heard: string): boolean {
  const t = norm(heard);
  return t.length > 0 && JOKE_REQUEST.test(t);
}

/** Pick a joke not in the recent ring (falls back to any if all are recent). Pure. */
export function pickJoke(
  pool: string[],
  recent: string[] = [],
  rng: () => number = Math.random
): string | null {
  const jokes = pool.filter((j) => j && j.trim());
  if (jokes.length === 0) return null;
  const fresh = jokes.filter((j) => !recent.includes(j));
  const candidates = fresh.length > 0 ? fresh : jokes;
  return candidates[Math.floor(rng() * candidates.length) % candidates.length] ?? candidates[0]!;
}

// ---------------------------------------------------------------------------
// Stores (JSON under ~/.codebuddy/companion/)
// ---------------------------------------------------------------------------

function storePath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[`CODEBUDDY_JOKES_${name.toUpperCase().replace(/-/g, '_')}_FILE`];
  return override?.trim() || join(homedir(), '.codebuddy', 'companion', `jokes-${name}.json`);
}

function loadList(path: string): string[] {
  try {
    if (!existsSync(path)) return [];
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function saveList(path: string, items: string[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(items, null, 2));
  } catch {
    /* best-effort */
  }
}

export function loadJokePool(env: NodeJS.ProcessEnv = process.env): string[] {
  return loadList(storePath('pool', env));
}

/** The full pool to draw from: curated jokes + any background LLM top-ups. */
export function effectiveJokePool(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...CURATED_JOKES, ...loadJokePool(env)];
}

/**
 * Pick the next joke (anti-repeat across sessions) and record it. never-throws.
 * Returns null only if there is genuinely no joke available.
 */
export function nextJoke(env: NodeJS.ProcessEnv = process.env): string | null {
  const toldPath = storePath('told', env);
  const told = loadList(toldPath);
  const joke = pickJoke(effectiveJokePool(env), told);
  if (!joke) return null;
  saveList(toldPath, [...told.filter((j) => j !== joke), joke].slice(-MAX_TOLD));
  return joke;
}

export interface JokeTopupDeps {
  /** Injectable LLM: returns raw JSON text {"jokes": string[]}. Default: ChatGPT-OAuth. */
  chat?: (system: string, user: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

const TOPUP_SYSTEM =
  'Tu génères des blagues COURTES, PROPRES et en FRANÇAIS, adaptées à être DITES à voix haute ' +
  "(pas de jeu de mots qui repose sur l'orthographe). Réponds STRICTEMENT en JSON : " +
  '{"jokes": ["blague 1", "blague 2", "blague 3"]}. 3 à 5 blagues, aucune répétition, aucun contenu offensant.';

/** Generate a few fresh jokes and append them to the pool (dedup, capped). never-throws. */
export async function refreshJokePool(deps: JokeTopupDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  try {
    const chat = deps.chat ?? (await defaultChat());
    if (!chat) return 0;
    const { generateJsonWithRetry } = await import('../utils/llm-retry.js');
    const gen = (p: string): Promise<string> => chat(TOPUP_SYSTEM, p);
    const parsed = await generateJsonWithRetry<{ jokes?: unknown }>(
      gen,
      'Donne-moi de nouvelles blagues variées.'
    );
    const fresh = Array.isArray(parsed?.jokes)
      ? parsed.jokes.map((j) => (typeof j === 'string' ? j.trim() : '')).filter(Boolean)
      : [];
    if (fresh.length === 0) return 0;
    const poolPath = storePath('pool', env);
    const existing = loadList(poolPath);
    const seen = new Set([...CURATED_JOKES, ...existing].map((j) => j.toLowerCase()));
    const added = fresh.filter((j) => !seen.has(j.toLowerCase()));
    if (added.length === 0) return 0;
    saveList(poolPath, [...existing, ...added].slice(-MAX_POOL));
    return added.length;
  } catch {
    return 0;
  }
}

async function defaultChat(): Promise<((s: string, u: string) => Promise<string>) | null> {
  try {
    const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
    const resolved = resolveCommandProvider({});
    if (!resolved) return null;
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);
    return async (system: string, user: string) => {
      const resp = await client.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        undefined,
        { responseFormat: 'json' }
      );
      return resp?.choices?.[0]?.message?.content ?? '';
    };
  } catch {
    return null;
  }
}
