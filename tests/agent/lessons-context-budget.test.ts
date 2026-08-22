/**
 * <lessons_context> budgeting — the block used to inject EVERY active lesson
 * on EVERY turn. It now packs a char budget in priority order (category, then
 * BM25 relevance to the message, else recency) and states dropped counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { LessonsTracker, DEFAULT_LESSONS_CONTEXT_CHARS } from '../../src/agent/lessons-tracker.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-budget-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function tracker(): LessonsTracker {
  return new LessonsTracker(tmpDir);
}

describe('buildContextBlock — budget', () => {
  it('keeps everything when under budget (legacy behavior preserved)', () => {
    const t = tracker();
    t.add('RULE', 'run the touched tests before done', 'manual');
    t.add('INSIGHT', 'the parser is order-sensitive', 'manual');

    const block = t.buildContextBlock()!;
    expect(block).toContain('run the touched tests');
    expect(block).toContain('order-sensitive');
    expect(block).not.toContain('over the');
  });

  it('packs the budget in category priority — a RULE is never displaced by an INSIGHT', () => {
    const t = tracker();
    t.add('INSIGHT', 'I'.repeat(300), 'manual');
    t.add('INSIGHT', 'J'.repeat(300), 'manual');
    t.add('RULE', 'R'.repeat(300), 'manual');

    const block = t.buildContextBlock({ maxChars: 350 })!;
    expect(block).toContain('[RULE]');
    expect(block).not.toContain('[INSIGHT]');
    expect(block).toMatch(/\+2 lessons over the 350-char budget/);
  });

  it('ranks within a category by BM25 relevance to the message', () => {
    const t = tracker();
    t.add('INSIGHT', 'les migrations sqlite exigent le mode WAL pour la concurrence', 'manual');
    t.add('INSIGHT', 'les websockets telegram exigent un token de bot dédié', 'manual');

    const block = t.buildContextBlock({ query: 'migrer le stockage sqlite', maxChars: 80 })!;
    expect(block).toContain('sqlite');
    expect(block).not.toContain('telegram');
    expect(block).toMatch(/ranked by relevance/);
  });

  it('falls back to recency without a query', async () => {
    const t = tracker();
    t.add('INSIGHT', 'older lesson '.padEnd(60, 'x'), 'manual');
    await new Promise((r) => setTimeout(r, 10)); // distinct createdAt
    t.add('INSIGHT', 'newer lesson '.padEnd(60, 'y'), 'manual');

    const block = t.buildContextBlock({ maxChars: 80 })!;
    expect(block).toContain('newer lesson');
    expect(block).not.toContain('older lesson');
    expect(block).toMatch(/ranked by recency/);
  });

  it('best-fit: a long over-budget lesson does not starve a shorter one that fits', async () => {
    const t = tracker();
    t.add('RULE', 'short rule keep me', 'manual'); // older, short
    await new Promise((r) => setTimeout(r, 10)); // distinct createdAt → the long one ranks first by recency
    t.add('RULE', 'X'.repeat(400), 'manual'); // newer, long → over budget on its own

    const block = t.buildContextBlock({ maxChars: 100 })!;
    // The long lesson overflows and is skipped, but the short one still fits and is shown
    // (the old hard-break would have dropped BOTH once the first over-budget item was hit).
    expect(block).toContain('short rule keep me');
    expect(block).not.toContain('X'.repeat(400));
    expect(block).toMatch(/\+1 lesson over the 100-char budget/);
  });

  it('exports a sane default budget', () => {
    expect(DEFAULT_LESSONS_CONTEXT_CHARS).toBe(2000);
  });

  it('caches per (budget, query) — a different query is not served the stale block', () => {
    const t = tracker();
    t.add('INSIGHT', 'sqlite fact for cache test aaaaaaaaaaaaaaaaaaaaaaa', 'manual');
    t.add('INSIGHT', 'telegram fact for cache test bbbbbbbbbbbbbbbbbbbbb', 'manual');

    const first = t.buildContextBlock({ query: 'sqlite', maxChars: 70 })!;
    const second = t.buildContextBlock({ query: 'telegram', maxChars: 70 })!;
    expect(first).toContain('sqlite');
    expect(second).toContain('telegram');
  });
});
