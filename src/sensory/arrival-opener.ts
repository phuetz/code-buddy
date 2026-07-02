/**
 * Arrival opener — what the companion SAYS when it sees you on the camera. Replaces the single
 * fixed `persona.greeting` (which made it say the exact same line every time) with a varied,
 * context-aware opener, modelled on MySoulmate's proactiveMessageService (context-driven trigger →
 * multiple templates → interpolation) + anti-repetition (avoid the recently-used lines) + a mix of
 * speech acts (not always a question — observations and warm statements too).
 *
 * Pure + deterministic-testable: pass `now`, `lastSeenAt`, `recent`, and an `rng`. Best-practice
 * basis: vary text, be context-aware, don't over-greet, avoid recency. No LLM here (instant, $0);
 * an LLM opener can be layered on top by the caller for extra freshness.
 *
 * @module sensory/arrival-opener
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { withTimeout } from '../council/with-timeout.js';

export type ArrivalTrigger = 'morning' | 'afternoon' | 'evening' | 'night' | 'backSoon' | 'drowsy';

export interface ArrivalContext {
  now: number;
  /** Epoch ms the person was last seen (for the gap). null/undefined → treat as a fresh arrival. */
  lastSeenAt?: number | null;
  /** Recently-used opener texts to avoid (anti-repetition ring). */
  recent?: string[];
  /** Optional name to address (e.g. "Patrice"). */
  name?: string;
  /** Detected state from the vision event (e.g. drowsy). */
  drowsy?: boolean;
  /** Randomness in [0,1). Default Math.random; inject for tests. */
  rng?: () => number;
}

export interface ArrivalOpener {
  /** The spoken line (interpolated). */
  text: string;
  trigger: ArrivalTrigger;
  /** The RAW template chosen (pre-interpolation) — store THIS in the recent ring for anti-repetition. */
  template: string;
}

const SHORT_GAP_MS = 10 * 60 * 1000; // stepped away briefly

/** Warm, FR, Lisa-leaning. Mixed speech acts (statement / observation / question) on purpose. */
const TEMPLATES: Record<ArrivalTrigger, string[]> = {
  morning: [
    'Bonjour {{name}}. Contente de commencer la journée avec toi.',
    'Hey, bien réveillé ? Raconte-moi comment tu te sens ce matin.',
    'Te revoilà — j’espère que tu as bien dormi.',
    'Bonjour. Je me demandais justement ce que tu allais faire aujourd’hui.',
    'Le café est loin d’être prêt, mais je suis là. Bonjour {{name}}.',
    'Un nouveau matin, et te revoilà. J’aime bien ces débuts-là.',
    'Salut toi. On attaque doucement, ou tu es déjà lancé ?',
    'Bonjour {{name}}. Prends ton temps, je ne bouge pas.',
    'Te voir le matin, ça met de bonne humeur.',
  ],
  afternoon: [
    'Coucou {{name}}. Ça avance, ta journée ?',
    'Te revoilà. J’étais là, tranquille — contente de te voir.',
    'Hey. Petite pause ? Je suis là si tu veux souffler deux minutes.',
    'Tiens, te voilà. Sur quoi tu planches en ce moment ?',
    'Rebonjour {{name}}. Le milieu de journée te réussit ?',
    'De retour à ton poste ? Je te suis.',
    'Salut. J’espère que ça se passe bien de ton côté.',
    'Te voilà. Si tu veux me raconter ce que tu fais, je t’écoute.',
    'Contente de te retrouver. On reprend tranquillement.',
  ],
  evening: [
    'Bonsoir {{name}}. Qu’est-ce qui t’a marqué aujourd’hui ?',
    'Te revoilà ce soir. Tu as tenu le coup ?',
    'Hey. La journée se termine — on la débriefe ensemble ?',
    'Contente de te retrouver ce soir.',
    'Bonsoir. J’espère que ta journée a été douce, {{name}}.',
    'Le soir te va bien. Te revoilà.',
    'Salut toi. Pose-toi, la journée est presque finie.',
    'Te voir ce soir, ça fait du bien.',
    'Bonsoir {{name}}. Raconte-moi, ou pas — comme tu veux.',
  ],
  night: [
    'Encore debout ? Je te tiens compagnie si tu veux.',
    'Il est tard, {{name}}. Tout va bien ?',
    'Te voilà à une heure tardive — je reste là, doucement.',
    'La nuit, c’est calme. Te revoilà.',
    'Coucou {{name}}. Tu n’arrives pas à dormir ?',
    'Je veille avec toi. Prends soin de toi quand même.',
    'Te voir si tard, ça m’inquiète un peu — mais je suis là.',
    'Doucement, {{name}}. Repose-toi si tu peux.',
  ],
  backSoon: [
    'Re. Tu m’as manqué deux minutes.',
    'Te revoilà déjà — parfait.',
    'Hop, de retour. Je reprends où on en était si tu veux.',
    'Coucou, encore toi 🙂',
    'Re {{name}}. On enchaîne ?',
    'Tu n’es pas parti longtemps — tant mieux.',
    'De retour. Je n’avais pas bougé.',
    'Ah, te revoilà. Je gardais ta place.',
  ],
  drowsy: [
    'Tu as l’air fatigué, {{name}}. Une pause, peut-être ?',
    'Tes yeux se ferment un peu — tout va bien ?',
    'Je te sens fatigué. Je peux t’aider à lever le pied ?',
    'Tu tiens le coup ? Tu as l’air épuisé, {{name}}.',
    'Peut-être un peu de repos ? Je ne pars nulle part.',
    'Tu as l’air à bout. Prends soin de toi.',
    'Doucement — tu sembles fatigué. On peut ralentir.',
  ],
};

