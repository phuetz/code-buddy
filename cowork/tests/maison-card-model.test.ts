import { describe, expect, it } from 'vitest';

import {
  buildMaisonCardModel,
  describeFreshness,
} from '../src/renderer/components/home/maison-model';
import type { MaisonSnapshot } from '../src/renderer/components/home/maison-types';

const NOW = new Date('2026-07-12T10:00:00.000Z').getTime();

function snapshot(overrides: Partial<MaisonSnapshot> = {}): MaisonSnapshot {
  return {
    day: { kind: 'weekend' },
    presence: { state: 'present', displayName: 'Patrice', detail: 'Salon' },
    mode: 'free-day',
    provenance: {
      kind: 'calendar',
      observedAt: NOW - 4 * 60_000,
    },
    nextMeal: {
      title: 'Omelette aux légumes',
      whenLabel: 'Déjeuner · vers 12 h 30',
      detail: 'Utilise les courgettes déjà ouvertes.',
      origin: 'leftovers',
      state: 'suggested',
    },
    ...overrides,
  };
}

describe('buildMaisonCardModel', () => {
  it('keeps day, presence and house mode separate while presenting a gentle free day', () => {
    const model = buildMaisonCardModel(snapshot(), 'ready', NOW);

    expect(model.headline).toBe('Le temps peut rester vraiment libre');
    expect(model.day).toMatchObject({ label: 'Week-end', tone: 'accent' });
    expect(model.presence).toMatchObject({ label: 'Patrice est là', detail: 'Salon', tone: 'success' });
    expect(model.mode).toMatchObject({ mode: 'free-day', label: 'Journée libre' });
    expect(model.provenance).toEqual({
      sourceLabel: 'Calendrier local',
      ageLabel: 'il y a 4 min',
      freshness: 'fresh',
      combinedLabel: 'Calendrier local · il y a 4 min',
    });
    expect(model.meal).toEqual({
      title: 'Omelette aux légumes',
      whenLabel: 'Déjeuner · vers 12 h 30',
      detail: 'Utilise les courgettes déjà ouvertes.',
      originLabel: 'Avec les restes',
      planned: false,
    });
    expect(model.actionsDisabled).toBe(false);
    expect(model.stateMessage).toBeNull();
  });

  it('names a holiday without conflating it with confirmed presence', () => {
    const model = buildMaisonCardModel(snapshot({
      day: { kind: 'holiday', holidayName: 'Fête nationale' },
      presence: { state: 'unknown' },
      mode: 'normal',
    }), 'ready', NOW);

    expect(model.day.label).toBe('Férié · Fête nationale');
    expect(model.presence.label).toBe('Présence inconnue');
    expect(model.mode.label).toBe('Normal');
  });

  it('shows an offline snapshot as last-known and disables stale actions', () => {
    const model = buildMaisonCardModel(snapshot({
      provenance: { kind: 'sensor', observedAt: NOW - 5 * 60 * 60_000 },
    }), 'offline', NOW);

    expect(model.day.label).toBe('Week-end');
    expect(model.provenance).toMatchObject({
      sourceLabel: 'Capteurs locaux',
      ageLabel: 'il y a 5 h',
      freshness: 'stale',
    });
    expect(model.actionsDisabled).toBe(true);
    expect(model.stateMessage).toContain('dernier état connu');
  });

  it('stays honest when every signal is unknown', () => {
    const model = buildMaisonCardModel(null, 'unknown', NOW);

    expect(model.headline).toBe('Le contexte Maison se précise');
    expect(model.day.label).toBe('Jour à confirmer');
    expect(model.presence.label).toBe('Présence inconnue');
    expect(model.mode.label).toBe('Mode inconnu');
    expect(model.meal).toBeNull();
    expect(model.actionsDisabled).toBe(true);
    expect(model.stateMessage).toContain('reste silencieux par défaut');
  });

  it('gives silent, cooking, guest and away modes distinct narratives', () => {
    expect(buildMaisonCardModel(snapshot({ mode: 'silent' }), 'ready', NOW).headline)
      .toBe('La maison reste silencieuse');
    expect(buildMaisonCardModel(snapshot({ mode: 'cooking' }), 'ready', NOW).headline)
      .toBe('La cuisine est prête à t’accompagner');
    expect(buildMaisonCardModel(snapshot({ mode: 'guests' }), 'ready', NOW).headline)
      .toBe('La maison accueille sans dévoiler le privé');
    expect(buildMaisonCardModel(snapshot({ mode: 'away' }), 'ready', NOW).headline)
      .toBe('La maison veille discrètement');
  });
});

describe('describeFreshness', () => {
  it('handles fresh, recent, stale, invalid and future observations deterministically', () => {
    expect(describeFreshness(NOW - 30_000, NOW)).toEqual({ ageLabel: 'à l’instant', freshness: 'fresh' });
    expect(describeFreshness(NOW - 45 * 60_000, NOW)).toEqual({ ageLabel: 'il y a 45 min', freshness: 'recent' });
    expect(describeFreshness(NOW - 3 * 60 * 60_000, NOW)).toEqual({ ageLabel: 'il y a 3 h', freshness: 'stale' });
    expect(describeFreshness('not-a-date', NOW)).toEqual({ ageLabel: 'heure inconnue', freshness: 'unknown' });
    expect(describeFreshness(NOW + 5_000, NOW)).toEqual({ ageLabel: 'à l’instant', freshness: 'fresh' });
  });
});
