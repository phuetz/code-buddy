/**
 * Presence loop — the companion's "conductor".
 *
 * The robot already reacts well (greets, answers, reminds) but had no ambient PRESENCE: a small
 * warm word at the right moment, otherwise just being there. `check-in.ts` is a mood engine that
 * was built but never SPOKEN. This loop fires it (and a small library of "moments") on a slow tick
 * — turning a silent engine into felt company.
 *
 * Patrice chose a WARM/present companion, so the cadence is generous — but the rails that prevent
 * "companion" from curdling into "annoying" are non-negotiable and all tunable:
 *   - opt-in (`CODEBUDDY_COMPANION_PRESENCE=true`, default OFF)
 *   - quiet/sleep hours (never speak while you sleep)
 *   - presence-aware (never to an empty room)
 *   - not mid human-human conversation
 *   - an hourly cap + a per-moment cooldown
 * Otherwise → silent present. Never-throws; everything injectable for deterministic tests.
 *
 * @module companion/presence-loop
 */
import { logger } from '../utils/logger.js';
import {
  loadRelationshipState,
  saveRelationshipState,
  daysBetween,
  pendingMilestone,
  markMilestonesUpTo,
  REUNION_DAYS,
} from './relationship-state.js';
import { dueFollowUp, markFired } from './event-followups.js';
import { getCompanionConductor } from './orchestrator.js';
import { resolveUserName } from './user-name.js';
import { readRecentDialogueHearing } from './dialogue-percepts.js';
import {
  resolveCurrentHomeInteractionPolicy,
  type HomeInteractionDecision,
} from './home-interaction-policy.js';
import {
  reserveDailyInteraction,
  type DailyInteractionReservation,
} from './daily-interaction-budget.js';
import { resolveHouseholdClock } from './household-time.js';

export interface PresenceCtx {
  now: Date;
  /** Local hour 0-23. */
  hour: number;
  /** Someone is actually here (camera presence / recent arrival). */
  personPresent: boolean;
  /** Recent transcripts — for frustration / thread cues. */
  recentHearing: string[];
  /** A recent drowsy signal. */
  drowsy: boolean;
  /** A thread from memory worth following up (e.g. a project). */
  projectThread: string | null;
  /** Whole days since the companion first saw Patrice (shared-history tenure). */
  daysTogether: number;
  /** Whole days since the last confirmed sighting (0 on a continuous presence). */
  daysSinceLastSeen: number;
  /** Tenure milestones already celebrated — so a milestone moment fires exactly once. */
  celebratedMilestones: number[];
  /** An event Patrice mentioned that is now due for a "how did it go?" follow-up, or null. */
  dueEventFollowUp?: { id: string; followUp: string } | null;
}

export interface Moment {
  id: string;
  /** Minimum gap before THIS moment may fire again. */
  cooldownMs: number;
  /** It asked something → open the conversation window so he can answer back. */
  engage?: boolean;
  /** Produce the spoken line, or null if this moment doesn't fit right now. */
  generate: (ctx: PresenceCtx) => string | null;
}

export interface PresenceDeps {
  say?: (text: string) => Promise<void>;
  now?: () => Date;
  isPersonPresent?: () => boolean | Promise<boolean>;
  /** Don't talk over a live exchange. */
  inConversation?: () => boolean | Promise<boolean>;
  recentHearing?: () => Promise<string[]>;
  drowsy?: () => boolean | Promise<boolean>;
  projectThread?: () => Promise<string | null>;
  /** Open the conversation window after an engaging moment. */
  onEngage?: () => void;
  /** Override the moment library (tests). */
  moments?: Moment[];
  /** Max presence acts per rolling hour (default from env, generous since he chose "vivant"). */
  hourlyCap?: number;
  tickMs?: number;
  /** Override the relationship-state file path (tests). Default: CODEBUDDY_RELATIONSHIP_STATE_FILE
   *  or ~/.codebuddy/companion/relationship-state.json. */
  relationshipStatePath?: string;
  /** Override the event-followups file path (tests). Setting it (or CODEBUDDY_COMPANION_EVENT_FOLLOWUPS)
   *  enables the due-follow-up read each tick. Default path: ~/.codebuddy/companion/event-followups.json. */
  eventFollowUpsPath?: string;
  /** The shared conductor (arbitrates who speaks). Default: the singleton. Injectable for tests. */
  conductor?: { claim: (surface: 'presence') => boolean };
  /** Household posture/calendar gate. Wired by `wirePresenceLoop`; injectable for tests. */
  homePolicy?: (now: Date) => Promise<HomeInteractionDecision>;
  /** Shared cross-surface daily invitation budget. Wired by `wirePresenceLoop`. */
  claimDailyBudget?: (limit: number, now: Date) => Promise<DailyInteractionReservation>;
}

