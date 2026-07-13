import type { DayKind, HomeMode } from '../life-rhythm/types.js';
import { buildDayContext } from '../life-rhythm/day-context.js';
import { EtalabHolidayProvider } from '../life-rhythm/etalab-holiday-provider.js';
import { HomeModeStore } from '../life-rhythm/home-mode-store.js';
import type {
  EtalabHolidayZone,
  PublicHolidayProvider,
} from '../life-rhythm/types.js';
import { logger } from '../utils/logger.js';

export type HomeInteractionSurface =
  | 'presence'
  | 'proactive-local'
  | 'proactive-remote'
  | 'idle';

export interface HomeInteractionPolicyInput {
  mode: HomeMode;
  dayKind: DayKind;
  surface: HomeInteractionSurface;
}

export interface HomeInteractionDecision {
  allowed: boolean;
  /** Shared daily allowance for unsolicited voice/phone invitations. */
  spontaneousDailyLimit: number;
  /** False in guest mode: UI and speech must not reveal personal context. */
  privateContentAllowed: boolean;
  reason: string;
}

export interface ResolveHomeInteractionOptions {
  now?: Date;
  timeZone?: string;
  homeModeStore?: HomeModeStore;
  holidayProvider?: PublicHolidayProvider;
}

const NO_SPONTANEOUS_MODES = new Set<HomeMode>(['silent', 'focus', 'rest', 'guests']);

/**
 * One explicit policy shared by the presence and proactive loops. Calendar,
 * presence and household intent remain separate inputs; this function never
 * infers that somebody is home merely because the day is free.
 */
export function evaluateHomeInteractionPolicy(
  input: HomeInteractionPolicyInput
): HomeInteractionDecision {
  const privateContentAllowed = input.mode !== 'guests';
  if (input.surface === 'idle') {
    return {
      allowed: true,
      spontaneousDailyLimit: 0,
      privateContentAllowed,
      reason: 'Background-only work may continue without interrupting the household.',
    };
  }

  if (NO_SPONTANEOUS_MODES.has(input.mode)) {
    return {
      allowed: false,
      spontaneousDailyLimit: 0,
      privateContentAllowed,
      reason: `${input.mode} mode suppresses non-essential spontaneous contact.`,
    };
  }

  if (input.mode === 'away' && input.surface !== 'proactive-remote') {
    return {
      allowed: false,
      spontaneousDailyLimit: 0,
      privateContentAllowed,
      reason: 'Away mode permits a bounded remote note, never local speech.',
    };
  }

  const freeDay = input.mode === 'free-day'
    || input.dayKind === 'weekend'
    || input.dayKind === 'public_holiday';
  const spontaneousDailyLimit = freeDay ? 2 : input.dayKind === 'unknown' ? 1 : 4;
  return {
    allowed: true,
    spontaneousDailyLimit,
    privateContentAllowed,
    reason: freeDay
      ? 'Free days allow at most two gentle invitations, without creating obligations.'
      : 'Normal household rhythm with a bounded daily initiative budget.',
  };
}

/** Resolve the live household posture for the always-on companion loops. */
export async function resolveCurrentHomeInteractionPolicy(
  surface: HomeInteractionSurface,
  options: ResolveHomeInteractionOptions = {}
): Promise<HomeInteractionDecision> {
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  const timeZone = options.timeZone
    || process.env.CODEBUDDY_TIMEZONE
    || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const homeModeStore = options.homeModeStore ?? new HomeModeStore();
  const homeMode = await homeModeStore.getCurrent();

  // Modes that suppress a surface do not need a network/calendar lookup.
  const early = evaluateHomeInteractionPolicy({ mode: homeMode.mode, dayKind: 'unknown', surface });
  if (!early.allowed || surface === 'idle') return early;

  try {
    const holidayProvider = options.holidayProvider ?? new EtalabHolidayProvider({
      zone: (process.env.CODEBUDDY_HOLIDAY_ZONE || 'metropole') as EtalabHolidayZone,
    });
    const context = await buildDayContext({
      instant: now,
      timeZone,
      holidayProvider,
      homeMode,
    });
    return evaluateHomeInteractionPolicy({
      mode: homeMode.mode,
      dayKind: context.dayKind,
      surface,
    });
  } catch (error) {
    logger.warn('[companion-policy] calendar context unavailable; using conservative budget', {
      error: error instanceof Error ? error.message : String(error),
    });
    return early;
  }
}
