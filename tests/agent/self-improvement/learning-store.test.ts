import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LearningStore,
  type LearnableStatePort,
  type LessonSnapshot,
} from '../../../src/agent/self-improvement/learning-store.js';
import type { BenchmarkScore } from '../../../src/agent/self-improvement/types.js';

/** Fake learnable state: coverage = how many target keywords appear in lessons. */
function makePort(): LearnableStatePort & { set(ls: LessonSnapshot[]): void; current(): LessonSnapshot[] } {
  let lessons: LessonSnapshot[] = [];
  const TARGETS = ['path filter', 'logger'];
  const score = (): BenchmarkScore => {
    const covered = TARGETS.filter((t) => lessons.some((l) => l.content.includes(t))).length;
    return { total: TARGETS.length, covered, ratio: covered / TARGETS.length, results: [] };
  };
  return {
    listLessons: () => lessons.map((l) => ({ ...l })),
    setLessons: (ls) => {
      lessons = ls.map((l) => ({ ...l }));
    },
    archive: () => [],
    score,
    set: (ls) => {
      lessons = ls.map((l) => ({ ...l }));
    },
    current: () => lessons,
  };
}

let dir: string;
let stamp = 0;
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-store-'));
  stamp = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('LearningStore (git-backed reversibility)', () => {
  it('initialises an isolated git repo and commits scored versions', async () => {
    const port = makePort();
    const store = new LearningStore({ workDir: dir, port, now });

    await store.ensureRepo();
    expect(fs.existsSync(path.join(store.path, '.git'))).toBe(true);

    port.set([{ category: 'RULE', content: 'Use a path filter when running npm test.' }]);
    const v1 = await store.commitVersion({ scenarioId: 's-npm', delta: 1, reason: 'v1' });
    expect(v1.score.covered).toBe(1);

    const versions = await store.listVersions();
    // init + v1
    expect(versions).toHaveLength(2);
    expect(versions[0]!.score?.covered).toBe(1);
    expect(versions[0]!.message).toContain('improve(s-npm)');

    const snapshots = await store.listVersionSnapshots();
    expect(snapshots[0]).toEqual(
      expect.objectContaining({
        sha: v1.sha,
        reason: 'v1',
        scenarioId: 's-npm',
        delta: 1,
        lessons: [{ category: 'RULE', content: 'Use a path filter when running npm test.' }],
      }),
    );
  });

  it('restores to the best-scoring version after a regression', async () => {
    const port = makePort();
    const store = new LearningStore({ workDir: dir, port, now });

    port.set([{ category: 'RULE', content: 'Use a path filter for npm test.' }]);
    await store.commitVersion({ reason: 'v1' }); // covered 1

    port.set([
      { category: 'RULE', content: 'Use a path filter for npm test.' },
      { category: 'RULE', content: 'Prefer logger over console.log.' },
    ]);
    await store.commitVersion({ reason: 'v2' }); // covered 2 — the best

    // Regression: a bad improvement wipes guidance.
    port.set([{ category: 'INSIGHT', content: 'unrelated coffee note' }]);
    await store.commitVersion({ reason: 'bad' }); // covered 0
    expect(port.score().covered).toBe(0);

    const best = await store.bestVersion();
    expect(best?.score?.covered).toBe(2);

    const restored = await store.restore({ best: true });
    expect(restored?.score.covered).toBe(2);
    // Live state was re-materialised to the best version's lessons.
    expect(port.score().covered).toBe(2);
    expect(port.current().some((l) => l.content.includes('path filter'))).toBe(true);
    expect(port.current().some((l) => l.content.includes('logger'))).toBe(true);

    // History is append-only: a restore commit was added on top.
    const versions = await store.listVersions();
    expect(versions[0]!.message).toMatch(/restore to/);
    expect(versions.length).toBe(5); // init, v1, v2, bad, restore
  });

  it('restores to an explicit commit sha', async () => {
    const port = makePort();
    const store = new LearningStore({ workDir: dir, port, now });
    port.set([{ category: 'RULE', content: 'path filter rule' }]);
    const v1 = await store.commitVersion({ reason: 'v1' });
    port.set([{ category: 'RULE', content: 'something else entirely' }]);
    await store.commitVersion({ reason: 'v2' });

    const restored = await store.restore({ commit: v1.sha });
    expect(restored?.restoredFrom).toBe(v1.sha);
    expect(port.current()[0]!.content).toBe('path filter rule');
  });

  it('push() is a clean no-op when no remote is configured', async () => {
    const port = makePort();
    const store = new LearningStore({ workDir: dir, port, now });
    await store.ensureRepo();
    const result = await store.push();
    expect(result.pushed).toBe(false);
    expect(result.reason).toMatch(/no .*remote/i);
  });

  it('versions and restores learned rules alongside lessons', async () => {
    let lessons: LessonSnapshot[] = [];
    let rules: unknown[] = [];
    const TARGETS = ['path filter'];
    const port: LearnableStatePort = {
      listLessons: () => lessons.map((l) => ({ ...l })),
      setLessons: (ls) => {
        lessons = ls.map((l) => ({ ...l }));
      },
      archive: () => [],
      score: (): BenchmarkScore => {
        const covered = TARGETS.filter((t) => lessons.some((l) => l.content.includes(t))).length;
        return { total: TARGETS.length, covered, ratio: covered / TARGETS.length, results: [] };
      },
      listRules: () => rules,
      setRules: (r) => {
        rules = r;
      },
    };
    const store = new LearningStore({ workDir: dir, port, now });

    lessons = [{ category: 'RULE', content: 'Use a path filter.' }];
    rules = [{ check: { kind: 'forbid_tool', pattern: '^bash$' }, statement: 'no bash', createdAt: 'now' }];
    const good = await store.commitVersion({ reason: 'with-rule' });

    // Wipe both, then restore — rules must come back too.
    lessons = [];
    rules = [];
    await store.commitVersion({ reason: 'wiped' });

    const restored = await store.restore({ commit: good.sha });
    expect(restored).not.toBeNull();
    expect(rules).toHaveLength(1);
    expect((rules[0] as { statement: string }).statement).toBe('no bash');
    expect(lessons.some((l) => l.content.includes('path filter'))).toBe(true);
  });

  it('status reports head and best scores', async () => {
    const port = makePort();
    const store = new LearningStore({ workDir: dir, port, now });
    port.set([{ category: 'RULE', content: 'path filter + logger' }]); // covers both
    await store.commitVersion({ reason: 'v1' });
    const status = await store.status();
    expect(status.head?.covered).toBe(2);
    expect(status.best?.score?.covered).toBe(2);
    expect(status.versions).toBe(2);
  });

  it('THROWS instead of returning a fake success when git is unavailable (reversibility guarantee)', async () => {
    const port = makePort();
    const store = new LearningStore({ workDir: dir, port, now });
    port.set([{ category: 'RULE', content: 'path filter' }]);

    // Make `git` unresolvable for the spawned child: empty PATH → spawn error
    // → runGit code 1 (the exact no-git branch that used to fake `{ sha: '' }`).
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(store.commitVersion({ reason: 'v1' })).rejects.toThrow(/git (init failed|error|unavailable)/i);
    } finally {
      process.env.PATH = savedPath;
    }
    // Nothing was persisted: no committed versions exist.
    expect(await store.listVersions()).toEqual([]);
  });
});
