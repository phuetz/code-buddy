import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { canonicalizeTimeZone } from '../life-rhythm/day-context.js';
import {
  findNextZonedMinute,
  type ZonedMinuteAdjustment,
} from '../life-rhythm/zoned-minute.js';
import { readPrivateMealJson, writePrivateMealJson } from './private-json-store.js';
import {
  cloneFoodProvenance,
  isOffsetTimestamp,
  isRecord,
  isValidLocalDate,
  parseFoodProvenance,
  parseLocalTime,
  requireFoodProvenance,
  requireLocalDate,
  requireLocalTime,
  requireNonEmptyText,
} from './store-validation.js';
import type { FoodProvenance } from './types.js';

const MEAL_PLAN_SCHEMA_VERSION = 1 as const;
const STORE_LABEL = 'meal plan store';
const ENTRY_ID_RE = /^meal_[0-9a-f-]{36}$/i;

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = typeof MEAL_SLOTS[number];

export const MEAL_PLAN_STATUSES = ['suggested', 'planned', 'cooked', 'skipped'] as const;
export type MealPlanStatus = typeof MEAL_PLAN_STATUSES[number];

export interface MealPlanEntry {
  id: string;
  /** Explicit local civil date. The store never derives or invents this value. */
  localDate: string;
  localTime: string;
  slot: MealSlot;
  recipeId: string;
  recipeTitle: string;
  status: MealPlanStatus;
  timeZone: string;
  provenance: FoodProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMealPlanEntry {
  localDate: string;
  localTime: string;
  slot: MealSlot;
  recipeId: string;
  recipeTitle: string;
  status?: MealPlanStatus;
  timeZone: string;
  provenance: FoodProvenance;
}

export interface UpdateMealPlanEntry {
  localDate?: string;
  localTime?: string;
  slot?: MealSlot;
  recipeId?: string;
  recipeTitle?: string;
  status?: MealPlanStatus;
  timeZone?: string;
  /** Every mutation carries explicit provenance instead of inheriting intent. */
  provenance: FoodProvenance;
}

export interface MealPlanListFilter {
  localDate?: string;
  slot?: MealSlot;
  status?: MealPlanStatus;
}

export interface UpcomingMealPlanEntry {
  entry: MealPlanEntry;
  scheduledAt: string;
  utcOffsetMinutes: number;
  adjustment: ZonedMinuteAdjustment;
}

interface PersistedMealPlan {
  schemaVersion: typeof MEAL_PLAN_SCHEMA_VERSION;
  entries: MealPlanEntry[];
}

export interface MealPlanStoreOptions {
  filePath?: string;
  now?: () => Date;
}

function defaultFilePath(): string {
  return path.join(homedir(), '.codebuddy', 'life', 'meals', 'meal-plan.json');
}

function isMealSlot(value: unknown): value is MealSlot {
  return typeof value === 'string' && (MEAL_SLOTS as readonly string[]).includes(value);
}

function isMealPlanStatus(value: unknown): value is MealPlanStatus {
  return typeof value === 'string' && (MEAL_PLAN_STATUSES as readonly string[]).includes(value);
}

function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return canonicalizeTimeZone(value);
  } catch {
    return null;
  }
}

