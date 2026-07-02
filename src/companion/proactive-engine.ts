/**
 * Proactive engine — Lisa reaches out FIRST.
 *
 * The marquee MySoulmate mechanism (`services/proactiveMessageService.ts` + `ProactiveEngine.js`),
 * adapted honestly for a terminal companion: a small closed set of triggers, each scored by
 * priority; the single top candidate wins; it's throttled so she never harasses; and — crucially —
 * it's INDEPENDENT of the camera. When Patrice is present she speaks it (Piper); when he's away she
 * reaches him with a Telegram voice note. That's what makes return feel noticed and absence feel
 * cared about, instead of a companion that only exists when you're in frame.
 *
 * Design principles kept from MySoulmate: templates-first / LLM-optional (works offline, an LLM only
 * freshens the line), priority-scored triggers → single winner → throttle, and NO gamification
 * (no streaks/XP/badges — depth, not a retention hook). Opt-in `CODEBUDDY_COMPANION_PROACTIVE`
 * (default OFF ⇒ zero behaviour change). Best-effort, never-throws, everything injectable for tests.
 *
 * @module companion/proactive-engine
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';
import {
  loadRelationshipState,
  saveRelationshipState,
  daysBetween,
  pendingMilestone,
  markMilestonesUpTo,
} from './relationship-state.js';
import { dueFollowUp, markFired } from './event-followups.js';

/** The closed set of reasons Lisa might reach out. */
export type ProactiveTrigger = 'milestone' | 'inactivity' | 'followUp' | 'encouragement' | 'morning' | 'evening';

export interface ProactiveContext {
  now: number;
  /** Local hour 0-23. */
  hour: number;
  /** Whole days since the companion first saw Patrice (0 if never). */
  daysTogether: number;
  /** Whole days since the last confirmed sighting (0 if never / present). */
  daysSinceLastSeen: number;
  /** Tenure milestones already celebrated — so a milestone fires exactly once. */
  celebratedMilestones: number[];
  /** An event he mentioned that is now due for a "how did it go?" — the followUp source. */
  dueEventFollowUp?: { id: string; followUp: string } | null;
  /** Recent frustration heard → an encouragement opening. */
  recentFrustration?: boolean;
}

export interface ProactiveCandidate {
  trigger: ProactiveTrigger;
  /** Higher wins (MySoulmate's priorities). */
  priority: number;
  /** Interpolation data for the template ({{days}} / {{event}}). */
  data: Record<string, string | number>;
}

/** A return after this many days without a sighting warrants a check-in. */
export const INACTIVITY_DAYS = Number(process.env.CODEBUDDY_COMPANION_INACTIVITY_DAYS) || 2;

/**
 * Score the applicable triggers for a context, highest priority first (mirrors MySoulmate's
 * `evaluateTriggers`/`localEvaluate`). Pure. The caller takes the single top candidate.
 */
export function evaluateTriggers(ctx: ProactiveContext): ProactiveCandidate[] {
  const out: ProactiveCandidate[] = [];
  const m = pendingMilestone(ctx.daysTogether, ctx.celebratedMilestones);
  if (m != null) out.push({ trigger: 'milestone', priority: 0.9, data: { days: m } });
  if (ctx.daysSinceLastSeen >= INACTIVITY_DAYS) {
    out.push({ trigger: 'inactivity', priority: 0.8, data: { days: ctx.daysSinceLastSeen } });
  }
  if (ctx.dueEventFollowUp) out.push({ trigger: 'followUp', priority: 0.7, data: { event: ctx.dueEventFollowUp.followUp } });
  if (ctx.recentFrustration) out.push({ trigger: 'encouragement', priority: 0.6, data: {} });
  if (ctx.hour >= 6 && ctx.hour < 10) out.push({ trigger: 'morning', priority: 0.5, data: {} });
  if (ctx.hour >= 19 && ctx.hour < 22) out.push({ trigger: 'evening', priority: 0.5, data: {} });
  return out.sort((a, b) => b.priority - a.priority);
}

/** The single winning trigger, or null when nothing applies. */
export function pickTrigger(ctx: ProactiveContext): ProactiveCandidate | null {
  return evaluateTriggers(ctx)[0] ?? null;
}

