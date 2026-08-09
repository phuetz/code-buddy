/**
 * Model scoreboard tests — the learning layer for `buddy council`.
 * Each test uses a tmp ledger file so they're hermetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { ModelScoreboard, type OutcomeRecord } from '../../src/fleet/model-scoreboard.js';

let tmpFile: string;

function rec(over: Partial<OutcomeRecord>): OutcomeRecord {
  return {
    at: '2026-06-24T00:00:00.000Z',
    taskType: 'code',
    model: 'grok-3',
    provider: 'grok',
    won: false,
    quality: 0.5,
    latencyMs: 1000,
    costUsd: 0,
    ...over,
  };
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-scoreboard-'));
  tmpFile = path.join(dir, 'perf.json');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  try {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('ModelScoreboard', () => {
  it('persists outcomes to disk and reloads them', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ won: true }));
    expect(fs.existsSync(tmpFile)).toBe(true);

    const fresh = new ModelScoreboard(tmpFile);
    expect(fresh.ranking('code')).toHaveLength(1);
    expect(fresh.ranking('code')[0]!.model).toBe('grok-3');
  });

  it('computes win rate per (taskType, model)', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ won: true }));
    sb.recordOutcome(rec({ won: false }));
    sb.recordOutcome(rec({ won: true }));
    expect(sb.winRate('code', 'grok-3')).toBeCloseTo(2 / 3, 5);
    expect(sb.winRate('code', 'unseen-model')).toBe(0);
    expect(sb.winRate('french', 'grok-3')).toBe(0); // different task type
  });

  it('isolates win rates by task type', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ taskType: 'code', won: true }));
    sb.recordOutcome(rec({ taskType: 'french', won: false }));
    expect(sb.winRate('code', 'grok-3')).toBe(1);
    expect(sb.winRate('french', 'grok-3')).toBe(0);
  });

  it('computes role-specific scores and rankings', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ model: 'grok-3', provider: 'grok', role: 'reviewer', won: true, quality: 0.8 }));
    sb.recordOutcome(rec({ model: 'grok-3', provider: 'grok', role: 'reviewer', won: false, quality: 0.4 }));
    sb.recordOutcome(rec({ model: 'gpt-5.5', provider: 'chatgpt', role: 'reviewer', won: false, quality: 0.9 }));
    sb.recordOutcome(rec({ model: 'gpt-5.5', provider: 'chatgpt', role: 'architect', won: true, quality: 1 }));

    // roleScore is role-quality-dominant (0.7×avgRoleQuality + 0.3×winRate):
    // a critic that holds its role must rank high for the critic seat even
    // though critics rarely win the task vote. No roleQuality on these
    // records → falls back to quality.
    expect(sb.roleScore('code', 'reviewer', 'grok-3')).toBeCloseTo(0.7 * 0.6 + 0.3 * 0.5, 5);
    expect(sb.roleScore('code', 'reviewer', 'unknown')).toBe(0);

    const reviewerRanking = sb.roleRanking('code', 'reviewer');
    expect(reviewerRanking.map((stat) => stat.model)).toEqual(['grok-3', 'gpt-5.5']);
    expect(reviewerRanking[0]!.role).toBe('reviewer');
  });

  it('ranks models by win rate then quality', () => {
    const sb = new ModelScoreboard(tmpFile);
    // grok: 1 win / 1; gpt: 0 win / 1 but higher quality
    sb.recordOutcome(rec({ model: 'grok-3', provider: 'grok', won: true, quality: 0.8 }));
    sb.recordOutcome(rec({ model: 'gpt-5.5', provider: 'chatgpt', won: false, quality: 0.95 }));
    const ranking = sb.ranking('code');
    expect(ranking.map((r) => r.model)).toEqual(['grok-3', 'gpt-5.5']);
    expect(ranking[0]!.winRate).toBe(1);
    expect(ranking[1]!.avgQuality).toBeCloseTo(0.95, 5);
  });

  it('aggregates stats across runs', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ won: true, latencyMs: 1000, quality: 1 }));
    sb.recordOutcome(rec({ won: false, latencyMs: 3000, quality: 0 }));
    const stat = sb.ranking('code')[0]!;
    expect(stat.runs).toBe(2);
    expect(stat.wins).toBe(1);
    expect(stat.winRate).toBe(0.5);
    expect(stat.avgLatencyMs).toBe(2000);
    expect(stat.avgQuality).toBe(0.5);
  });

  it('prints a friendly message when empty', () => {
    const sb = new ModelScoreboard(tmpFile);
    expect(sb.print()).toMatch(/No council history/i);
    expect(sb.print('code')).toMatch(/No council history.*code/i);
  });

  it('prints a ranking once it has data', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ model: 'grok-3', won: true, role: 'reviewer' }));
    const out = sb.print('code');
    expect(out).toMatch(/grok-3/);
    expect(out).toMatch(/100%/);
    expect(out).toMatch(/Role specialists/);
    expect(out).toMatch(/reviewer/);
  });
});

describe('ModelScoreboard v2 — smoothed selection bias', () => {
  it('is neutral (0) for never-seen models instead of locking them out', () => {
    const sb = new ModelScoreboard(tmpFile);
    expect(sb.selectionBias('code', 'unseen')).toBe(0);
    expect(sb.runCount('code', 'unseen')).toBe(0);
    expect(sb.smoothedWinRate('code', 'unseen')).toBeCloseTo(0.5, 5);
  });

  it('ranks 9/10 above 1/1 — no more rich-get-richer lock-in', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ model: 'one-shot', won: true }));
    for (let i = 0; i < 10; i++) {
      sb.recordOutcome(rec({ model: 'proven', won: i < 9 }));
    }
    const oneShot = sb.selectionBias('code', 'one-shot');
    const proven = sb.selectionBias('code', 'proven');
    expect(proven).toBeGreaterThan(oneShot);
    expect(oneShot).toBeGreaterThan(0);
    // Raw winRate would have said the opposite (1.0 vs 0.9).
    expect(sb.winRate('code', 'one-shot')).toBe(1);
    expect(sb.winRate('code', 'proven')).toBeCloseTo(0.9, 5);
  });

  it('pushes consistent losers negative', () => {
    const sb = new ModelScoreboard(tmpFile);
    for (let i = 0; i < 6; i++) sb.recordOutcome(rec({ model: 'loser', won: false }));
    expect(sb.selectionBias('code', 'loser')).toBeLessThan(0);
  });
});

describe('ModelScoreboard — role quality (judge dual scores)', () => {
  it('uses roleQuality over task quality when present', () => {
    const sb = new ModelScoreboard(tmpFile);
    // A critic: loses the task vote (won:false, low task quality) but holds
    // its role perfectly — roleScore must reward the role fit.
    sb.recordOutcome(rec({ role: 'reviewer', won: false, quality: 0.25, roleQuality: 0.95 }));
    expect(sb.roleScore('code', 'reviewer', 'grok-3')).toBeCloseTo(0.7 * 0.95 + 0.3 * 0, 5);
  });

  it('tracks trailing consecutive failures across task types (dead-judge detection)', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ taskType: 'french', model: 'dead-judge', won: false, quality: 0, failed: true }));
    sb.recordOutcome(rec({ taskType: 'code', model: 'dead-judge', won: false, quality: 0, failed: true }));
    expect(sb.consecutiveRecentFailures('dead-judge')).toBe(2);

    // A success resets the trailing streak.
    sb.recordOutcome(rec({ taskType: 'code', model: 'dead-judge', won: true, quality: 0.8 }));
    expect(sb.consecutiveRecentFailures('dead-judge')).toBe(0);
    expect(sb.consecutiveRecentFailures('never-seen')).toBe(0);
  });
});

describe('ModelScoreboard v2 — failed records (dead-model penalty)', () => {
  it('counts failures as losses for selection but excludes them from quality stats', () => {
    const sb = new ModelScoreboard(tmpFile);
    for (let i = 0; i < 3; i++) {
      sb.recordOutcome(rec({ model: 'dead-model', won: false, quality: 0, failed: true }));
    }

    // Selection: penalized and no longer "unseen" for ε-exploration.
    expect(sb.runCount('code', 'dead-model')).toBe(3);
    expect(sb.selectionBias('code', 'dead-model')).toBeLessThan(0);
    // Quality display: a 404 is not a quality defeat.
    expect(sb.winRate('code', 'dead-model')).toBe(0);
    expect(sb.ranking('code')).toHaveLength(0);
    expect(sb.print('code')).toMatch(/No council history/);
  });

  it('mixes quality runs and failures honestly', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ model: 'flaky', won: true, quality: 0.9 }));
    sb.recordOutcome(rec({ model: 'flaky', won: false, quality: 0, failed: true }));

    expect(sb.winRate('code', 'flaky')).toBe(1); // 1 win / 1 quality run
    expect(sb.runCount('code', 'flaky')).toBe(2); // failure still counts as observed
    expect(sb.smoothedWinRate('code', 'flaky')).toBeCloseTo((1 + 1) / (2 + 2), 5);
    expect(sb.ranking('code')[0]!.runs).toBe(1); // failed run excluded from stats
  });
});

describe('ModelScoreboard v2 — role normalization', () => {
  it('aggregates suffixed panel-seat roles (reviewer-4) into the stable role id', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ role: 'reviewer-4', won: true, quality: 0.8 }));
    sb.recordOutcome(rec({ role: 'reviewer', won: false, quality: 0.4 }));

    expect(sb.roleScore('code', 'reviewer', 'grok-3')).toBeCloseTo(0.7 * 0.6 + 0.3 * 0.5, 5);
    expect(sb.roleScore('code', 'reviewer-7', 'grok-3')).toBeCloseTo(0.7 * 0.6 + 0.3 * 0.5, 5);
    const ranking = sb.roleRanking('code', 'reviewer');
    expect(ranking).toHaveLength(1);
    expect(ranking[0]!.runs).toBe(2);
    expect(ranking[0]!.role).toBe('reviewer');
  });
});

describe('ModelScoreboard v2 — JSONL ledger', () => {
  it('appends one JSON line per outcome', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ won: true }));
    sb.recordOutcome(rec({ won: false }));
    const lines = fs.readFileSync(tmpFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).won).toBe(true);
  });

  it('migrates a legacy pretty-JSON array ledger in place', () => {
    fs.writeFileSync(tmpFile, JSON.stringify([rec({ won: true }), rec({ won: false })], null, 2), 'utf-8');
    const sb = new ModelScoreboard(tmpFile);
    expect(sb.winRate('code', 'grok-3')).toBeCloseTo(0.5, 5);
    expect(fs.readFileSync(tmpFile, 'utf-8').trimStart().startsWith('{')).toBe(true);
    // And appends keep working after migration.
    sb.recordOutcome(rec({ won: true }));
    expect(new ModelScoreboard(tmpFile).runCount('code', 'grok-3')).toBe(3);
  });

  it('migrates from the sibling legacy .json file when the .jsonl does not exist yet', () => {
    const jsonl = path.join(path.dirname(tmpFile), 'perf2.jsonl');
    const legacy = path.join(path.dirname(tmpFile), 'perf2.json');
    fs.writeFileSync(legacy, JSON.stringify([rec({ won: true })], null, 2), 'utf-8');

    const sb = new ModelScoreboard(jsonl);
    expect(sb.winRate('code', 'grok-3')).toBe(1);
    expect(fs.existsSync(jsonl)).toBe(true);
    // Legacy file is left untouched (recoverable).
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it('picks up cross-process appends after the throttled reload-check window', () => {
    vi.useFakeTimers();
    const writer = new ModelScoreboard(tmpFile);
    const reader = new ModelScoreboard(tmpFile);
    expect(reader.runCount('code', 'grok-3')).toBe(0);

    writer.recordOutcome(rec({ won: true }));
    expect(reader.runCount('code', 'grok-3')).toBe(0);
    vi.advanceTimersByTime(249);
    expect(reader.runCount('code', 'grok-3')).toBe(0);
    vi.advanceTimersByTime(1);
    expect(reader.runCount('code', 'grok-3')).toBe(1);
    expect(reader.winRate('code', 'grok-3')).toBe(1);
  });

  it('reloads before writes so a throttled check cannot mask another writer', () => {
    vi.useFakeTimers();
    const first = new ModelScoreboard(tmpFile);
    const second = new ModelScoreboard(tmpFile);
    expect(second.runCount('code', 'grok-3')).toBe(0);

    first.recordOutcome(rec({ model: 'grok-3', won: true }));
    second.recordOutcome(rec({ model: 'gpt-5.5', won: false }));

    expect(second.runCount('code', 'grok-3')).toBe(1);
    expect(second.runCount('code', 'gpt-5.5')).toBe(1);
  });

  it('survives a torn/corrupt line without losing the ledger', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ won: true }));
    fs.appendFileSync(tmpFile, '{"broken json...\n', 'utf-8');
    sb.recordOutcome(rec({ won: false }));
    expect(new ModelScoreboard(tmpFile).runCount('code', 'grok-3')).toBe(2);
  });
});
