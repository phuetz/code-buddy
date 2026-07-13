import { Command, InvalidArgumentError, Option } from 'commander';
import {
  EtalabHolidayProvider,
  HOME_MODES,
  HomeModeStore,
  CookingTimerStore,
  buildDayContext,
  resolveZonedDateTime,
  type DayContext,
  type EtalabHolidayZone,
  type HomeMode,
  type PresenceSnapshot,
  type PublicHolidayProvider,
} from '../life-rhythm/index.js';
import type { PresenceContext } from '../memory/presence-injector.js';
import type {
  FoodInventoryStore,
  FoodProfileStore,
  MealPlanStore,
} from '../meals/index.js';
import { registerMaisonFoodCommands } from './maison-food.js';

export interface MaisonCommandDeps {
  now?: () => Date;
  timeZone?: string;
  holidayZone?: EtalabHolidayZone;
  holidayProvider?: PublicHolidayProvider;
  homeModeStore?: HomeModeStore;
  readPresence?: () => Promise<PresenceContext>;
  foodProfileStore?: FoodProfileStore;
  mealPlanStore?: MealPlanStore;
  foodInventoryStore?: FoodInventoryStore;
  cookingTimerStore?: CookingTimerStore;
}

function parseDuration(value: string): number {
  const match = /^(\d+)(m|h|d)$/i.exec(value.trim());
  if (!match) throw new InvalidArgumentError('duration must look like 30m, 2h or 1d');
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const multiplier = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result) || result < 60_000 || result > 30 * 86_400_000) {
    throw new InvalidArgumentError('duration must be between 1 minute and 30 days');
  }
  return result;
}

function parseTimerDuration(value: string): number {
  const match = /^(\d+)(s|m|h)$/i.exec(value.trim());
  if (!match) throw new InvalidArgumentError('timer duration must look like 45s, 10m or 2h');
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const multiplier = unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result) || result < 1_000 || result > 24 * 3_600_000) {
    throw new InvalidArgumentError('timer duration must be between 1 second and 24 hours');
  }
  return result;
}

function currentTime(deps: MaisonCommandDeps): Date {
  const value = deps.now?.() ?? new Date();
  if (Number.isNaN(value.getTime())) throw new Error('Maison clock returned an invalid date');
  return new Date(value.getTime());
}

function householdYear(deps: MaisonCommandDeps): number {
  const zone = deps.timeZone
    || process.env.CODEBUDDY_TIMEZONE
    || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return Number(resolveZonedDateTime(currentTime(deps), zone).localDate.slice(0, 4));
}

async function defaultReadPresence(): Promise<PresenceContext> {
  const { readPresenceContext } = await import('../memory/presence-injector.js');
  return readPresenceContext();
}

function toPresenceSnapshot(context: PresenceContext, now: Date): PresenceSnapshot {
  if (!context.hasMatch) {
    return {
      status: 'unknown',
      source: context.hasUnknownFace ? 'camera' : 'none',
      ...(Number.isFinite(context.ageMs)
        ? { observedAt: new Date(now.getTime() - context.ageMs).toISOString() }
        : {}),
    };
  }
  return {
    status: 'home',
    source: 'camera',
    observedAt: new Date(now.getTime() - Math.max(0, context.ageMs)).toISOString(),
    ...(context.confidence !== undefined ? { confidence: context.confidence } : {}),
  };
}

async function resolveContext(deps: MaisonCommandDeps): Promise<DayContext> {
  const now = currentTime(deps);
  const timeZone = deps.timeZone
    || process.env.CODEBUDDY_TIMEZONE
    || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const provider = deps.holidayProvider ?? new EtalabHolidayProvider({
    zone: deps.holidayZone
      ?? (process.env.CODEBUDDY_HOLIDAY_ZONE || 'metropole') as EtalabHolidayZone,
  });
  const presenceContext = await (deps.readPresence ?? defaultReadPresence)();
  return buildDayContext({
    instant: now,
    timeZone,
    holidayProvider: provider,
    homeModeStore: deps.homeModeStore ?? new HomeModeStore(),
    presence: toPresenceSnapshot(presenceContext, now),
  });
}

function renderContext(context: DayContext): string {
  const day = context.dayKind === 'public_holiday'
    ? `jour férié · ${context.publicHoliday?.name ?? 'nom inconnu'}`
    : context.dayKind === 'weekend'
      ? 'week-end'
      : context.dayKind === 'workday'
        ? 'jour ouvré confirmé'
        : 'type de journée à confirmer';
  const presence = context.presence.status === 'home'
    ? `présence confirmée (${context.presence.source})`
    : context.presence.status === 'away'
      ? `absence confirmée (${context.presence.source})`
      : 'présence inconnue';
  const freshness = context.holidayProvenance.source === 'unavailable'
    ? 'calendrier indisponible'
    : `calendrier ${context.holidayProvenance.source}/${context.holidayProvenance.freshness}`;
  return [
    `Maison · ${context.localDate} ${context.localTime.slice(0, 5)} · ${context.timeZone}`,
    `Journée : ${day}`,
    `Mode : ${context.homeMode.mode}${context.homeMode.expiresAt ? ` jusqu’au ${context.homeMode.expiresAt}` : ''}`,
    `Présence : ${presence}`,
    `Source : ${freshness}`,
  ].join('\n');
}

