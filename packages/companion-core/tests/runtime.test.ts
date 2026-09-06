import { describe, it, expect } from 'vitest';
import {
  COMPANION_CORE_VERSION,
  MemoryKeyValueStore,
  constantRng,
  fixedClock,
  resolveCivilClock,
  seededRng,
} from '../src/index.js';

describe('runtime — horloge injectable', () => {
  it('rend une horloge figée', () => {
    expect(fixedClock(1234)()).toBe(1234);
  });

  it('résout les parties civiles dans le fuseau demandé', () => {
    const clock = resolveCivilClock(Date.parse('2026-03-02T09:30:00Z'), 'UTC');
    expect(clock).toMatchObject({
      localDate: '2026-03-02',
      hour: 9,
      minute: 30,
      minutesOfDay: 9 * 60 + 30,
      timeZone: 'UTC',
    });
  });

  it('suit le fuseau de l’utilisateur, pas celui du processus', () => {
    const instant = Date.parse('2026-03-02T23:30:00Z');
    expect(resolveCivilClock(instant, 'Asia/Tokyo').localDate).toBe('2026-03-03');
    expect(resolveCivilClock(instant, 'UTC').localDate).toBe('2026-03-02');
  });

  it('retombe sur UTC sur un fuseau inconnu, sans lever', () => {
    expect(resolveCivilClock(0, 'Pas/Un/Fuseau').timeZone).toBe('UTC');
  });
});

describe('runtime — aléa injectable', () => {
  it('rejoue exactement la même suite pour une graine', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const suiteA = [a(), a(), a()];
    const suiteB = [b(), b(), b()];
    expect(suiteA).toEqual(suiteB);
    for (const value of suiteA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('diffère d’une graine à l’autre', () => {
    expect(seededRng(1)()).not.toBe(seededRng(2)());
  });

  it('rend une constante quand on le demande', () => {
    expect(constantRng(0.5)()).toBe(0.5);
  });
});

describe('runtime — magasin clé-valeur', () => {
  it('écrit, relit, supprime', async () => {
    const store = new MemoryKeyValueStore();
    expect(await store.get('absent')).toBeNull();
    await store.set('a', { n: 1 });
    expect(await store.get<{ n: number }>('a')).toEqual({ n: 1 });
    expect(store.keys()).toEqual(['a']);
    await store.delete('a');
    expect(await store.get('a')).toBeNull();
  });

  it('isole la valeur stockée de l’objet appelant', async () => {
    const store = new MemoryKeyValueStore();
    const value = { n: 1 };
    await store.set('a', value);
    value.n = 2;
    expect(await store.get<{ n: number }>('a')).toEqual({ n: 1 });
  });

  it('publie sa version', () => {
    expect(COMPANION_CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
