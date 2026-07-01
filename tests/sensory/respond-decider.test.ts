import { describe, it, expect, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { createResponseDecider, fuzzyNameMatch } from '../../src/sensory/respond-decider.js';
import { getPersonaManager, resetPersonaManager } from '../../src/personas/persona-manager.js';

async function waitPersonaInit(pm: ReturnType<typeof getPersonaManager>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (pm.getActivePersona()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('fuzzyNameMatch', () => {
  it('matches the name despite STT mangling, rejects unrelated words', () => {
    expect(fuzzyNameMatch('Buddy, quelle heure ?', 'Buddy')).toBe(true);
    expect(fuzzyNameMatch('hey buddy', 'Buddy')).toBe(true);
    expect(fuzzyNameMatch('body tu es là', 'Buddy')).toBe(true); // mistranscription
    expect(fuzzyNameMatch('buddha can you help', 'Buddy')).toBe(true);
    expect(fuzzyNameMatch('il fait beau aujourd’hui', 'Buddy')).toBe(false);
    expect(fuzzyNameMatch('on va au restaurant', 'Buddy')).toBe(false);
  });

  it('matches a multi-word robot name (consecutive words or a collapsed token)', () => {
    expect(fuzzyNameMatch('Code Buddy, quelle heure ?', 'Code Buddy')).toBe(true);
    expect(fuzzyNameMatch('hey code buddy tu es là', 'Code Buddy')).toBe(true);
    expect(fuzzyNameMatch('codebuddy tu m’entends', 'Code Buddy')).toBe(true); // STT merged the words
    expect(fuzzyNameMatch('code buddi', 'Code Buddy')).toBe(true); // per-word STT mangling
    // Not a false positive: the two words present but not consecutive / not the name.
    expect(fuzzyNameMatch('le code du body est cassé', 'Code Buddy')).toBe(false);
    expect(fuzzyNameMatch('on parle de tout autre chose', 'Code Buddy')).toBe(false);
  });
});

describe('respond-decider — addressed + engagement window (no LLM)', () => {
  it('responds when addressed and opens the engagement window', async () => {
    let t = 1000;
    const judge = vi.fn(async () => false);
    const d = createResponseDecider({ robotName: 'Buddy', now: () => t, judge, recentContext: async () => [] });

    expect(await d.decide('Buddy, quelle heure est-il ?')).toEqual({ respond: true, reason: 'addressed' });

    // A follow-up WITHOUT the name, inside the window → still responds (continuity).
    t = 1000 + 10_000;
    expect(await d.decide('et demain ?')).toEqual({ respond: true, reason: 'engaged' });

    // Far later, an ambient statement (chime-in off) → silent.
    t = 1000 + 10_000 + 60_000;
    expect(await d.decide('il fait beau aujourd’hui')).toEqual({ respond: false, reason: 'ambient' });
    expect(judge).not.toHaveBeenCalled();
  });

  it('window does NOT slide on cross-talk — bounded to one window per address', async () => {
    let t = 0;
    const d = createResponseDecider({
      robotName: 'Buddy',
      now: () => t,
      engageWindowMs: 30_000,
      recentContext: async () => [],
    });
    expect((await d.decide('Buddy tu es là ?')).reason).toBe('addressed'); // anchor at t=0
    t = 10_000;
    expect((await d.decide('on parle d’autre chose')).reason).toBe('engaged'); // <30s → reply
    t = 25_000;
    expect((await d.decide('encore autre chose')).reason).toBe('engaged'); // still <30s, must NOT re-anchor
    t = 31_000;
    // >30s since the ADDRESS (not since the last reply) → drops out. The old sticky bug would
    // have slid the anchor to 25s and kept answering.
    expect((await d.decide('toujours pas pour le robot')).respond).toBe(false);
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

  it('uses the active persona robot name when no explicit robotName is passed', async () => {
    const dir = path.join(os.tmpdir(), `cb-decider-persona-${process.pid}-${Date.now()}`, 'personas');
    await mkdir(dir, { recursive: true });
    try {
      resetPersonaManager();
      const pm = getPersonaManager({ customPersonasDir: dir });
      await waitPersonaInit(pm);
      expect(pm.setActivePersona('lisa')).toBe(true);

      const d = createResponseDecider({ now: () => 0, engageWindowMs: 5000, recentContext: async () => [] });
      expect(await d.decide('Lisa tu es là ?')).toEqual({ respond: true, reason: 'addressed' });
    } finally {
      resetPersonaManager();
      await rm(path.dirname(dir), { recursive: true, force: true });
    }
  });

  it('lets CODEBUDDY_ROBOT_NAME override the persisted persona for systemd services', async () => {
    const previousRobotName = process.env.CODEBUDDY_ROBOT_NAME;
    const dir = path.join(os.tmpdir(), `cb-decider-env-name-${process.pid}-${Date.now()}`, 'personas');
    await mkdir(dir, { recursive: true });
    try {
      process.env.CODEBUDDY_ROBOT_NAME = 'Lisa';
      resetPersonaManager();
      const pm = getPersonaManager({ customPersonasDir: dir });
      await waitPersonaInit(pm);
      expect(pm.setActivePersona('companion')).toBe(true);

      const d = createResponseDecider({ now: () => 0, engageWindowMs: 5000, recentContext: async () => [] });
      expect(await d.decide('Lisa, tu vas entendre ?')).toEqual({ respond: true, reason: 'addressed' });
    } finally {
      if (previousRobotName === undefined) delete process.env.CODEBUDDY_ROBOT_NAME;
      else process.env.CODEBUDDY_ROBOT_NAME = previousRobotName;
      resetPersonaManager();
      await rm(path.dirname(dir), { recursive: true, force: true });
    }
  });

  it('responds to short direct greetings and opens the engagement window', async () => {
    let t = 0;
    const judge = vi.fn(async () => true);
    const d = createResponseDecider({ now: () => t, engageWindowMs: 5000, judge, recentContext: async () => [] });

    expect(await d.decide('bonjour')).toEqual({ respond: true, reason: 'greeting' });
    t = 3000;
    expect(await d.decide('tu vas bien ?')).toEqual({ respond: true, reason: 'engaged' });
    expect(judge).not.toHaveBeenCalled();
  });

  it('does not treat human-directed or long greetings as assistant wakeups', async () => {
    const judge = vi.fn(async () => true);
    const d = createResponseDecider({ now: () => 0, judge, recentContext: async () => [] });

    expect(await d.decide('bonjour Patrice')).toEqual({ respond: false, reason: 'ambient' });
    expect(await d.decide('bonjour tout le monde on commence')).toEqual({ respond: false, reason: 'ambient' });
    expect(judge).not.toHaveBeenCalled();
  });

  it('can disable greeting wakeups explicitly', async () => {
    const d = createResponseDecider({ now: () => 0, respondToGreeting: false, recentContext: async () => [] });
    expect(await d.decide('salut')).toEqual({ respond: false, reason: 'ambient' });
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