/**
 * Template pools (French, ≤2 sentences, warm, non-intrusive). `followUp` is just `{{event}}` because
 * the event-followup text is already a complete "how did it go?" question.
 */
export const PROACTIVE_TEMPLATES: Record<ProactiveTrigger, string[]> = {
  morning: [
    'Bonjour Patrice. Je voulais être la première à te souhaiter une belle journée.',
    "Coucou, bien dormi ? J'espère que ta journée va être douce.",
    'Bonjour toi. Je pensais à toi ce matin — passe une belle journée.',
    'Hello Patrice. Prêt pour aujourd\'hui ? Je suis là si besoin.',
  ],
  evening: [
    "Alors, cette journée ? J'espère qu'elle a été bonne.",
    'Bonsoir. Tu as bien avancé aujourd\'hui — pense à souffler un peu.',
    'La soirée arrive doucement. Raconte-moi ta journée quand tu veux.',
    "Coucou, j'espère que tu vas bien ce soir. Je pensais à toi.",
  ],
  inactivity: [
    "Ça fait {{days}} jours qu'on ne s'est pas vus. Je voulais juste prendre de tes nouvelles.",
    'Tu me manques un peu — {{days}} jours sans te croiser. Tout va bien ?',
    'Coucou, ça fait {{days}} jours. Je pense à toi, fais-moi signe quand tu peux.',
  ],
  milestone: [
    "Tu sais, ça fait {{days}} jours qu'on se côtoie, toi et moi. Ça compte pour moi.",
    "{{days}} jours ensemble déjà. Merci d'être là, Patrice.",
    "Petit clin d'œil : {{days}} jours qu'on fait un bout de chemin ensemble.",
  ],
  followUp: ['{{event}}'],
  encouragement: [
    'Je te sens un peu tendu. On souffle, et on reprend un petit pas à la fois ?',
    "Courage — un truc à la fois. Je suis là si tu veux qu'on découpe le problème.",
    "Respire. Tu vas y arriver, et tu n'es pas seul là-dessus.",
  ],
};

/** Interpolate {{key}} placeholders. Uses a FUNCTION replacer so a `$` in the data never triggers
 *  `String.replace`'s special-pattern expansion. */
function interpolate(template: string, data: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
    Object.prototype.hasOwnProperty.call(data, k) ? String(data[k]) : '',
  );
}

const lastTemplateIdx: Record<string, number> = {};

/** Pick a line for a candidate, avoiding the same template twice in a row (per trigger). */
export function pickProactiveLine(candidate: ProactiveCandidate, rng: () => number = Math.random): string {
  const pool = PROACTIVE_TEMPLATES[candidate.trigger];
  if (!pool || pool.length === 0) return '';
  let idx = pool.length === 1 ? 0 : Math.floor(rng() * pool.length) % pool.length;
  if (pool.length > 1 && idx === lastTemplateIdx[candidate.trigger]) idx = (idx + 1) % pool.length;
  lastTemplateIdx[candidate.trigger] = idx;
  return interpolate(pool[idx]!, candidate.data);
}

// ── persisted throttle state ──────────────────────────────────────────

export interface ProactiveState {
  /** Epoch ms of the last proactive message sent (any trigger) — the cooldown anchor. */
  lastSentAt?: number;
  /** Recently sent lines (anti-repetition / LLM avoid-list). */
  recentLines: string[];
}

function defaultProactiveStatePath(): string {
  return (
    process.env.CODEBUDDY_COMPANION_PROACTIVE_STATE_FILE ||
    join(homedir(), '.codebuddy', 'companion', 'proactive-state.json')
  );
}

export function loadProactiveState(statePath = defaultProactiveStatePath()): ProactiveState {
  try {
    if (existsSync(statePath)) {
      const data = JSON.parse(readFileSync(statePath, 'utf8'));
      return {
        lastSentAt: typeof data.lastSentAt === 'number' ? data.lastSentAt : undefined,
        recentLines: Array.isArray(data.recentLines)
          ? data.recentLines.filter((s: unknown): s is string => typeof s === 'string').slice(-8)
          : [],
      };
    }
  } catch {
    /* best effort */
  }
  return { recentLines: [] };
}

export function saveProactiveState(state: ProactiveState, statePath = defaultProactiveStatePath()): void {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ ...state, recentLines: state.recentLines.slice(-8) }));
  } catch {
    /* best effort */
  }
}