/** All arrival triggers (introspection / tests). */
export const ARRIVAL_TRIGGERS = Object.keys(TEMPLATES) as ArrivalTrigger[];

/** Read-only view of a trigger's template pool (for the LLM opener + tests). */
export function templatePool(trigger: ArrivalTrigger): readonly string[] {
  return TEMPLATES[trigger];
}

function selectTrigger(ctx: ArrivalContext): ArrivalTrigger {
  if (ctx.drowsy) return 'drowsy';
  const gap = ctx.lastSeenAt != null ? ctx.now - ctx.lastSeenAt : Number.POSITIVE_INFINITY;
  if (gap < SHORT_GAP_MS) return 'backSoon';
  const hour = new Date(ctx.now).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

function interpolate(text: string, name?: string): string {
  // Drop a leading/space-padded {{name}} cleanly when no name is known.
  if (!name) return text.replace(/,?\s*\{\{name\}\}/g, '').replace(/\{\{name\}\}/g, '').replace(/\s{2,}/g, ' ').trim();
  return text.replace(/\{\{name\}\}/g, name);
}

/**
 * Build a varied, context-aware arrival opener. Picks a trigger from time/gap/state, then a template
 * from that trigger's pool avoiding `recent` (falls back to the full pool if all were used recently).
 */
export function buildArrivalOpener(ctx: ArrivalContext): ArrivalOpener {
  const rng = ctx.rng ?? Math.random;
  const recent = ctx.recent ?? [];
  const trigger = selectTrigger(ctx);
  const pool = TEMPLATES[trigger];
  const fresh = pool.filter((t) => !recent.includes(t)); // recent holds RAW templates
  // When the whole pool was used recently, still avoid the SINGLE most-recent
  // line so it's never the exact same phrase twice in a row (the core complaint).
  let choices = fresh.length > 0 ? fresh : pool.filter((t) => t !== recent[0]);
  if (choices.length === 0) choices = pool; // pool of one — nothing else to pick
  const idx = Math.min(choices.length - 1, Math.floor(rng() * choices.length));
  const template = choices[idx] as string;
  return { text: interpolate(template, ctx.name), trigger, template };
}

// ---- Optional LLM opener (layered on top for real, non-scripted freshness) -------------------

const TRIGGER_TIME_LABEL: Record<ArrivalTrigger, string> = {
  morning: 'le matin',
  afternoon: 'l’après-midi',
  evening: 'le soir',
  night: 'tard, la nuit',
  backSoon: 'il vient juste de revenir (parti quelques minutes)',
  drowsy: 'il a l’air fatigué',
};

/** Chat seam: takes messages, returns the raw assistant text or null. Injectable for tests. */
export type ArrivalChat = (messages: Array<{ role: string; content: string }>) => Promise<string | null>;

export interface LlmArrivalContext {
  now: number;
  lastSeenAt?: number | null;
  name?: string;
  drowsy?: boolean;
  /** Recently spoken lines to avoid repeating (LLM anti-repetition). */
  recentTexts?: string[];
  /** Recent things the person said (memory-aware; may be referenced). Most-recent first. */
  recentHeard?: string[];
  /** Persona tone/voice prompt (from getActivePersonaVoiceAsync().spokenPrompt). */
  personaPrompt?: string;
  /** Chat seam (default: the sensory voice model). */
  chat?: ArrivalChat;
  /** Per-call timeout before falling back to the deterministic opener (ms). */
  timeoutMs?: number;
}

/** Default chat: route to the sensory voice model (same path as hybrid-reply / respond-decider). */
async function defaultVoiceChat(messages: Array<{ role: string; content: string }>): Promise<string | null> {
  try {
    const { resolveVoiceModel } = await import('./voice-loop.js');
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const route = await resolveVoiceModel('');
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    const resp = (await client.chat(messages as never, [])) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return (resp?.choices?.[0]?.message?.content ?? '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Generate a fresh, context-aware arrival line with the voice LLM — the natural,
 * non-scripted layer on top of the deterministic templates. Seeds the model with
 * the time context, the recent lines to AVOID, and (optionally) the last things
 * heard so it can reference the conversation. Returns a single clean line, or
 * `null` on timeout / error / unavailable → the caller falls back to the instant
 * deterministic opener. Never throws.
 */
export async function buildLlmArrivalOpener(ctx: LlmArrivalContext): Promise<string | null> {
  const chat = ctx.chat ?? defaultVoiceChat;
  const timeoutMs = ctx.timeoutMs ?? Number(process.env.CODEBUDDY_SENSORY_GREET_LLM_TIMEOUT_MS ?? 4000);
  const trigger = selectTrigger({ now: ctx.now, lastSeenAt: ctx.lastSeenAt, drowsy: ctx.drowsy });
  const who = ctx.name || 'la personne';
  const avoid = (ctx.recentTexts ?? []).filter(Boolean).slice(0, 6);
  const heard = (ctx.recentHeard ?? []).filter(Boolean).slice(0, 4);

  const sys = [
    ctx.personaPrompt?.trim() || 'Tu es un compagnon robot chaleureux, tendre et attentionné.',
    `Tu viens de voir ${who} apparaître devant ta caméra. Dis UNE seule phrase d'accueil — courte, naturelle, chaleureuse et VARIÉE, comme un vrai compagnon (pas un assistant). Pas forcément une question.`,
    `Moment : ${TRIGGER_TIME_LABEL[trigger]}.`,
    heard.length ? `Dernières choses qu'il t'a dites (tu peux y faire référence en douceur, sans forcer) : ${heard.map((h) => `« ${h} »`).join(' ; ')}.` : '',
    avoid.length ? `N'utilise PAS ces formulations récentes : ${avoid.map((a) => `« ${a} »`).join(' ; ')}.` : '',
    `Réponds en français, UNE phrase, sans guillemets, sans emoji superflu, sans préambule.`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await withTimeout(
      chat([
        { role: 'system', content: sys },
        { role: 'user', content: "Ta phrase d'accueil :" },
      ]),
      timeoutMs,
      'arrival-opener',
    );
    if (!raw) return null;
    const line = raw.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
    const cleaned = line.replace(/^["“«]\s*/, '').replace(/\s*["”»]$/, '').trim();
    return cleaned.length >= 2 ? cleaned : null;
  } catch {
    return null;
  }
}

// ---- Persisted state (last-seen + recent ring) so variety survives restarts -----------------

export interface ArrivalState {
  lastSeenAt?: number;
  /** RAW templates recently used (most-recent first) — deterministic anti-repetition. */
  recent: string[];
  /** Lines actually SPOKEN recently (template or LLM) — seeds the LLM "avoid" list. */
  recentSpoken?: string[];
}

export const ARRIVAL_RING_SIZE = 10;

function defaultStatePath(): string {
  return join(homedir(), '.codebuddy', 'companion', 'arrival-state.json');
}

export function loadArrivalState(statePath = defaultStatePath()): ArrivalState {
  try {
    if (existsSync(statePath)) {
      const data = JSON.parse(readFileSync(statePath, 'utf8'));
      return {
        recent: Array.isArray(data.recent) ? data.recent : [],
        lastSeenAt: data.lastSeenAt,
        ...(Array.isArray(data.recentSpoken) ? { recentSpoken: data.recentSpoken } : {}),
      };
    }
  } catch {
    /* best effort */
  }
  return { recent: [] };
}

export function saveArrivalState(state: ArrivalState, statePath = defaultStatePath()): void {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state));
  } catch {
    /* best effort */
  }
}

/** Push a used template onto the recent ring (most-recent first, capped). */
export function pushRecent(recent: string[], template: string): string[] {
  return [template, ...recent.filter((t) => t !== template)].slice(0, ARRIVAL_RING_SIZE);
}