function parseEntry(value: unknown): MealPlanEntry | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !ENTRY_ID_RE.test(value.id)
    || !isValidLocalDate(value.localDate)
    || !parseLocalTime(value.localTime)
    || !isMealSlot(value.slot)
    || typeof value.recipeId !== 'string'
    || value.recipeId.trim().length === 0
    || value.recipeId !== value.recipeId.trim()
    || typeof value.recipeTitle !== 'string'
    || value.recipeTitle.trim().length === 0
    || value.recipeTitle !== value.recipeTitle.trim()
    || value.recipeTitle.length > 200
    || !isMealPlanStatus(value.status)
    || !isOffsetTimestamp(value.createdAt)
    || !isOffsetTimestamp(value.updatedAt)) {
    return null;
  }
  const timeZone = canonicalTimeZone(value.timeZone);
  const provenance = parseFoodProvenance(value.provenance);
  if (!timeZone || !provenance) return null;
  return {
    id: value.id,
    localDate: value.localDate,
    localTime: value.localTime as string,
    slot: value.slot,
    recipeId: value.recipeId,
    recipeTitle: value.recipeTitle,
    status: value.status,
    timeZone,
    provenance,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseEnvelope(value: unknown): PersistedMealPlan | null {
  if (!isRecord(value)
    || value.schemaVersion !== MEAL_PLAN_SCHEMA_VERSION
    || !Array.isArray(value.entries)) {
    return null;
  }
  const entries = value.entries.map(parseEntry);
  if (entries.some(entry => entry === null)) return null;
  const validEntries = entries as MealPlanEntry[];
  if (new Set(validEntries.map(entry => entry.id)).size !== validEntries.length) return null;
  return {
    schemaVersion: MEAL_PLAN_SCHEMA_VERSION,
    entries: validEntries,
  };
}

function cloneEntry(entry: MealPlanEntry): MealPlanEntry {
  return { ...entry, provenance: cloneFoodProvenance(entry.provenance) };
}

function validateStatus(value: unknown): MealPlanStatus {
  if (!isMealPlanStatus(value)) throw new RangeError(`Invalid meal plan status: ${String(value)}`);
  return value;
}

function validateSlot(value: unknown): MealSlot {
  if (!isMealSlot(value)) throw new RangeError(`Invalid meal slot: ${String(value)}`);
  return value;
}

function validateTimeZone(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('timeZone must be an IANA timezone string.');
  return canonicalizeTimeZone(value);
}

function normalizeCreateInput(input: CreateMealPlanEntry): Omit<MealPlanEntry, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    localDate: requireLocalDate(input.localDate),
    localTime: requireLocalTime(input.localTime).value,
    slot: validateSlot(input.slot),
    recipeId: requireNonEmptyText(input.recipeId, 'recipeId', 200),
    recipeTitle: requireNonEmptyText(input.recipeTitle, 'recipeTitle', 200),
    status: validateStatus(input.status ?? 'suggested'),
    timeZone: validateTimeZone(input.timeZone),
    provenance: requireFoodProvenance(input.provenance),
  };
}

function compareCivilDate(left: string, right: string): number {
  return left.localeCompare(right);
}

/** Resolve one fixed civil date/minute using life-rhythm's established DST policy. */
function resolveFixedCivilMinute(entry: MealPlanEntry): UpcomingMealPlanEntry {
  const [yearText, monthText, dayText] = entry.localDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const clock = requireLocalTime(entry.localTime);
  let cursor = new Date(Date.UTC(year, month - 1, day - 3, 0, 0, 0, 0));

  for (let attempt = 0; attempt < 8; attempt++) {
    const occurrence = findNextZonedMinute(
      cursor,
      entry.timeZone,
      clock.hour,
      clock.minute,
    );
    const comparison = compareCivilDate(occurrence.requestedLocalDate, entry.localDate);
    if (comparison === 0) {
      return {
        entry: cloneEntry(entry),
        scheduledAt: occurrence.instant.toISOString(),
        utcOffsetMinutes: occurrence.utcOffsetMinutes,
        adjustment: occurrence.adjustment,
      };
    }
    if (comparison > 0) break;
    cursor = occurrence.instant;
  }
  throw new Error(`Unable to resolve meal civil time ${entry.localDate} ${entry.localTime} in ${entry.timeZone}.`);
}

