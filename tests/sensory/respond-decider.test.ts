import { describe, it, expect, vi } from 'vitest';
import { createResponseDecider, fuzzyNameMatch } from '../../src/sensory/respond-decider.js';

describe('fuzzyNameMatch', () => {
  it('matches the name despite STT mangling, rejects unrelated words', () => {
    expect(fuzzyNameMatch('Buddy, quelle heure ?', 'Buddy')).toBe(true);
    expect(fuzzyNameMatch('hey buddy', 'Buddy')).toBe(true);
    expect(fuzzyNameMatch('body tu es là', 'Buddy')).toBe(true); // mistranscription
    expect(fuzzyNameMatch('buddha can you help', 'Buddy')).toBe(true);
    expect(fuzzyNameMatch('il fait beau aujourd’hui', 'Buddy')).toBe(false);
    expect(fuzzyNameMatch('on va au restaurant', 'Buddy')).toBe(false);
  });
});

describe('respond-decider — addressed + engagement window (no LLM)', () => {
  it('responds when addressed and opens the engagement window', async () => {
    let t = 1000;
    const judge = vi.fn(async () => false);
    const d = createResponseDecider({ now: () => t, judge, recentContext: async () => [] });

    expect(await d.decide('Buddy, quelle heure est-il ?')).toEqual({ respond: true, reason: 'addressed' });

    // A follow-up WITHOUT the name, inside the window → still responds (continuity).
    t = 1000 + 10_000;
    expect(await d.decide('et demain ?')).toEqual({ respond: true, reason: 'engaged' });

    // Far later, an ambient statement (chime-in off) → silent.
    t = 1000 + 10_000 + 60_000;
    expect(await d.decide('il fait beau aujourd’hui')).toEqual({ respond: false, reason: 'ambient' });
    expect(judge).not.toHaveBeenCalled();
  });

  it('markEngaged opens the window manually', async () => {
    let t = 0;
    const d = createResponseDecider({ now: () => t, engageWindowMs: 5000, recentContext: async () => [] });
    d.markEngaged();
    t = 4000;
    expect((await d.decide('et ça ?')).respond).toBe(true);
    t = 11000;
    expect((await d.decide('autre chose')).respond).toBe(false);
  });
});

describe('respond-decider — chime-in (LLM only on a cue)', () => {
  it('with chime-in OFF, ambient speech is silent and the judge is never called', async () => {
    const judge = vi.fn(async () => true);
    const d = createResponseDecider({ chimeIn: false, judge, now: () => 0, recentContext: async () => [] });
    expect((await d.decide('quelqu’un peut m’aider ?')).respond).toBe(false);
    expect(judge).not.toHaveBeenCalled();
  });

  it('with chime-in ON, a cue-less statement stays silent without calling the judge', async () => {
    const judge = vi.fn(async () => true);
    const d = createResponseDecider({ chimeIn: true, judge, now: () => 0, recentContext: async () => [] });
    expect(await d.decide('il fait beau aujourd’hui')).toEqual({ respond: false, reason: 'no-cue' });
    expect(judge).not.toHaveBeenCalled();
  });

  it('with chime-in ON and a cue, the judge decides', async () => {
    const yes = createResponseDecider({ chimeIn: true, now: () => 0, recentContext: async () => [], judge: async () => true });
    expect(await yes.decide('comment compiler ce projet ?')).toEqual({ respond: true, reason: 'chime-in' });

    const no = createResponseDecider({ chimeIn: true, now: () => 0, recentContext: async () => [], judge: async () => false });
    expect(await no.decide('comment compiler ce projet ?')).toEqual({ respond: false, reason: 'not-warranted' });
  });

  it('judge error → silent (conservative), never throws', async () => {
    const d = createResponseDecider({
      chimeIn: true,
      now: () => 0,
      recentContext: async () => [],
      judge: async () => {
        throw new Error('llm down');
      },
    });
    await expect(d.decide('peux-tu m’aider ?')).resolves.toEqual({ respond: false, reason: 'judge-error' });
  });

  it('empty transcript → silent', async () => {
    const d = createResponseDecider({ now: () => 0, recentContext: async () => [] });
    expect(await d.decide('   ')).toEqual({ respond: false, reason: 'empty' });
  });
});
