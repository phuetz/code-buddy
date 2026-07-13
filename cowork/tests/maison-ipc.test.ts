import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CookingTimerStore, HomeModeStore } from '../../src/life-rhythm/index.js';
import { FoodProfileStore, MealPlanStore } from '../../src/meals/index.js';
import { readMaisonSnapshot, type MaisonIpcDeps } from '../src/main/ipc/maison-ipc.js';

describe('Maison IPC projection', () => {
  let dir: string;
  let deps: MaisonIpcDeps;
  const now = new Date('2026-07-14T10:00:00.000Z');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cowork-maison-ipc-'));
    deps = {
      now: () => new Date(now),
      timeZone: 'Europe/Paris',
      holidayProvider: {
        lookup: async (date) => ({
          date,
          available: true,
          holiday: { date, name: '14 juillet', zone: 'metropole' },
          provenance: {
            provider: 'etalab-calendrier-api-gouv-fr',
            source: 'cache',
            freshness: 'fresh',
            checkedAt: now.toISOString(),
            year: 2026,
            zone: 'metropole',
          },
        }),
      },
      homeModeStore: new HomeModeStore({
        filePath: join(dir, 'mode.json'),
        now: () => new Date(now),
      }),
      cookingTimerStore: new CookingTimerStore({
        filePath: join(dir, 'timers.json'),
        now: () => new Date(now),
      }),
      foodProfileStore: new FoodProfileStore({
        storePath: join(dir, 'food.enc.json'),
        localKeyPath: join(dir, 'food.key'),
        encryptionKey: 'cowork-maison-test-secret',
      }),
      mealPlanStore: new MealPlanStore({
        filePath: join(dir, 'meal-plan.json'),
        now: () => new Date(now),
      }),
      readPresence: async () => ({
        hasMatch: true,
        name: 'Patrice',
        aliases: [],
        confidence: 0.97,
        hasUnknownFace: false,
        ageMs: 1_000,
      }),
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps holiday, presence and explicit home mode as separate facts', async () => {
    const payload = await readMaisonSnapshot(deps);
    expect(payload).toMatchObject({
      status: 'ready',
      snapshot: {
        day: { kind: 'holiday', holidayName: '14 juillet' },
        presence: { state: 'present', displayName: 'Patrice' },
        mode: 'normal',
      },
      foodProfile: { configured: false, constraintCount: 0 },
    });
  });

  it('redacts the matched identity in guest mode', async () => {
    await deps.cookingTimerStore!.start(60_000, 'appel personnel');
    await (deps.foodProfileStore as FoodProfileStore).save({
      schemaVersion: 1,
      id: 'profil-alimentaire-prive',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      constraints: [{
        id: 'contrainte-clinique-privee',
        kind: 'clinician',
        effect: 'exclude',
        status: 'confirmed',
        target: { type: 'ingredient', value: 'sucre' },
        provenance: {
          source: 'clinician',
          sourceId: 'docteur-prive',
          recordedAt: now.toISOString(),
          status: 'confirmed',
        },
      }],
    });
    await deps.mealPlanStore!.create({
      localDate: '2026-07-14',
      localTime: '13:00',
      slot: 'lunch',
      recipeId: 'menu-prive',
      recipeTitle: 'Menu diabète avant rendez-vous Dr X',
      status: 'planned',
      timeZone: 'Europe/Paris',
      provenance: {
        source: 'user',
        sourceId: 'planning-prive',
        recordedAt: now.toISOString(),
        status: 'confirmed',
      },
    });
    await deps.homeModeStore!.setMode('guests');
    const payload = await readMaisonSnapshot(deps);
    expect(payload.snapshot.presence).toMatchObject({ state: 'present' });
    expect(payload.snapshot.presence).not.toHaveProperty('displayName');
    expect(payload.snapshot.presence?.detail).toContain('masquée');
    expect(payload.activeTimers[0]?.label).toBe('Minuteur 1');
    expect(payload.snapshot.nextMeal).toEqual({
      title: 'Repas planifié',
      detail: 'Titre et horaire masqués pour protéger la vie privée.',
      origin: 'unknown',
      state: 'planned',
    });
    expect(payload.snapshot.nextMeal).not.toHaveProperty('whenLabel');
    expect(payload.foodProfile).toEqual({ configured: false, constraintCount: 0, unknownCount: 0 });
    expect(JSON.stringify(payload)).not.toContain('appel personnel');
    expect(JSON.stringify(payload)).not.toContain('Menu diabète avant rendez-vous Dr X');
    expect(JSON.stringify(payload)).not.toContain('13:00');
    expect(JSON.stringify(payload)).not.toContain('contrainte-clinique-privee');
  });

  it('applies the same private projection when an unknown face is present', async () => {
    deps.readPresence = async () => ({
      hasMatch: false,
      hasUnknownFace: true,
      ageMs: 1_000,
    });
    await deps.cookingTimerStore!.start(60_000, 'médicament personnel');
    await deps.mealPlanStore!.create({
      localDate: '2026-07-14',
      localTime: '20:15',
      slot: 'dinner',
      recipeId: 'repas-confidentiel',
      recipeTitle: 'Dîner surprise confidentiel',
      status: 'planned',
      timeZone: 'Europe/Paris',
      provenance: {
        source: 'user',
        sourceId: 'planning-confidentiel',
        recordedAt: now.toISOString(),
        status: 'confirmed',
      },
    });

    const payload = await readMaisonSnapshot(deps);

    expect(payload.snapshot.presence).toMatchObject({ state: 'unknown' });
    expect(payload.activeTimers[0]?.label).toBe('Minuteur 1');
    expect(payload.snapshot.nextMeal).toMatchObject({ title: 'Repas planifié', origin: 'unknown' });
    expect(payload.snapshot.nextMeal).not.toHaveProperty('whenLabel');
    expect(payload.foodProfile).toEqual({ configured: false, constraintCount: 0, unknownCount: 0 });
    expect(JSON.stringify(payload)).not.toMatch(/médicament personnel|Dîner surprise confidentiel|20:15/);
  });

  it('projects persistent cooking timers without consuming due alerts', async () => {
    await deps.cookingTimerStore!.start(60_000, 'four');
    const payload = await readMaisonSnapshot(deps);
    expect(payload.activeTimers).toHaveLength(1);
    expect(payload.activeTimers[0]).toMatchObject({ label: 'four', state: 'running' });
  });

  it('shows the next explicit local meal plan without a medical claim', async () => {
    await deps.mealPlanStore!.create({
      localDate: '2026-07-14',
      localTime: '13:00',
      slot: 'lunch',
      recipeId: 'ratatouille',
      recipeTitle: 'Ratatouille maison',
      status: 'planned',
      timeZone: 'Europe/Paris',
      provenance: {
        source: 'user',
        sourceId: 'test-plan',
        recordedAt: now.toISOString(),
        status: 'confirmed',
      },
    });
    const payload = await readMaisonSnapshot(deps);
    expect(payload.snapshot.nextMeal).toMatchObject({
      title: 'Ratatouille maison',
      whenLabel: 'Déjeuner · 2026-07-14 13:00',
      origin: 'manual',
      state: 'planned',
    });
    expect(payload.snapshot.nextMeal?.detail).not.toMatch(/calorie|santé|diagnostic/i);
  });
});
