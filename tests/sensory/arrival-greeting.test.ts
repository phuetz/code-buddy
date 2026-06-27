import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { wireSemanticVisionReaction } from '../../src/sensory/semantic-vision-reaction.js';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

let tmp: string;
const tick = () => new Promise((r) => setTimeout(r, 60));
function personEntered(): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'vision', kind: 'person_entered', payload: {} },
  });
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'greet-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  delete process.env.CODEBUDDY_SENSORY_GREET;
});

describe('arrival greeting — the robot notices and engages when someone arrives', () => {
  it('greets aloud on person_entered (opt-in) + opens the conversation window, with a cooldown', async () => {
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    const greet = vi.fn(async () => {});
    const onEngage = vi.fn();
    let clock = 1000;
    const unwire = wireSemanticVisionReaction({ greet, onEngage, now: () => clock, cwd: tmp });
    try {
      personEntered();
      await tick();
      expect(greet).toHaveBeenCalledTimes(1);
      expect(typeof greet.mock.calls[0]![0]).toBe('string');
      expect(greet.mock.calls[0]![0]!.length).toBeGreaterThan(0);
      expect(onEngage).toHaveBeenCalledTimes(1);

      // a flicker within the cooldown → no re-greet
      clock += 1000;
      personEntered();
      await tick();
      expect(greet).toHaveBeenCalledTimes(1);

      // after the cooldown → greets again
      clock += 61_000;
      personEntered();
      await tick();
      expect(greet).toHaveBeenCalledTimes(2);
    } finally {
      unwire();
    }
  });

  it('the arrival greeting opens the engagement window the speech gate reads (shared decider)', async () => {
    // This is the bug fix: server/index.ts wires onEngage -> the SAME decider the
    // speech reaction gates on, so a greeted visitor's natural reply (no wake-word)
    // is treated as "engaged" instead of ignored as ambient.
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    let clock = 1000;
    const decider = createResponseDecider({
      now: () => clock,
      nameMatch: () => false, // never "addressed by name" → isolate the engagement window
      engageWindowMs: 30_000,
    });

    // Before any arrival: an ambient utterance is NOT answered (no open window).
    expect((await decider.decide('il fait beau aujourd’hui')).respond).toBe(false);

    const greet = vi.fn(async () => {});
    const unwire = wireSemanticVisionReaction({
      greet,
      onEngage: () => decider.markEngaged(), // exactly how server/index.ts wires it
      now: () => clock,
      cwd: tmp,
    });
    try {
      personEntered();
      await tick();
      expect(greet).toHaveBeenCalledTimes(1);

      // The greeting opened the window → the visitor's reply is now engaged + answered.
      const d = await decider.decide('salut, ça va ?');
      expect(d.respond).toBe(true);
      expect(d.reason).toBe('engaged');

      // …and it decays: past the window, ambient speech is ignored again.
      clock += 31_000;
      expect((await decider.decide('quelqu’un a parlé au loin')).respond).toBe(false);
    } finally {
      unwire();
    }
  });

  it('stays silent on arrival when not enabled (default off — never barges in unprompted)', async () => {
    delete process.env.CODEBUDDY_SENSORY_GREET;
    const greet = vi.fn(async () => {});
    const unwire = wireSemanticVisionReaction({ greet, cwd: tmp });
    try {
      personEntered();
      await tick();
      expect(greet).not.toHaveBeenCalled();
    } finally {
      unwire();
    }
  });
});