export class MealPlanStore {
  readonly filePath: string;
  private readonly now: () => Date;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: MealPlanStoreOptions = {}) {
    this.filePath = path.resolve(options.filePath ?? defaultFilePath());
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateMealPlanEntry): Promise<MealPlanEntry> {
    const normalized = normalizeCreateInput(input);
    return this.enqueueMutation(async () => {
      const now = this.currentTime().toISOString();
      const entry: MealPlanEntry = {
        id: `meal_${randomUUID()}`,
        ...normalized,
        createdAt: now,
        updatedAt: now,
      };
      const entries = await this.readEntries();
      entries.push(entry);
      await this.writeEntries(entries);
      return cloneEntry(entry);
    });
  }

  async get(id: string): Promise<MealPlanEntry | null> {
    await this.mutationTail;
    const entry = (await this.readEntries()).find(candidate => candidate.id === id);
    return entry ? cloneEntry(entry) : null;
  }

  async list(filter: MealPlanListFilter = {}): Promise<MealPlanEntry[]> {
    await this.mutationTail;
    if (filter.localDate !== undefined) requireLocalDate(filter.localDate);
    if (filter.slot !== undefined) validateSlot(filter.slot);
    if (filter.status !== undefined) validateStatus(filter.status);
    return (await this.readEntries())
      .filter(entry => filter.localDate === undefined || entry.localDate === filter.localDate)
      .filter(entry => filter.slot === undefined || entry.slot === filter.slot)
      .filter(entry => filter.status === undefined || entry.status === filter.status)
      .sort((left, right) => left.localDate.localeCompare(right.localDate)
        || left.localTime.localeCompare(right.localTime)
        || left.id.localeCompare(right.id))
      .map(cloneEntry);
  }

  async update(id: string, patch: UpdateMealPlanEntry): Promise<MealPlanEntry | null> {
    const provenance = requireFoodProvenance(patch.provenance);
    return this.enqueueMutation(async () => {
      const entries = await this.readEntries();
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) return null;
      const current = entries[index]!;
      const normalized = normalizeCreateInput({
        localDate: patch.localDate ?? current.localDate,
        localTime: patch.localTime ?? current.localTime,
        slot: patch.slot ?? current.slot,
        recipeId: patch.recipeId ?? current.recipeId,
        recipeTitle: patch.recipeTitle ?? current.recipeTitle,
        status: patch.status ?? current.status,
        timeZone: patch.timeZone ?? current.timeZone,
        provenance,
      });
      const updated: MealPlanEntry = {
        id: current.id,
        ...normalized,
        createdAt: current.createdAt,
        updatedAt: this.currentTime().toISOString(),
      };
      entries[index] = updated;
      await this.writeEntries(entries);
      return cloneEntry(updated);
    });
  }

  async remove(id: string): Promise<MealPlanEntry | null> {
    return this.enqueueMutation(async () => {
      const entries = await this.readEntries();
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) return null;
      const [removed] = entries.splice(index, 1);
      await this.writeEntries(entries);
      return removed ? cloneEntry(removed) : null;
    });
  }

  async nextUpcoming(at?: Date | number): Promise<UpcomingMealPlanEntry | null> {
    await this.mutationTail;
    const now = this.resolveTime(at);
    const occurrences = (await this.readEntries())
      .filter(entry => entry.status === 'suggested' || entry.status === 'planned')
      .map(resolveFixedCivilMinute)
      .filter(occurrence => Date.parse(occurrence.scheduledAt) >= now.getTime())
      .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)
        || left.entry.id.localeCompare(right.entry.id));
    return occurrences[0] ?? null;
  }

  private currentTime(): Date {
    return this.resolveTime(this.now());
  }

  private resolveTime(value?: Date | number): Date {
    const date = value === undefined
      ? this.now()
      : value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);
    if (Number.isNaN(date.getTime())) throw new RangeError('Meal plan clock must be a valid instant.');
    return date;
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readEntries(): Promise<MealPlanEntry[]> {
    const envelope = await readPrivateMealJson(this.filePath, STORE_LABEL, parseEnvelope);
    return envelope?.entries.map(cloneEntry) ?? [];
  }

  private async writeEntries(entries: MealPlanEntry[]): Promise<void> {
    const envelope: PersistedMealPlan = {
      schemaVersion: MEAL_PLAN_SCHEMA_VERSION,
      entries: entries.map(cloneEntry),
    };
    await writePrivateMealJson(this.filePath, STORE_LABEL, envelope);
  }
}
