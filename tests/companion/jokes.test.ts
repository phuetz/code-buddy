/**
 * Jokes — request detection + anti-repeat picker (pure; no LLM, no daemon).
 */
import {
  CURATED_JOKES,
  effectiveJokePool,
  isJokeRequest,
  pickJoke,
} from '../../src/companion/jokes.js';

describe('isJokeRequest', () => {
  it('detects joke requests (STT-robust)', () => {
    expect(isJokeRequest('raconte-moi une blague')).toBe(true);
    expect(isJokeRequest('Lisa, tu connais une blague ?')).toBe(true);
    expect(isJokeRequest('fais-moi rire')).toBe(true);
    expect(isJokeRequest('raconte-moi un truc drôle')).toBe(true);
    expect(isJokeRequest('une autre blague')).toBe(true);
  });

  it('ignores non-joke utterances', () => {
    expect(isJokeRequest('quelle est la météo')).toBe(false);
    expect(isJokeRequest('raconte-moi ta journée')).toBe(false);
    expect(isJokeRequest('')).toBe(false);
  });
});

describe('pickJoke', () => {
  it('avoids recently told jokes', () => {
    const pool = ['a', 'b', 'c'];
    const picked = pickJoke(pool, ['a', 'b'], () => 0); // rng→0 would pick 'a', but it is recent
    expect(picked).toBe('c');
  });

  it('falls back to the full pool when all are recent', () => {
    const pool = ['a', 'b'];
    expect(pickJoke(pool, ['a', 'b'], () => 0)).toBe('a');
  });

  it('returns null for an empty pool', () => {
    expect(pickJoke([], [])).toBeNull();
  });
});

describe('effectiveJokePool', () => {
  it('always includes the curated jokes', () => {
    const pool = effectiveJokePool({} as NodeJS.ProcessEnv);
    expect(pool.length).toBeGreaterThanOrEqual(CURATED_JOKES.length);
    expect(pool).toContain(CURATED_JOKES[0]);
  });
});
