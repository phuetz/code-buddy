import { ipcMain } from 'electron';
import {
  CookingTimerStore,
  EtalabHolidayProvider,
  HOME_MODES,
  HomeModeStore,
  buildDayContext,
  type EtalabHolidayZone,
  type HomeMode,
  type PublicHolidayProvider,
} from '../../../../src/life-rhythm/index.js';
import {
  FoodProfileStore,
  MealPlanStore,
  type UpcomingMealPlanEntry,
} from '../../../../src/meals/index.js';
import {
  readPresenceContext,
  type PresenceContext,
} from '../../../../src/memory/presence-injector.js';
import type {
  MaisonDayKind,
  MaisonModeInput,
  MaisonPresence,
  MaisonSnapshot,
  MaisonSnapshotPayload,
  MaisonTimerStartInput,
} from '../../shared/maison-ipc.js';

const MAX_MODE_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface MaisonIpcDeps {
  now?: () => Date;
  timeZone?: string;
  holidayProvider?: PublicHolidayProvider;
  homeModeStore?: Pick<HomeModeStore, 'getCurrent' | 'setMode'>;
  cookingTimerStore?: Pick<CookingTimerStore, 'listActive' | 'start' | 'acknowledge' | 'cancel'>;
  foodProfileStore?: Pick<FoodProfileStore, 'load'>;
  mealPlanStore?: Pick<MealPlanStore, 'nextUpcoming' | 'create'>;
  readPresence?: () => Promise<PresenceContext>;
}

function currentTime(deps: MaisonIpcDeps): Date {
  const value = deps.now?.() ?? new Date();
  if (Number.isNaN(value.getTime())) throw new Error('Maison clock returned an invalid date');
  return new Date(value.getTime());
}