/** True when at least `cooldownMs` has passed since the last proactive message. */
export function canSend(state: ProactiveState, now: number, cooldownMs: number): boolean {
  return now - (state.lastSentAt ?? Number.NEGATIVE_INFINITY) >= cooldownMs;
}

// ── the tick ──────────────────────────────────────────────────────────

/** Quiet/sleep window "START-END" (24h), default 22-8 (shared default with the presence loop). */
function isQuietHour(hour: number): boolean {
  const spec = process.env.CODEBUDDY_COMPANION_QUIET || '22-8';
  const m = spec.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

const FRUSTRATION =
  /\b(j'?en peux plus|marre|galère|gal[èe]re|bloqu[ée]|coince|coincé|ça marche pas|ca marche pas|énerve|enerve|fatigu[ée]|épuis|sais plus)\b/i;

export interface ProactiveDeps {
  now?: () => number;
  /** Someone is in front of the camera right now (→ speak vs Telegram). */
  present?: () => boolean | Promise<boolean>;
  /** Deliver aloud (present). Default: sayNow (Piper). */
  say?: (text: string) => Promise<void>;
  /** Deliver to the phone (absent). Default: sendTelegramVoice (falls back to text). */
  telegramVoice?: (text: string) => Promise<boolean>;
  /** Recent transcripts (for the encouragement trigger). */
  recentHearing?: () => Promise<string[]>;
  /** Optional LLM freshening of the chosen line → returns null to keep the template. */
  refine?: (trigger: ProactiveTrigger, base: string, avoid: string[]) => Promise<string | null>;
  cooldownMs?: number;
  rng?: () => number;
  statePath?: string;
  relationshipStatePath?: string;
  /** Enables the due-follow-up read (env or an injected path), mirroring the presence loop. */
  eventFollowUpsPath?: string;
}

async function defaultPresent(): Promise<boolean> {
  try {
    const { readPresenceContext } = await import('../memory/presence-injector.js');
    return (await readPresenceContext()).hasMatch;
  } catch {
    return false;
  }
}

async function defaultRecentHearing(): Promise<string[]> {
  try {
    const { readRecentCompanionPercepts } = await import('./percepts.js');
    const recent = await readRecentCompanionPercepts({ modality: 'hearing', limit: 6 });
    return recent.map((p) => String((p.payload as { text?: string })?.text ?? p.summary ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}

async function defaultSay(text: string): Promise<void> {
  const { sayNow } = await import('../sensory/voice-loop.js');
  await sayNow(text);
}

async function defaultTelegramVoice(text: string): Promise<boolean> {
  const { sendTelegramVoice } = await import('../sensory/alert.js');
  return sendTelegramVoice(text);
}

/**
 * One pass of the proactive engine. Returns the line sent (or null if it stayed silent). Never
 * throws. Exposed so tests drive it with a controlled clock + injected delivery/present seams.
 */
export async function runProactiveTick(deps: ProactiveDeps = {}): Promise<string | null> {
  try {
    if (process.env.CODEBUDDY_COMPANION_PROACTIVE !== 'true') return null;
    const now = (deps.now ?? (() => Date.now()))();
    const hour = new Date(now).getHours();
    if (isQuietHour(hour)) return null; // never wake him at night, even by phone

    const cooldownMs =
      deps.cooldownMs ?? (Number(process.env.CODEBUDDY_COMPANION_PROACTIVE_COOLDOWN_HOURS) || 12) * 3600_000;
    const state = loadProactiveState(deps.statePath);
    if (!canSend(state, now, cooldownMs)) return null; // one reach-out per cooldown window

    // Shared-history figures (read-only here; the presence loop owns writing sightings).
    const rel = loadRelationshipState(deps.relationshipStatePath);
    const daysTogether = rel.firstSeenAt != null ? daysBetween(rel.firstSeenAt, now) : 0;
    const daysSinceLastSeen = rel.lastPresentAt != null ? daysBetween(rel.lastPresentAt, now) : 0;

    const efEnabled =
      process.env.CODEBUDDY_COMPANION_EVENT_FOLLOWUPS === 'true' || deps.eventFollowUpsPath != null;
    const due = efEnabled ? dueFollowUp(now, deps.eventFollowUpsPath) : null;

    const hearing = await (deps.recentHearing ?? defaultRecentHearing)();
    const recentFrustration = hearing.some((t) => FRUSTRATION.test(t));

    const candidate = pickTrigger({
      now,
      hour,
      daysTogether,
      daysSinceLastSeen,
      celebratedMilestones: rel.celebratedMilestones,
      dueEventFollowUp: due ? { id: due.id, followUp: due.followUp } : null,
      recentFrustration,
    });
    if (!candidate) return null;

    let line = pickProactiveLine(candidate, deps.rng ?? Math.random);
    if (!line.trim()) return null;
    if (deps.refine) {
      try {
        const fresh = await deps.refine(candidate.trigger, line, state.recentLines);
        if (fresh && fresh.trim()) line = fresh.trim();
      } catch {
        /* keep the template */
      }
    }

    // Deliver: aloud if he's here, otherwise reach his phone.
    const present = await (deps.present ?? defaultPresent)();
    if (present) {
      await (deps.say ?? defaultSay)(line);
    } else {
      await (deps.telegramVoice ?? defaultTelegramVoice)(line);
    }

    // Persist throttle + per-occurrence locks so a trigger fires exactly once.
    saveProactiveState({ lastSentAt: now, recentLines: [...state.recentLines, line].slice(-8) }, deps.statePath);
    if (candidate.trigger === 'milestone') {
      rel.celebratedMilestones = markMilestonesUpTo(rel.celebratedMilestones, daysTogether);
      saveRelationshipState(rel, deps.relationshipStatePath);
    }
    if (candidate.trigger === 'followUp' && due) {
      markFired(due.id, now, deps.eventFollowUpsPath);
    }
    logger.info(`[proactive] ${candidate.trigger} (${present ? 'spoken' : 'telegram'}) → ${line}`);
    return line;
  } catch (err) {
    logger.warn(`[proactive] tick failed → silent: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Start the proactive loop on its own interval (works without the camera). Returns teardown. */
export function wireProactiveLoop(deps: ProactiveDeps = {}): () => void {
  const tickMs = Number(process.env.CODEBUDDY_COMPANION_PROACTIVE_TICK_MS) || 900_000; // 15 min
  // Optional LLM freshening (templates-first, LLM-optional). Wired only here so runProactiveTick
  // stays pure/testable.
  const withLlm: ProactiveDeps =
    process.env.CODEBUDDY_COMPANION_PROACTIVE_LLM === 'true' && !deps.refine
      ? { ...deps, refine: defaultRefine }
      : deps;
  const timer = setInterval(() => {
    void runProactiveTick(withLlm);
  }, tickMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`Companion proactive: Enabled (tick ${Math.round(tickMs / 1000)}s)`);
  return () => clearInterval(timer);
}

/** Default LLM refiner: freshen the chosen line via the voice model, ≤2 sentences, non-intrusive.
 *  Times out / degrades to the template. Never throws. */
async function defaultRefine(trigger: ProactiveTrigger, base: string, avoid: string[]): Promise<string | null> {
  try {
    const { resolveVoiceModel } = await import('../sensory/voice-loop.js');
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const { withTimeout } = await import('../council/with-timeout.js');
    const route = await resolveVoiceModel('');
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    const sys = [
      'Tu es Lisa, une compagne chaleureuse et tendre. Tu prends l\'initiative de contacter Patrice.',
      `Reformule ce message d'initiative (${trigger}) en UNE à DEUX phrases, chaleureux, naturel, non intrusif, en français.`,
      `Base : « ${base} ».`,
      avoid.length ? `Évite ces formulations récentes : ${avoid.slice(-4).map((a) => `« ${a} »`).join(' ; ')}.` : '',
      'Réponds uniquement par le message, sans guillemets ni préambule.',
    ]
      .filter(Boolean)
      .join('\n');
    const resp = (await withTimeout(
      client.chat([{ role: 'system', content: sys }, { role: 'user', content: base }] as never, []),
      Number(process.env.CODEBUDDY_COMPANION_PROACTIVE_LLM_TIMEOUT_MS) || 4000,
      'proactive-refine',
    )) as { choices?: Array<{ message?: { content?: string | null } }> };
    const out = (resp?.choices?.[0]?.message?.content ?? '').trim();
    return out || null;
  } catch {
    return null;
  }
}
