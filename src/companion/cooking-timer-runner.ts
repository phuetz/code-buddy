import {
  CookingTimerStore,
  type CookingTimerView,
} from '../life-rhythm/cooking-timer-store.js';
import { HomeModeStore } from '../life-rhythm/home-mode-store.js';
import type { HomeMode } from '../life-rhythm/types.js';
import { logger } from '../utils/logger.js';
import { getCompanionConductor } from './orchestrator.js';

export interface CookingTimerRunnerDeps {
  store?: Pick<CookingTimerStore, 'due'>;
  say?: (text: string) => Promise<void>;
  notify?: (text: string) => Promise<void>;
  homeMode?: () => Promise<HomeMode>;
  conductor?: { claim: (surface: 'reminder') => boolean };
  repeatMs?: number;
  tickMs?: number;
}

const lastAnnouncedAt = new Map<string, number>();
const announcingIds = new Set<string>();

export function resetCookingTimerRunnerState(): void {
  lastAnnouncedAt.clear();
  announcingIds.clear();
}

async function defaultSay(text: string): Promise<void> {
  const { sayNow } = await import('../sensory/voice-loop.js');
  await sayNow(text);
}

async function defaultNotify(text: string): Promise<void> {
  const { sendTelegramAlert } = await import('../sensory/alert.js');
  await sendTelegramAlert(text);
}

async function currentHomeMode(deps: CookingTimerRunnerDeps): Promise<HomeMode | null> {
  try {
    return deps.homeMode ? await deps.homeMode() : (await new HomeModeStore().getCurrent()).mode;
  } catch {
    return null;
  }
}

function repeatDelay(deps: CookingTimerRunnerDeps): number {
  const configured = deps.repeatMs
    ?? (Number(process.env.CODEBUDDY_COOKING_TIMER_REPEAT_MS) || 60_000);
  return Number.isFinite(configured) && configured >= 5_000 ? configured : 60_000;
}

/** Announce one due timer. It remains due until explicitly acknowledged. */
export async function runCookingTimerTick(
  now: Date,
  deps: CookingTimerRunnerDeps = {}
): Promise<CookingTimerView | null> {
  try {
    if (Number.isNaN(now.getTime())) throw new RangeError('now must be a valid Date');
    const due = await (deps.store ?? new CookingTimerStore()).due(now);
    const repeatMs = repeatDelay(deps);
    const candidate = due.find((timer) =>
      !announcingIds.has(timer.id)
      && now.getTime() - (lastAnnouncedAt.get(timer.id) ?? Number.NEGATIVE_INFINITY) >= repeatMs
    );
    if (!candidate) return null;
    announcingIds.add(candidate.id);
    try {
      const mode = await currentHomeMode(deps);
      const privateLabelAllowed = mode !== 'guests' && mode !== null;
      const message = privateLabelAllowed
        ? `Le minuteur « ${candidate.label} » est terminé.`
        : 'Un minuteur de cuisine est terminé.';
      if (mode === 'away') {
        await (deps.notify ?? defaultNotify)(`⏰ ${message}`);
      } else {
        // A requested kitchen timer is not a spontaneous companion suggestion.
        // It has reminder priority even in silent mode and resets the voice floor.
        (deps.conductor ?? getCompanionConductor()).claim('reminder');
        await (deps.say ?? defaultSay)(message);
      }
      lastAnnouncedAt.set(candidate.id, now.getTime());
      logger.info(`[cooking-timer] due announcement: ${candidate.label} (${candidate.id})`);
      return candidate;
    } finally {
      announcingIds.delete(candidate.id);
    }
  } catch (error) {
    logger.warn('[cooking-timer] due check stayed silent after an error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Reuses the server lifecycle; no second daemon is created. */
export function wireCookingTimerRunner(deps: CookingTimerRunnerDeps = {}): () => void {
  const configured = deps.tickMs
    ?? (Number(process.env.CODEBUDDY_COOKING_TIMER_TICK_MS) || 2_000);
  const tickMs = Number.isFinite(configured) && configured >= 500 ? configured : 2_000;
  const timer = setInterval(() => {
    void runCookingTimerTick(new Date(), deps);
  }, tickMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`Cooking timers: runner started (tick ${Math.round(tickMs / 1_000)}s)`);
  return () => clearInterval(timer);
}
