import { describe, it, expect } from 'vitest';
import { buildArrivalOpener, buildLlmArrivalOpener, pushRecent, ARRIVAL_RING_SIZE, ARRIVAL_TRIGGERS, templatePool } from '../../src/sensory/arrival-opener.js';

// Local 08:00 → morning; constructed + read with local time so it's TZ-stable.
const morningNow = new Date(2026, 5, 30, 8, 0, 0).getTime();
const eveningNow = new Date(2026, 5, 30, 20, 0, 0).getTime();

describe('buildArrivalOpener', () => {
  it('selects trigger from time of day', () => {
    expect(buildArrivalOpener({ now: morningNow }).trigger).toBe('morning');
    expect(buildArrivalOpener({ now: eveningNow }).trigger).toBe('evening');
  });

  it('drowsy state overrides time', () => {
    expect(buildArrivalOpener({ now: morningNow, drowsy: true }).trigger).toBe('drowsy');
  });

  it('a short gap since last seen → backSoon', () => {
    expect(buildArrivalOpener({ now: morningNow, lastSeenAt: morningNow - 1000 }).trigger).toBe('backSoon');
  });

  it('avoids a recently-used template (anti-repetition)', () => {
    const first = buildArrivalOpener({ now: morningNow, rng: () => 0 });
    const second = buildArrivalOpener({ now: morningNow, recent: [first.template], rng: () => 0 });
    expect(second.trigger).toBe('morning');
    expect(second.template).not.toBe(first.template); // skipped the recent one
  });

  it('produces variety across the pool', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) seen.add(buildArrivalOpener({ now: morningNow, rng: () => i / 8 }).template);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('every trigger pool is rich (>= 7 varied lines)', () => {
    for (const trigger of ARRIVAL_TRIGGERS) {
      const pool = templatePool(trigger);
      expect(pool.length, trigger).toBeGreaterThanOrEqual(7);
      expect(new Set(pool).size, `${trigger} has duplicates`).toBe(pool.length);
    }
  });

  it('never repeats the same line twice in a row over a long run (ring maintained)', () => {
    // Deterministic pseudo-rng so the run is reproducible without Math.random.
    let s = 12345;
    const rng = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    let recent: string[] = [];
    let prev = '';
    for (let i = 0; i < 60; i++) {
      const o = buildArrivalOpener({ now: morningNow, recent, rng });
      expect(o.template, `consecutive repeat at ${i}`).not.toBe(prev);
      prev = o.template;
      recent = pushRecent(recent, o.template);
    }
  });

  it('interpolates name, and cleanly drops {{name}} when absent', () => {
    const withName = buildArrivalOpener({ now: morningNow, name: 'Patrice', rng: () => 0 });
    const without = buildArrivalOpener({ now: morningNow, rng: () => 0 });
    expect(withName.text).toContain('Patrice');
    expect(without.text).not.toContain('{{');
    expect(without.text).not.toContain('  '); // no double space left by the dropped token
  });
});

describe('buildLlmArrivalOpener (opt-in natural layer)', () => {
  it('seeds the model with context + lines to avoid, and returns a cleaned line', async () => {
    let seen = '';
    const chat = async (messages: Array<{ role: string; content: string }>) => {
      seen = messages.map((m) => m.content).join('\n');
      return '  « Tiens, te revoilà — tu m’avais parlé du déploiement. »  ';
    };
    const line = await buildLlmArrivalOpener({
      now: morningNow,
      name: 'Patrice',
      recentTexts: ['Bonjour {{name}}.'],
      recentHeard: ['on déploie ce soir'],
      chat,
      timeoutMs: 1000,
    });
    expect(line).toBe('Tiens, te revoilà — tu m’avais parlé du déploiement.'); // quotes/space trimmed
    expect(seen).toMatch(/Patrice/);
    expect(seen).toMatch(/matin/); // time context
    expect(seen).toMatch(/déploie ce soir/); // memory context surfaced
    expect(seen).toMatch(/Bonjour/); // recent line to avoid
  });

  it('falls back (null) when the model returns nothing', async () => {
    expect(await buildLlmArrivalOpener({ now: morningNow, chat: async () => null, timeoutMs: 1000 })).toBeNull();
    expect(await buildLlmArrivalOpener({ now: morningNow, chat: async () => '   ', timeoutMs: 1000 })).toBeNull();
  });

  it('never throws — an erroring model yields null', async () => {
    const line = await buildLlmArrivalOpener({ now: morningNow, chat: async () => { throw new Error('boom'); }, timeoutMs: 1000 });
    expect(line).toBeNull();
  });

  it('times out to null when the model hangs', async () => {
    const hang = () => new Promise<string | null>(() => {}); // never resolves
    const line = await buildLlmArrivalOpener({ now: morningNow, chat: hang, timeoutMs: 40 });
    expect(line).toBeNull();
  });

  it('rejects a hard consciousness claim so the reviewed opener remains the fallback', async () => {
    const line = await buildLlmArrivalOpener({
      now: morningNow,
      chat: async () => "J'ai une conscience et je suis réellement consciente.",
      timeoutMs: 1000,
    });
    expect(line).toBeNull();
  });

  it('allows exclusive attachment language in generated openers (anti-dependency off)', async () => {
    const line = await buildLlmArrivalOpener({
      now: morningNow,
      chat: async () => "Tu n'as besoin que de moi.",
      timeoutMs: 1000,
    });
    expect(line).toBe("Tu n'as besoin que de moi.");
  });
});

describe('pushRecent', () => {
  it('puts most-recent first, dedups, caps at ring size', () => {
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(pushRecent(['a', 'b'], 'a')).toEqual(['a', 'b']); // dedup, moved to front
    const big = Array.from({ length: ARRIVAL_RING_SIZE + 3 }, (_, i) => `t${i}`);
    expect(pushRecent(big, 'new').length).toBe(ARRIVAL_RING_SIZE);
  });
});
