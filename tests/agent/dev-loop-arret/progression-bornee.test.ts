/** « 126% (63/50 done, ETA ~-147s) » : le décompte ne dépasse jamais le total. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProgressTracker,
  wireDefaultProgressSink,
  _resetForTests,
} from '../../../src/agent/planner/progress-default-sink.js';
import { ProgressTracker } from '../../../src/agent/planner/progress-tracker.js';
import { logger } from '../../../src/utils/logger.js';

beforeEach(() => _resetForTests());

describe('progression bornée', () => {
  it('getProgress plafonne à 100 % et ne donne jamais un ETA négatif', () => {
    const t = new ProgressTracker();
    t.start(2);
    for (let i = 0; i < 5; i++) t.update(`t${i}`, 'completed');
    const p = t.getProgress();
    expect(p.percentage).toBe(100);
    expect(p.eta).toBe(0);
  });

  it('le journal par défaut ne logue jamais plus de 100 % ni done > total', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    wireDefaultProgressSink();
    const t = getProgressTracker();
    t.start(4);
    for (let i = 0; i < 9; i++) t.update(`t${i}`, 'completed');
    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('[progress]'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const m = /(\d+)% \((\d+)\/(\d+) done/.exec(line);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeLessThanOrEqual(100);
      expect(Number(m![2])).toBeLessThanOrEqual(Number(m![3]));
      expect(line).not.toMatch(/ETA ~-/);
    }
    info.mockRestore();
  });
});
