import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { wireScreenReaction, type ScreenAnalyzer } from '../../src/sensory/screen-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

function change(score = 0.3): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'screen', kind: 'change', payload: { score } },
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('screen reaction — screen/change → percept (debounced)', () => {
  it('records a percept once on change, runs the analyzer, and debounces', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'screen-'));
    let calls = 0;
    const analyzer: ScreenAnalyzer = {
      analyze: async () => {
        calls += 1;
        return { description: 'an editor with code' };
      },
    };
    let clock = 1000;
    const unwire = wireScreenReaction({ analyzer, debounceMs: 4000, cwd: tmp, now: () => clock });
    try {
      change();
      await tick();
      expect(calls).toBe(1);

      change();
      await tick();
      expect(calls).toBe(1); // within debounce → suppressed

      clock += 5000;
      change();
      await tick();
      expect(calls).toBe(2);

      const percepts = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      const lines = percepts.trim().split('\n').filter(Boolean);
      expect(lines.length).toBe(2);
      expect(percepts).toContain('an editor with code');
      expect(percepts).toContain('sensory_screen_reaction');
    } finally {
      unwire();
    }
  });

  it('ignores non-screen events', async () => {
    let calls = 0;
    const analyzer: ScreenAnalyzer = {
      analyze: async () => {
        calls += 1;
        return {};
      },
    };
    const unwire = wireScreenReaction({ analyzer, debounceMs: 0 });
    try {
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'vision', kind: 'motion' } });
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'vital', kind: 'heartbeat', payload: { beat: 1 } } });
      await tick();
      expect(calls).toBe(0);
    } finally {
      unwire();
    }
  });

  it('falls back to the safe debounce when the environment value is invalid', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'screen-invalid-debounce-'));
    const previous = process.env.CODEBUDDY_SCREEN_DEBOUNCE_MS;
    process.env.CODEBUDDY_SCREEN_DEBOUNCE_MS = 'not-a-number';
    let calls = 0;
    const unwire = wireScreenReaction({
      analyzer: {
        analyze: async () => {
          calls += 1;
          return {};
        },
      },
      cwd: tmp,
      now: () => 1000,
    });
    try {
      change();
      await tick();
      change();
      await tick();
      expect(calls).toBe(1);
    } finally {
      unwire();
      if (previous === undefined) delete process.env.CODEBUDDY_SCREEN_DEBOUNCE_MS;
      else process.env.CODEBUDDY_SCREEN_DEBOUNCE_MS = previous;
    }
  });
});