function timeZone(deps: MaisonIpcDeps): string {
  return deps.timeZone
    || process.env.CODEBUDDY_TIMEZONE
    || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function holidayProvider(deps: MaisonIpcDeps): PublicHolidayProvider {
  return deps.holidayProvider ?? new EtalabHolidayProvider({
    zone: (process.env.CODEBUDDY_HOLIDAY_ZONE || 'metropole') as EtalabHolidayZone,
  });
}

function homeModeStore(deps: MaisonIpcDeps): Pick<HomeModeStore, 'getCurrent' | 'setMode'> {
  return deps.homeModeStore ?? new HomeModeStore();
}

function cookingTimerStore(
  deps: MaisonIpcDeps
): Pick<CookingTimerStore, 'listActive' | 'start' | 'acknowledge' | 'cancel'> {
  return deps.cookingTimerStore ?? new CookingTimerStore();
}

function mapDayKind(kind: 'workday' | 'weekend' | 'public_holiday' | 'unknown'): MaisonDayKind {
  return kind === 'public_holiday' ? 'holiday' : kind;
}

function mapPresence(
  context: PresenceContext,
  guestMode: boolean
): MaisonPresence {
  if (context.hasMatch) {
    return {
      state: 'present',
      ...(!guestMode && context.name ? { displayName: context.name } : {}),
      detail: guestMode
        ? 'Présence locale confirmée · identité masquée'
        : context.confidence !== undefined
          ? `Caméra locale · confiance ${Math.round(context.confidence * 100)} %`
          : 'Caméra locale',
    };
  }
  if (context.hasUnknownFace) {
    return {
      state: 'unknown',
      detail: 'Une présence non identifiée est détectée · mode discret',
    };
  }
  return { state: 'unknown', detail: 'Aucune présence récente confirmée' };
}

async function foodSummary(
  deps: MaisonIpcDeps,
  warnings: string[]
): Promise<MaisonSnapshotPayload['foodProfile']> {
  try {
    const profile = await (deps.foodProfileStore ?? new FoodProfileStore()).load();
    if (!profile) return { configured: false, constraintCount: 0, unknownCount: 0 };
    return {
      configured: true,
      constraintCount: profile.constraints.length,
      unknownCount: profile.constraints.filter((constraint) => constraint.status === 'unknown').length,
    };
  } catch {
    warnings.push('Le résumé du profil alimentaire chiffré est indisponible.');
    return { configured: true, constraintCount: 0, unknownCount: 0 };
  }
}

function mapUpcomingMeal(upcoming: UpcomingMealPlanEntry): NonNullable<MaisonSnapshot['nextMeal']> {
  const slotLabels = {
    breakfast: 'Petit-déjeuner',
    lunch: 'Déjeuner',
    dinner: 'Dîner',
    snack: 'En-cas',
  } as const;
  const source = upcoming.entry.provenance.source;
  const origin = source === 'leftover'
    ? 'leftovers'
    : source === 'recipe'
      ? 'recipe'
      : source === 'user'
        ? 'manual'
        : 'unknown';
  return {
    title: upcoming.entry.recipeTitle,
    whenLabel: `${slotLabels[upcoming.entry.slot]} · ${upcoming.entry.localDate} ${upcoming.entry.localTime}`,
    detail: upcoming.adjustment === 'gap-forward'
      ? 'Heure ajustée au premier instant valide après le changement d’heure.'
      : `Plan local · ${upcoming.entry.timeZone}`,
    origin,
    state: upcoming.entry.status === 'planned' ? 'planned' : 'suggested',
  };
}

async function nextMeal(
  deps: MaisonIpcDeps,
  now: Date,
  warnings: string[]
): Promise<MaisonSnapshot['nextMeal']> {
  try {
    const upcoming = await (deps.mealPlanStore ?? new MealPlanStore()).nextUpcoming(now);
    return upcoming ? mapUpcomingMeal(upcoming) : null;
  } catch {
    warnings.push('Le prochain repas planifié est momentanément indisponible.');
    return null;
  }
}

async function activeTimerSummary(
  deps: MaisonIpcDeps,
  now: Date,
  warnings: string[]
): Promise<MaisonSnapshotPayload['activeTimers']> {
  try {
    return (await cookingTimerStore(deps).listActive(now)).map((timer) => ({
      id: timer.id,
      label: timer.label,
      dueAt: timer.dueAt,
      state: timer.state,
      remainingMs: timer.remainingMs,
    }));
  } catch {
    warnings.push('Les minuteurs de cuisine sont momentanément indisponibles.');
    return [];
  }
}

/** Build an honest, privacy-aware renderer snapshot from core sources. */
export async function readMaisonSnapshot(deps: MaisonIpcDeps = {}): Promise<MaisonSnapshotPayload> {
  const now = currentTime(deps);
  const warnings: string[] = [];
  const secondarySources = Promise.all([
    activeTimerSummary(deps, now, warnings),
    nextMeal(deps, now, warnings),
    foodSummary(deps, warnings),
  ]);
  const [presence, mode] = await Promise.all([
    (deps.readPresence ?? readPresenceContext)(),
    homeModeStore(deps).getCurrent(),
  ]);
  const context = await buildDayContext({
    instant: now,
    timeZone: timeZone(deps),
    holidayProvider: holidayProvider(deps),
    homeMode: mode,
  });
  if (context.dayKind === 'unknown') {
    warnings.push('Le calendrier officiel est indisponible : jour ouvré non supposé.');
  }
  if (presence.hasUnknownFace) {
    warnings.push('Présence détectée mais identité non confirmée.');
  }

  const [activeTimers, upcomingMeal, profileSummary] = await secondarySources;
  const observedAtCandidates = [Date.parse(context.holidayProvenance.checkedAt)];
  if ((presence.hasMatch || presence.hasUnknownFace) && Number.isFinite(presence.ageMs)) {
    observedAtCandidates.push(now.getTime() - Math.max(0, presence.ageMs));
  }
  const finiteObservedAt = observedAtCandidates.filter(Number.isFinite);
  const oldestObservedAt = finiteObservedAt.length > 0
    ? Math.min(...finiteObservedAt)
    : now.getTime();
  const privateDetailsHidden = mode.mode === 'guests' || presence.hasUnknownFace;
  const visibleTimers = privateDetailsHidden
    ? activeTimers.map((timer, index) => ({ ...timer, label: `Minuteur ${index + 1}` }))
    : activeTimers;
  const visibleMeal = privateDetailsHidden && upcomingMeal
    ? {
        title: 'Repas planifié',
        detail: 'Titre et horaire masqués pour protéger la vie privée.',
        origin: 'unknown' as const,
        ...(upcomingMeal.state ? { state: upcomingMeal.state } : {}),
      }
    : upcomingMeal;
  const visibleFoodProfile = privateDetailsHidden
    ? { configured: false, constraintCount: 0, unknownCount: 0 }
    : profileSummary;

  const snapshot: MaisonSnapshot = {
    day: {
      kind: mapDayKind(context.dayKind),
      ...(context.publicHoliday ? { holidayName: context.publicHoliday.name } : {}),
    },
    presence: mapPresence(presence, privateDetailsHidden),
    mode: mode.mode,
    provenance: {
      kind: 'calendar',
      label: context.holidayProvenance.source === 'unavailable'
        ? 'Horloge locale · calendrier à confirmer'
        : presence.hasMatch || presence.hasUnknownFace
          ? `Calendrier officiel + présence locale · ${context.holidayProvenance.source}`
          : `Calendrier officiel · ${context.holidayProvenance.source}`,
      observedAt: new Date(oldestObservedAt).toISOString(),
    },
    nextMeal: visibleMeal,
  };

  return {
    status: 'ready',
    snapshot,
    activeTimers: visibleTimers,
    foodProfile: visibleFoodProfile,
    warnings,
  };
}

function parseModeInput(value: unknown): MaisonModeInput {
  if (typeof value !== 'object' || value === null) throw new Error('Maison mode input is required');
  const input = value as Partial<MaisonModeInput>;
  if (typeof input.mode !== 'string' || !(HOME_MODES as readonly string[]).includes(input.mode)) {
    throw new Error(`Maison mode must be one of: ${HOME_MODES.join(', ')}`);
  }
  if (
    input.durationMs !== undefined
    && (!Number.isSafeInteger(input.durationMs)
      || input.durationMs < 60_000
      || input.durationMs > MAX_MODE_DURATION_MS)
  ) {
    throw new Error('Maison mode duration must be between 1 minute and 30 days');
  }
  return {
    mode: input.mode as HomeMode,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };
}

function parseTimerInput(value: unknown): MaisonTimerStartInput {
  if (typeof value !== 'object' || value === null) throw new Error('Cooking timer input is required');
  const input = value as Partial<MaisonTimerStartInput>;
  if (typeof input.label !== 'string' || !input.label.trim()) throw new Error('Cooking timer label is required');
  if (!Number.isSafeInteger(input.durationMs)) throw new Error('Cooking timer duration must be an integer');
  return { label: input.label.trim(), durationMs: input.durationMs! };
}

function parseId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('\0')) {
    throw new Error('A valid timer id is required');
  }
  return value.trim();
}

export function registerMaisonIpcHandlers(deps: MaisonIpcDeps = {}): void {
  ipcMain.handle('maison.snapshot', () => readMaisonSnapshot(deps));
  ipcMain.handle('maison.setMode', async (_event, value: unknown) => {
    const input = parseModeInput(value);
    await homeModeStore(deps).setMode(input.mode, {
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
    return readMaisonSnapshot(deps);
  });
  ipcMain.handle('maison.timerStart', async (_event, value: unknown) => {
    const input = parseTimerInput(value);
    await cookingTimerStore(deps).start(input.durationMs, input.label);
    return readMaisonSnapshot(deps);
  });
  ipcMain.handle('maison.timerAcknowledge', async (_event, value: unknown) => {
    await cookingTimerStore(deps).acknowledge(parseId(value), currentTime(deps));
    return readMaisonSnapshot(deps);
  });
  ipcMain.handle('maison.timerCancel', async (_event, value: unknown) => {
    await cookingTimerStore(deps).cancel(parseId(value));
    return readMaisonSnapshot(deps);
  });
}