// ── helpers ───────────────────────────────────────────────────────────

/** Quiet/sleep window "START-END" (24h), default 22-8. Wraps midnight. */
function isQuietHour(hour: number): boolean {
  const spec = process.env.CODEBUDDY_COMPANION_QUIET || '22-8';
  const m = spec.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

function pick(lines: string[], now: Date): string {
  // Deterministic-ish rotation (no Math.random for resumability friendliness).
  return lines[Math.floor(now.getTime() / 60000) % lines.length]!;
}

const FRUSTRATION =
  /\b(j'?en peux plus|marre|galère|gal[èe]re|bloqu[ée]|coince|coincé|ça marche pas|ca marche pas|énerve|enerve|fatigu[ée]|épuis|sais plus)\b/i;

// ── relationship-aware moments (shared history) ───────────────────────
// Warm, sparse, non-gamified: a reunion after a real absence and a tenure milestone. Placed
// FIRST so a genuine "welcome back" / "we've been together N days" wins over routine moments on
// the tick it applies. Both fire at most once per occurrence (reunion: the sighting resets the
// gap; milestone: `celebratedMilestones` records it).
export const RELATIONSHIP_MOMENTS: Moment[] = [
  {
    id: 'reunion',
    cooldownMs: 6 * 3600_000,
    engage: true,
    generate: (ctx) =>
      ctx.daysSinceLastSeen >= REUNION_DAYS
        ? pick(
            [
              `Te revoilà — ça faisait ${ctx.daysSinceLastSeen} jours. Content de te retrouver, tout va bien ?`,
              `Ça faisait un moment, ${ctx.daysSinceLastSeen} jours sans te voir. Je suis contente que tu sois là.`,
            ],
            ctx.now
          )
        : null,
  },
  {
    // "How did that go?" — an event Patrice mentioned earlier that has now passed. Placed high (a
    // timely, personal follow-up), engages so he can answer back. Short cooldown so a due one
    // surfaces on the next presence rather than waiting hours.
    id: 'followup',
    cooldownMs: 30 * 60_000,
    engage: true,
    generate: (ctx) => ctx.dueEventFollowUp?.followUp ?? null,
  },
  {
    id: 'milestone',
    cooldownMs: 20 * 3600_000,
    generate: (ctx) => {
      const m = pendingMilestone(ctx.daysTogether, ctx.celebratedMilestones);
      return m == null
        ? null
        : pick(
            [
              `Tu sais, ça fait ${m} jours qu'on se côtoie, toi et moi. J'aime bien notre bout de chemin.`,
              `${m} jours ensemble déjà. Merci d'être là, ${resolveUserName()}.`,
            ],
            ctx.now
          );
    },
  },
];

// ── default moment library (priority order) ───────────────────────────

export const DEFAULT_MOMENTS: Moment[] = [
  ...RELATIONSHIP_MOMENTS,
  {
    id: 'encourage',
    cooldownMs: 20 * 60_000,
    generate: (ctx) =>
      ctx.recentHearing.some((t) => FRUSTRATION.test(t))
        ? pick(
            [
              'On garde simple. Le prochain petit pas utile, on le fait ensemble ?',
              'Respire — on prend un truc à la fois. Par quoi on commence ?',
              'Je suis là. On découpe : quel est le bout le plus petit qui avance ?',
            ],
            ctx.now
          )
        : null,
  },
  {
    id: 'break',
    cooldownMs: 45 * 60_000,
    generate: (ctx) =>
      ctx.drowsy ? 'Tu veux faire une petite pause ? Quelques minutes te feraient du bien.' : null,
  },
  {
    id: 'project',
    cooldownMs: 90 * 60_000,
    engage: true,
    generate: (ctx) => (ctx.projectThread ? `Au fait — ${ctx.projectThread}. Tu en es où ?` : null),
  },
  {
    id: 'day-debrief',
    cooldownMs: 12 * 3600_000,
    engage: true,
    generate: (ctx) =>
      ctx.hour >= 19 && ctx.hour < 23
        ? pick(
            ['Alors, comment s’est passée ta journée ?', 'Raconte — ta journée, ça a donné quoi ?'],
            ctx.now
          )
        : null,
  },
  {
    id: 'time-of-day',
    cooldownMs: 6 * 3600_000,
    generate: (ctx) => {
      if (ctx.hour >= 6 && ctx.hour < 11)
        return pick(
          [`Bonjour ${resolveUserName()}. Bien dormi ?`, 'Salut, belle journée qui commence.'],
          ctx.now
        );
      if (ctx.hour >= 21 && ctx.hour < 24)
        return pick(
          [
            'Bonne soirée. Tu as bien avancé aujourd’hui.',
            'Doucement, la soirée — tu as bossé dur.',
          ],
          ctx.now
        );
      return null;
    },
  },
];

// ── the conductor ─────────────────────────────────────────────────────

const lastFiredByMoment = new Map<string, number>();
let firedTimestamps: number[] = [];

/** Test seam. */
export function resetPresenceState(): void {
  lastFiredByMoment.clear();
  firedTimestamps = [];
}

function hourlyCap(deps: PresenceDeps): number {
  if (deps.hourlyCap !== undefined) return deps.hourlyCap;
  const n = Number(process.env.CODEBUDDY_COMPANION_PRESENCE_HOURLY_CAP);
  return Number.isFinite(n) && n > 0 ? n : 4; // generous — he chose "vivant"
}

async function defaultSay(text: string): Promise<void> {
  const { sayNow } = await import('../sensory/voice-loop.js');
  await sayNow(text);
}

/**
 * Presence files can be fresh while explicitly saying that nobody matched
 * (`left`, `unknown`, or an empty camera frame). Only a confirmed match is a
 * licence for an unsolicited spoken moment.
 */
export function hasConfirmedPresence(
  context: { hasMatch?: unknown } | null | undefined
): boolean {
  return context?.hasMatch === true;
}

async function defaultPersonPresent(): Promise<boolean> {
  try {
    const { readPresenceContext } = await import('../memory/presence-injector.js');
    const p = await readPresenceContext();
    return hasConfirmedPresence(p);
  } catch {
    return false;
  }
}

async function defaultRecentHearing(): Promise<string[]> {
  return readRecentDialogueHearing(6);
}

/**
 * One pass of the conductor. Exposed so tests drive it with a controlled clock + injected gates.
 * Never-throws. Returns the spoken line (or null when it stayed silent) — for tests/logging.
 */
export async function runPresenceTick(deps: PresenceDeps = {}): Promise<string | null> {
  try {
    if (process.env.CODEBUDDY_COMPANION_PRESENCE !== 'true') return null;
    const now = (deps.now ?? (() => new Date()))();
    const hour = resolveHouseholdClock(now).hour;

    // — Rails (cheap-first) —
    if (isQuietHour(hour)) return null; // never while you sleep
    const present = await (deps.isPersonPresent ?? defaultPersonPresent)();
    if (!present) return null; // never to an empty room
    const homeDecision = deps.homePolicy ? await deps.homePolicy(now) : null;
    if (homeDecision && !homeDecision.allowed) return null;

    // — Shared-history bookkeeping — read the gap BEFORE recording this sighting, so the reunion
    // moment (which can only fire on RETURN — the tick early-returns while absent) sees the real
    // absence. Recorded even if we then bail on conversation/cap: a confirmed presence IS a sighting.
    const nowMs = now.getTime();
    const relState = loadRelationshipState(deps.relationshipStatePath);
    if (relState.firstSeenAt == null) relState.firstSeenAt = nowMs;
    const daysTogether = daysBetween(relState.firstSeenAt, nowMs);
    const daysSinceLastSeen =
      relState.lastPresentAt != null ? daysBetween(relState.lastPresentAt, nowMs) : 0;
    relState.lastPresentAt = nowMs;
    saveRelationshipState(relState, deps.relationshipStatePath);

    if (await (deps.inConversation ?? (() => false))()) return null; // never over a live exchange

    firedTimestamps = firedTimestamps.filter((t) => nowMs - t < 3600_000);
    if (firedTimestamps.length >= hourlyCap(deps)) return null; // hourly cap

    // A due event follow-up ("how did that deploy go?") — only read the store when the feature is
    // enabled (env or an injected path), so we never touch the real home dir in default/tests.
    const efEnabled =
      process.env.CODEBUDDY_COMPANION_EVENT_FOLLOWUPS === 'true' || deps.eventFollowUpsPath != null;
    const due = efEnabled ? dueFollowUp(nowMs, deps.eventFollowUpsPath) : null;

    // — Build context once —
    const ctx: PresenceCtx = {
      now,
      hour,
      personPresent: present,
      recentHearing: await (deps.recentHearing ?? defaultRecentHearing)(),
      drowsy: await (deps.drowsy ?? (() => false))(),
      projectThread: await (deps.projectThread ?? (async () => null))(),
      daysTogether,
      daysSinceLastSeen,
      celebratedMilestones: relState.celebratedMilestones,
      dueEventFollowUp: due ? { id: due.id, followUp: due.followUp } : null,
    };

    // — Pick the first warranted moment that's off cooldown —
    for (const moment of deps.moments ?? DEFAULT_MOMENTS) {
      const last = lastFiredByMoment.get(moment.id) ?? Number.NEGATIVE_INFINITY;
      if (nowMs - last < moment.cooldownMs) continue;
      const line = moment.generate(ctx);
      if (!line) continue;
      let reservation: DailyInteractionReservation | null = null;
      if (homeDecision && deps.claimDailyBudget) {
        reservation = await deps.claimDailyBudget(homeDecision.spontaneousDailyLimit, now);
        if (!reservation.granted) {
          logger.info('[presence] shared household invitation budget exhausted');
          return null;
        }
      }
      // Yield to the conductor only after a budget slot is reserved. A denied
      // floor releases that slot, so neither shared guard is consumed falsely.
      const conductor = deps.conductor ?? getCompanionConductor();
      if (!conductor.claim('presence')) {
        await reservation?.release();
        logger.info('[presence] yielded to the conductor (another voice has the floor)');
        return null;
      }
      try {
        await (deps.say ?? defaultSay)(line);
      } catch (error) {
        await reservation?.release();
        throw error;
      }
      lastFiredByMoment.set(moment.id, nowMs);
      firedTimestamps.push(nowMs);
      if (moment.engage) deps.onEngage?.();
      // Record a celebrated tenure milestone (all marks up to today) so it never repeats.
      if (moment.id === 'milestone') {
        relState.celebratedMilestones = markMilestonesUpTo(
          relState.celebratedMilestones,
          daysTogether
        );
        saveRelationshipState(relState, deps.relationshipStatePath);
      }
      // Mark a fired follow-up done so it's asked exactly once.
      if (moment.id === 'followup' && due) {
        markFired(due.id, nowMs, deps.eventFollowUpsPath);
      }
      logger.info(`[presence] ${moment.id} → ${line}`);
      return line;
    }
    return null; // nothing fit → silent present
  } catch (err) {
    logger.warn(
      `[presence] tick failed → silent: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/** Start the presence loop on its own interval (works without the sensory daemon). Returns teardown. */
export function wirePresenceLoop(deps: PresenceDeps = {}): () => void {
  const tickMs =
    deps.tickMs ?? (Number(process.env.CODEBUDDY_COMPANION_PRESENCE_TICK_MS) || 300_000); // 5 min
  const householdAwareDeps: PresenceDeps = {
    ...deps,
    homePolicy: deps.homePolicy ?? ((now) => resolveCurrentHomeInteractionPolicy('presence', { now })),
    claimDailyBudget: deps.claimDailyBudget ?? ((limit, now) =>
      reserveDailyInteraction({ limit, now, surface: 'presence' })),
  };
  const timer = setInterval(() => {
    void runPresenceTick(householdAwareDeps);
  }, tickMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(
    `Companion presence: Enabled (tick ${Math.round(tickMs / 1000)}s, cap ${hourlyCap(deps)}/h)`
  );
  return () => clearInterval(timer);
}
