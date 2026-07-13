import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MealPlanStore } from '../../src/meals/meal-plan-store.js';
import { MealStoreCorruptionError } from '../../src/meals/private-json-store.js';
import type { FoodProvenance } from '../../src/meals/types.js';

let tmpDir: string;
let filePath: string;

const provenance: FoodProvenance = {
  source: 'user',
  sourceId: 'meal-plan-test',
  recordedAt: '2026-07-12T08:00:00.000Z',
  status: 'confirmed',
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-plan-store-'));
  filePath = path.join(tmpDir, 'private', 'meal-plan.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MealPlanStore CRUD and privacy', () => {
  it('creates, reads, updates and removes explicit meal entries', async () => {
    let now = new Date('2026-07-12T08:00:00.000Z');
    const store = new MealPlanStore({ filePath, now: () => now });
    const created = await store.create({
      localDate: '2026-07-13',
      localTime: '12:30',
      slot: 'lunch',
      recipeId: 'recipe-ratatouille',
      recipeTitle: 'Ratatouille',
      status: 'suggested',
      timeZone: 'Europe/Paris',
      provenance,
    });

    expect((await store.get(created.id))?.status).toBe('suggested');
    expect(await store.list({ slot: 'lunch' })).toHaveLength(1);
    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);

    now = new Date('2026-07-12T09:00:00.000Z');
    const updated = await store.update(created.id, {
      status: 'planned',
      provenance: { ...provenance, sourceId: 'meal-plan-confirmation' },
    });
    expect(updated?.status).toBe('planned');
    expect(updated?.updatedAt).toBe('2026-07-12T09:00:00.000Z');
    expect(updated?.createdAt).toBe(created.createdAt);

    await expect(store.remove(created.id)).resolves.toEqual(updated);
    await expect(store.get(created.id)).resolves.toBeNull();
  });

  it('rejects an impossible local date and an invalid IANA timezone', async () => {
    const store = new MealPlanStore({ filePath });
    const base = {
      localTime: '12:00',
      slot: 'lunch' as const,
      recipeId: 'recipe',
      recipeTitle: 'Recette',
      timeZone: 'Europe/Paris',
      provenance,
    };

    await expect(store.create({ ...base, localDate: '2026-02-30' })).rejects.toThrow(/existing Gregorian date/);
    await expect(store.create({
      ...base,
      localDate: '2026-07-12',
      timeZone: 'Mars/Olympus_Mons',
    })).rejects.toThrow(/Invalid IANA/);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('fails closed on corrupt data instead of overwriting it', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not-json', { mode: 0o600 });
    const store = new MealPlanStore({ filePath });

    await expect(store.list()).rejects.toBeInstanceOf(MealStoreCorruptionError);
    await expect(store.create({
      localDate: '2026-07-13',
      localTime: '12:00',
      slot: 'lunch',
      recipeId: 'recipe',
      recipeTitle: 'Recette',
      timeZone: 'Europe/Paris',
      provenance,
    })).rejects.toBeInstanceOf(MealStoreCorruptionError);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{not-json');
  });
});

describe('MealPlanStore nextUpcoming', () => {
  it('resolves a spring DST gap using the shared life-rhythm policy', async () => {
    const store = new MealPlanStore({ filePath });
    await store.create({
      localDate: '2026-03-29',
      localTime: '02:30',
      slot: 'breakfast',
      recipeId: 'gap-breakfast',
      recipeTitle: 'Petit déjeuner du changement d’heure',
      status: 'planned',
      timeZone: 'Europe/Paris',
      provenance,
    });
    await store.create({
      localDate: '2026-03-29',
      localTime: '19:00',
      slot: 'dinner',
      recipeId: 'later-dinner',
      recipeTitle: 'Dîner',
      status: 'planned',
      timeZone: 'Europe/Paris',
      provenance,
    });

    const next = await store.nextUpcoming(new Date('2026-03-29T00:50:00.000Z'));

    expect(next?.entry.recipeId).toBe('gap-breakfast');
    expect(next?.scheduledAt).toBe('2026-03-29T01:00:00.000Z');
    expect(next?.utcOffsetMinutes).toBe(120);
    expect(next?.adjustment).toBe('gap-forward');
  });

  it('compares different local timezones by absolute instant', async () => {
    const store = new MealPlanStore({ filePath });
    await store.create({
      localDate: '2026-07-13',
      localTime: '07:00',
      slot: 'breakfast',
      recipeId: 'new-york-breakfast',
      recipeTitle: 'Petit déjeuner New York',
      status: 'planned',
      timeZone: 'America/New_York',
      provenance,
    });
    await store.create({
      localDate: '2026-07-13',
      localTime: '08:00',
      slot: 'breakfast',
      recipeId: 'paris-breakfast',
      recipeTitle: 'Petit déjeuner Paris',
      status: 'planned',
      timeZone: 'Europe/Paris',
      provenance,
    });

    const next = await store.nextUpcoming(new Date('2026-07-13T05:00:00.000Z'));

    expect(next?.entry.recipeId).toBe('paris-breakfast');
    expect(next?.scheduledAt).toBe('2026-07-13T06:00:00.000Z');
  });

  it('ignores cooked and skipped entries', async () => {
    const store = new MealPlanStore({ filePath });
    for (const [recipeId, status, localTime] of [
      ['already-cooked', 'cooked', '08:00'],
      ['skipped-meal', 'skipped', '09:00'],
      ['planned-meal', 'planned', '10:00'],
    ] as const) {
      await store.create({
        localDate: '2026-07-13',
        localTime,
        slot: 'snack',
        recipeId,
        recipeTitle: recipeId,
        status,
        timeZone: 'Europe/Paris',
        provenance,
      });
    }

    const next = await store.nextUpcoming(new Date('2026-07-13T05:00:00.000Z'));
    expect(next?.entry.recipeId).toBe('planned-meal');
  });
});
