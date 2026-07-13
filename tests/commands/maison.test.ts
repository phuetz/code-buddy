import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMaisonCommand, type MaisonCommandDeps } from '../../src/commands/maison.js';
import {
  CookingTimerStore,
  HomeModeStore,
  type PublicHolidayProvider,
} from '../../src/life-rhythm/index.js';
import {
  FoodInventoryStore,
  FoodProfileStore,
  MealPlanStore,
} from '../../src/meals/index.js';

const NOW = new Date('2026-07-14T10:00:00.000Z');

function holidayProvider(): PublicHolidayProvider {
  return {
    lookup: async (date) => ({
      date,
      available: true,
      holiday: date === '2026-07-14'
        ? { date, name: '14 juillet', zone: 'metropole' }
        : null,
      provenance: {
        provider: 'etalab-calendrier-api-gouv-fr',
        source: 'cache',
        freshness: 'fresh',
        checkedAt: NOW.toISOString(),
        fetchedAt: NOW.toISOString(),
        year: 2026,
        zone: 'metropole',
      },
    }),
  };
}

describe('buddy maison', () => {
  let dir: string;
  let deps: MaisonCommandDeps;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maison-command-'));
    deps = {
      now: () => new Date(NOW),
      timeZone: 'Europe/Paris',
      holidayProvider: holidayProvider(),
      homeModeStore: new HomeModeStore({
        filePath: join(dir, 'home-mode.json'),
        now: () => new Date(NOW),
      }),
      readPresence: async () => ({
        hasMatch: true,
        hasUnknownFace: false,
        ageMs: 2_000,
        confidence: 0.98,
      }),
      foodProfileStore: new FoodProfileStore({
        storePath: join(dir, 'food-profile.enc.json'),
        localKeyPath: join(dir, 'food.key'),
        encryptionKey: 'test-maison-encryption-secret',
        now: () => new Date(NOW),
      }),
      mealPlanStore: new MealPlanStore({
        filePath: join(dir, 'meal-plan.json'),
        now: () => new Date(NOW),
      }),
      foodInventoryStore: new FoodInventoryStore({
        filePath: join(dir, 'food-inventory.json'),
        now: () => new Date(NOW),
      }),
      cookingTimerStore: new CookingTimerStore({
        filePath: join(dir, 'cooking-timers.json'),
        now: () => new Date(NOW),
      }),
    };
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<string> {
    log.mockClear();
    await createMaisonCommand(deps)
      .exitOverride()
      .parseAsync(['node', 'maison', ...args]);
    return log.mock.calls.map((call) => String(call[0])).join('\n');
  }

  it('reports holiday, presence and mode as independent facts', async () => {
    const output = JSON.parse(await run('status', '--json')) as {
      dayKind: string;
      publicHoliday: { name: string };
      homeMode: { mode: string };
      presence: { status: string };
    };
    expect(output).toMatchObject({
      dayKind: 'public_holiday',
      publicHoliday: { name: '14 juillet' },
      homeMode: { mode: 'normal' },
      presence: { status: 'home' },
    });
  });

  it('persists an expiring explicit free-day mode', async () => {
    await run('mode', 'free-day', '--for', '2h', '--json');
    const state = await deps.homeModeStore!.getCurrent();
    expect(state).toMatchObject({
      mode: 'free-day',
      expiresAt: '2026-07-14T12:00:00.000Z',
    });
  });

  it('keeps health-adjacent rules unconfirmed unless explicitly confirmed', async () => {
    const outputText = await run('food', 'add', 'allergy', 'allergen', 'lait', '--json');
    const output = JSON.parse(outputText) as { status: string; targetType: string };
    expect(output).toMatchObject({ status: 'unknown', targetType: 'allergen' });
    expect(outputText).not.toContain('milk');

    const summary = await run('food', 'status', '--json');
    expect(JSON.parse(summary)).toMatchObject({
      configured: true,
      constraintCount: 1,
      unknownCount: 1,
    });
    expect(summary).not.toContain('milk');
  });

  it('blocks a recipe that explicitly declares a confirmed allergen', async () => {
    await run('food', 'add', 'allergy', 'allergen', 'lait', '--confirm');
    const recipePath = join(dir, 'recipe.json');
    writeFileSync(recipePath, JSON.stringify({
      title: 'Purée au lait',
      servings: 2,
      provenance: {
        source: 'recipe',
        sourceId: 'test-recipe',
        recordedAt: NOW.toISOString(),
        status: 'confirmed',
      },
      ingredients: [{
        name: 'lait',
        quantity: 25,
        unit: 'cl',
        allergenDisclosure: {
          status: 'known',
          contains: ['milk'],
          mayContain: [],
          provenance: {
            source: 'label',
            sourceId: 'carton-label',
            recordedAt: NOW.toISOString(),
            status: 'confirmed',
          },
        },
      }],
    }), 'utf8');

    const output = JSON.parse(
      await run('food', 'verify', recipePath, '--json')
    ) as { verdict: { status: string; blocking: boolean } };
    expect(output.verdict).toMatchObject({ status: 'incompatible', blocking: true });
  });

  it('starts and restores a named cooking timer', async () => {
    const started = JSON.parse(
      await run('timer', 'start', '10m', 'pâtes', '--json')
    ) as { id: string; label: string; dueAt: string };
    expect(started).toMatchObject({
      label: 'pâtes',
      dueAt: '2026-07-14T10:10:00.000Z',
    });

    const active = JSON.parse(await run('timer', 'list', '--json')) as Array<{ id: string }>;
    expect(active.map((timer) => timer.id)).toContain(started.id);
  });

  it('manages a meal plan and resolves the next meal in the Maison timezone', async () => {
    const added = JSON.parse(await run(
      'food', 'plan', 'add',
      '2026-07-14', '14:30', 'snack', 'recipe-tarte', 'Tarte aux pommes',
      '--status', 'planned', '--json'
    )) as { id: string; status: string; timeZone: string; localDate: string; localTime: string };
    expect(added).toMatchObject({
      status: 'planned',
      timeZone: 'Europe/Paris',
      localDate: '2026-07-14',
      localTime: '14:30',
    });

    const listed = JSON.parse(
      await run('food', 'plan', 'list', '--status', 'planned', '--json')
    ) as Array<{ id: string }>;
    expect(listed.map((entry) => entry.id)).toEqual([added.id]);

    const next = JSON.parse(await run('food', 'plan', 'next', '--json')) as {
      entry: { id: string };
      scheduledAt: string;
    };
    expect(next).toMatchObject({
      entry: { id: added.id },
      scheduledAt: '2026-07-14T12:30:00.000Z',
    });

    const cooked = JSON.parse(
      await run('food', 'plan', 'status', added.id, 'cooked', '--json')
    ) as { status: string };
    expect(cooked.status).toBe('cooked');
    expect(await run('food', 'plan', 'next', '--json')).toBe('null');

    const removed = JSON.parse(
      await run('food', 'plan', 'remove', added.id, '--json')
    ) as { id: string };
    expect(removed.id).toBe(added.id);
    expect(JSON.parse(await run('food', 'plan', 'list', '--json'))).toEqual([]);
  });

  it('manages pantry and leftovers with explicit active filtering', async () => {
    const expired = JSON.parse(await run(
      'food', 'inventory', 'add', 'pantry', 'Pain',
      '--until', '2026-07-14T09:00:00.000Z', '--json'
    )) as { id: string };
    const leftover = JSON.parse(await run(
      'food', 'inventory', 'add', 'leftover', 'Ratatouille',
      '--status', 'unknown', '--quantity', '2', '--unit', 'portions',
      '--until', '2026-07-15T10:00:00.000Z', '--json'
    )) as {
      id: string;
      kind: string;
      status: string;
      quantity: number;
      provenance: { status: string };
    };
    expect(leftover).toMatchObject({
      kind: 'leftover',
      status: 'unknown',
      quantity: 2,
      provenance: { status: 'unknown' },
    });

    const all = JSON.parse(await run('food', 'inventory', 'list', '--json')) as Array<{ id: string }>;
    expect(all.map((item) => item.id).sort()).toEqual([expired.id, leftover.id].sort());

    const activeLeftovers = JSON.parse(await run(
      'food', 'inventory', 'list', '--active', '--kind', 'leftover', '--json'
    )) as Array<{ id: string }>;
    expect(activeLeftovers.map((item) => item.id)).toEqual([leftover.id]);

    const confirmedLeftover = JSON.parse(await run(
      'food', 'inventory', 'add', 'leftover', 'Soupe de légumes',
      '--quantity', '2', '--unit', 'portions',
      '--until', '2026-07-15T10:00:00.000Z', '--json'
    )) as { id: string };
    await run('food', 'add', 'preference', 'tag', 'rapide');
    const recipesPath = join(dir, 'recipes.json');
    const provenance = {
      source: 'recipe',
      sourceId: 'cli-recipes',
      recordedAt: NOW.toISOString(),
      status: 'confirmed',
    };
    writeFileSync(recipesPath, JSON.stringify([{
      id: 'soupe-rechauffee',
      title: 'Soupe réchauffée',
      servings: 2,
      tags: ['rapide'],
      provenance,
      ingredients: [{
        id: 'soupe-legumes',
        name: 'Soupe de légumes',
        quantity: 2,
        unit: 'portions',
        provenance,
        allergenDisclosure: {
          status: 'known',
          contains: [],
          mayContain: [],
          provenance: {
            ...provenance,
            source: 'label',
          },
        },
      }],
    }]), 'utf8');
    const suggestions = JSON.parse(
      await run('food', 'suggest', recipesPath, '--json')
    ) as { suggestions: Array<{ matchedInventoryIds: string[] }> };
    expect(suggestions.suggestions[0]?.matchedInventoryIds).toEqual([confirmedLeftover.id]);

    const removed = JSON.parse(
      await run('food', 'inventory', 'remove', leftover.id, '--json')
    ) as { id: string };
    expect(removed.id).toBe(leftover.id);
  });
});