export function createMaisonCommand(deps: MaisonCommandDeps = {}): Command {
  const command = new Command('maison')
    .description('Household rhythm, public holidays, presence posture and quiet modes');

  command
    .command('status', { isDefault: true })
    .description('Show the factual Maison context without assuming that a free day means presence')
    .option('--json', 'Print structured JSON')
    .action(async (options: { json?: boolean }) => {
      const context = await resolveContext(deps);
      console.log(options.json ? JSON.stringify(context, null, 2) : renderContext(context));
    });

  command
    .command('mode')
    .description('Set an explicit household posture')
    .argument('<mode>', HOME_MODES.join('|'))
    .addOption(new Option('--for <duration>', 'Expire after 30m, 2h, 1d…').argParser(parseDuration))
    .option('--until <timestamp>', 'Expire at an exact ISO timestamp')
    .option('--json', 'Print structured JSON')
    .action(async (
      rawMode: string,
      options: { for?: number; until?: string; json?: boolean }
    ) => {
      if (!(HOME_MODES as readonly string[]).includes(rawMode)) {
        throw new InvalidArgumentError(`mode must be one of: ${HOME_MODES.join(', ')}`);
      }
      if (options.for !== undefined && options.until !== undefined) {
        throw new InvalidArgumentError('--for and --until are mutually exclusive');
      }
      const state = await (deps.homeModeStore ?? new HomeModeStore()).setMode(rawMode as HomeMode, {
        ...(options.for !== undefined ? { durationMs: options.for } : {}),
        ...(options.until !== undefined ? { expiresAt: options.until } : {}),
      });
      console.log(options.json
        ? JSON.stringify(state, null, 2)
        : `Mode Maison : ${state.mode}${state.expiresAt ? ` jusqu’au ${state.expiresAt}` : ''}`);
    });

  command
    .command('silence')
    .description('Stop non-essential spontaneous contact immediately')
    .addOption(new Option('--for <duration>', 'Optional duration, e.g. 8h').argParser(parseDuration))
    .action(async (options: { for?: number }) => {
      const state = await (deps.homeModeStore ?? new HomeModeStore()).setMode('silent', {
        ...(options.for !== undefined ? { durationMs: options.for } : {}),
      });
      console.log(`Maison silencieuse${state.expiresAt ? ` jusqu’au ${state.expiresAt}` : ''}.`);
    });

  command
    .command('resume')
    .description('Return to normal household rhythm')
    .action(async () => {
      await (deps.homeModeStore ?? new HomeModeStore()).reset();
      console.log('Mode Maison normal rétabli.');
    });

  command
    .command('holidays')
    .description('Show official French public holidays and their provenance')
    .argument('[year]', 'Calendar year', String(householdYear(deps)))
    .option('--json', 'Print structured JSON')
    .action(async (rawYear: string, options: { json?: boolean }) => {
      const year = Number(rawYear);
      const provider = deps.holidayProvider ?? new EtalabHolidayProvider({
        zone: deps.holidayZone
          ?? (process.env.CODEBUDDY_HOLIDAY_ZONE || 'metropole') as EtalabHolidayZone,
      });
      if (!(provider instanceof EtalabHolidayProvider)) {
        throw new Error('The configured holiday provider does not expose yearly listings');
      }
      const result = await provider.getHolidays(year);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Jours fériés ${year} · ${result.provenance.source}/${result.provenance.freshness}`);
      for (const holiday of result.holidays) console.log(`${holiday.date} · ${holiday.name}`);
      if (!result.available) console.log(`Indisponible : ${result.error ?? 'aucune source'}`);
    });

  const timers = command
    .command('timer')
    .description('Persistent named cooking timers that survive a restart');
  const cookingTimerStore = deps.cookingTimerStore ?? new CookingTimerStore();

  timers
    .command('start')
    .argument('<duration>', '45s, 10m or 2h', parseTimerDuration)
    .argument('<label>', 'Name spoken when the timer is due')
    .option('--json', 'Print structured JSON')
    .action(async (durationMs: number, label: string, options: { json?: boolean }) => {
      const timer = await cookingTimerStore.start(durationMs, label);
      console.log(options.json
        ? JSON.stringify(timer, null, 2)
        : `Minuteur « ${timer.label} » lancé jusqu’à ${timer.dueAt} · ${timer.id}`);
    });

  timers
    .command('list', { isDefault: true })
    .option('--json', 'Print structured JSON')
    .action(async (options: { json?: boolean }) => {
      const active = await cookingTimerStore.listActive(currentTime(deps));
      if (options.json) console.log(JSON.stringify(active, null, 2));
      else if (active.length === 0) console.log('Aucun minuteur de cuisine actif.');
      else active.forEach((timer) => console.log(
        `${timer.state === 'due' ? '⏰' : '◷'} ${timer.label} · ${timer.state} · `
        + `${Math.ceil(timer.remainingMs / 1_000)}s · ${timer.id}`
      ));
    });

  timers
    .command('cancel')
    .argument('<id>')
    .action(async (id: string) => {
      const timer = await cookingTimerStore.cancel(id);
      if (!timer) throw new Error(`Unknown cooking timer: ${id}`);
      console.log(`Minuteur « ${timer.label} » annulé.`);
    });

  timers
    .command('acknowledge')
    .alias('ack')
    .argument('<id>')
    .action(async (id: string) => {
      const timer = await cookingTimerStore.acknowledge(id, currentTime(deps));
      if (!timer) throw new Error(`Timer is missing or not due yet: ${id}`);
      console.log(`Minuteur « ${timer.label} » acquitté.`);
    });

  registerMaisonFoodCommands(command, {
    ...(deps.foodProfileStore ? { foodProfileStore: deps.foodProfileStore } : {}),
    ...(deps.mealPlanStore ? { mealPlanStore: deps.mealPlanStore } : {}),
    ...(deps.foodInventoryStore ? { foodInventoryStore: deps.foodInventoryStore } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
  });

  return command;
}
