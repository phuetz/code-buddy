import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { wireVisionReaction, type VisionAnalyzer } from '../../src/sensory/vision-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

function motion(): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'vision', kind: 'motion', payload: { score: 0.5 } },
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('vision reaction — motion → camera_analyze (debounced)', () => {
  it('analyzes once on motion, records a percept, and debounces a rapid second', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-'));
    let calls = 0;
    const analyzer: VisionAnalyzer = {
      analyze: async () => {
        calls += 1;
        return { success: true, description: 'a tidy desk' };
      },
    };
    let clock = 1000;
    const unwire = wireVisionReaction({ analyzer, debounceMs: 5000, cwd: tmp, now: () => clock });
    try {
      motion();
      await tick();
      expect(calls).toBe(1); // first motion → analyzed

      motion();
      await tick();
      expect(calls).toBe(1); // within debounce window → suppressed

      clock += 6000; // past the debounce
      motion();
      await tick();
      expect(calls).toBe(2);

      const percepts = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      const lines = percepts.trim().split('\n').filter(Boolean);
      expect(lines.length).toBe(2); // one percept per analysis
      expect(percepts).toContain('a tidy desk');
      expect(percepts).toContain('sensory_motion_reaction');
    } finally {
      unwire();
    }
  });

  it('ignores non-vision events', async () => {
    let calls = 0;
    const analyzer: VisionAnalyzer = {
      analyze: async () => {
        calls += 1;
        return { success: true };
      },
    };
    const unwire = wireVisionReaction({ analyzer, debounceMs: 0 });
    try {
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'audio', kind: 'speech_start' } });
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'vital', kind: 'heartbeat', payload: { beat: 1 } } });
      await tick();
      expect(calls).toBe(0);
    } finally {
      unwire();
    }
  });
});
