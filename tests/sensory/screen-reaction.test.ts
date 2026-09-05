import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
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

async function waitForPerceptCount(tmp: string, expected: number): Promise<string> {
  const perceptPath = path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl');
  let raw = '';
  await vi.waitFor(async () => {
    raw = await readFile(perceptPath, 'utf8');
    expect(raw.trim().split('\n').filter(Boolean)).toHaveLength(expected);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return raw;
}

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
      await waitForPerceptCount(tmp, 1);
      expect(calls).toBe(1);

      change();
      await tick();
      expect(calls).toBe(1); // within debounce → suppressed

      clock += 5000;
      change();
      const percepts = await waitForPerceptCount(tmp, 2);
      expect(calls).toBe(2);

      const lines = percepts.trim().split('\n').filter(Boolean);
      expect(lines.length).toBe(2);
      expect(percepts).toContain('an editor with code');
      expect(percepts).toContain('sensory_screen_reaction');
    } finally {
      unwire();
      await rm(tmp, { recursive: true, force: true });
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

  it('does not publish an in-flight analysis after teardown', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'screen-teardown-'));
    let release!: (analysis: { description?: string }) => void;
    const analysis = new Promise<{ description?: string }>((resolve) => {
      release = resolve;
    });
    const unwire = wireScreenReaction({
      analyzer: { analyze: async () => analysis },
      debounceMs: 0,
      cwd: tmp,
    });

    change();
    await tick();
    unwire();
    release({ description: 'stale desktop' });
    await tick();

    await expect(
      readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
