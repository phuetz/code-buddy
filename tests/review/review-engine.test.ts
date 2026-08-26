/**
 * Review engine + facade — fail-closed aggregation (AND, never a vote),
 * short-circuits, mode gating, ledger, end-to-end reviewAndApply.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { buildProposedDiff } from '../../src/review/diff-model.js';
import {
  resolveReviewMode,
  reviewAndApply,
  reviewProposedDiff,
} from '../../src/review/review-engine.js';
import { resetCheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import type { CouncilChatClient } from '../../src/council/types.js';
import type { ReviewLens } from '../../src/review/types.js';

let workDir: string;

beforeEach(() => {
  resetCheckpointManager();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-engine-'));
});

afterEach(() => {
  resetCheckpointManager();
  fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const ORIGIN = { kind: 'council' as const, label: 'council-synthesis' };

function write(rel: string, content: string): void {
  const abs = path.join(workDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function jsonClient(byLens: Record<string, string>): CouncilChatClient {
  return {
    async chat(messages) {
      const system = messages[0]!.content;
      const lens = Object.keys(byLens).find((id) => system.includes(`the ${id}`) || system.toLowerCase().includes(id));
      return { content: byLens[lens ?? ''] ?? '{"decision":"accept","annotations":[],"why":"ok"}', promptTokens: 1, totalTokens: 2 };
    },
  };
}

const ACCEPT_JSON = '{"decision":"accept","annotations":[],"why":"clean"}';

describe('resolveReviewMode', () => {
  it('defaults to off and honours the env values', () => {
    expect(resolveReviewMode({})).toBe('off');
    expect(resolveReviewMode({ CODEBUDDY_DIFF_REVIEW: 'static' })).toBe('static');
    expect(resolveReviewMode({ CODEBUDDY_DIFF_REVIEW: 'FULL' })).toBe('full');
    expect(resolveReviewMode({ CODEBUDDY_DIFF_REVIEW: 'nonsense' })).toBe('off');
  });
});

describe('reviewProposedDiff', () => {
  it('static mode accepts a clean diff without any LLM', async () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({ workDir, intent: 'bump', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'v2\n' }] });

    const verdict = await reviewProposedDiff(diff, { mode: 'static' });

    expect(verdict.decision).toBe('accept');
    expect(verdict.failClosed).toBe(false);
    expect(verdict.reviewers.map((r) => r.reviewer)).toEqual(['static-gate']);
  });

  it('conflicts short-circuit everything (merit reject, not fail-closed)', async () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'v2\n' }] });
    write('a.ts', 'raced\n');

    const client = { chat: vi.fn() };
    const verdict = await reviewProposedDiff(diff, { mode: 'full', client: client as unknown as CouncilChatClient });

    expect(verdict.decision).toBe('reject');
    expect(verdict.failClosed).toBe(false);
    expect(verdict.conflicts[0]!.kind).toBe('stale-base');
    expect(client.chat).not.toHaveBeenCalled(); // no token spent on a stale diff
  });

  it('a static blocker short-circuits the LLM reviewers', async () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [{ path: 'a.ts', newContent: '// ... rest of the code remains the same ...\n' }],
    });
    const client = { chat: vi.fn() };

    const verdict = await reviewProposedDiff(diff, { mode: 'full', client: client as unknown as CouncilChatClient });

    expect(verdict.decision).toBe('reject');
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('full mode aggregates lenses with AND semantics — one blocker vetoes', async () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'v2\n' }] });
    const client = jsonClient({
      correctness: ACCEPT_JSON,
      security: '{"decision":"reject","annotations":[{"path":"a.ts","severity":"blocker","message":"widens permissions"}],"why":"unsafe"}',
    });

    const verdict = await reviewProposedDiff(diff, { mode: 'full', client });

    expect(verdict.decision).toBe('reject');
    expect(verdict.failClosed).toBe(false); // merit reject
    expect(verdict.annotations.some((a) => a.message.includes('widens permissions'))).toBe(true);
    expect(verdict.reviewers.map((r) => r.reviewer)).toEqual(['static-gate', 'correctness', 'security']);
  });

  it('warnings without blockers aggregate to annotate', async () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'v2\n' }] });
    const client = jsonClient({
      correctness: '{"decision":"annotate","annotations":[{"path":"a.ts","severity":"warning","message":"missing test"}],"why":"revise"}',
      security: ACCEPT_JSON,
    });

    const verdict = await reviewProposedDiff(diff, { mode: 'full', client });
    expect(verdict.decision).toBe('annotate');
  });

  it('full mode without a client fails CLOSED (reject, failClosed=true)', async () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'v2\n' }] });

    const verdict = await reviewProposedDiff(diff, { mode: 'full', client: null });

    expect(verdict.decision).toBe('reject');
    expect(verdict.failClosed).toBe(true); // unreviewable, not merit — caller may retry
  });

  it('a dead reviewer fails CLOSED while a merit finding stays merit', async () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'v2\n' }] });

    const bothDead: CouncilChatClient = {
      async chat() {
        throw new Error('provider down');
      },
    };
    const dead = await reviewProposedDiff(diff, { mode: 'full', client: bothDead });
    expect(dead.decision).toBe('reject');
    expect(dead.failClosed).toBe(true);

    const oneDeadOneMerit = jsonClient({
      correctness: 'not json at all',
      security: '{"decision":"reject","annotations":[{"path":"a.ts","severity":"blocker","message":"real issue"}],"why":"no"}',
    });
    const merit = await reviewProposedDiff(diff, { mode: 'full', client: oneDeadOneMerit });
    expect(merit.decision).toBe('reject');
    expect(merit.failClosed).toBe(false); // a real blocker exists — not just unreviewability
  });
});

describe('reviewAndApply (facade, end to end)', () => {
  const lenses: ReviewLens[] = [{ id: 'correctness', label: 'Correctness reviewer', focus: 'bugs' }];

  it('accept → applies transactionally and journals to the ledger', async () => {
    write('a.ts', 'v1\n');

    const result = await reviewAndApply(
      { workDir, intent: 'bump a', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'v2\n' }] },
      { mode: 'full', client: jsonClient({ correctness: ACCEPT_JSON }), lenses },
    );

    expect(result.verdict.decision).toBe('accept');
    expect(result.apply?.applied).toBe(true);
    expect(fs.readFileSync(path.join(workDir, 'a.ts'), 'utf-8')).toBe('v2\n');

    const ledger = fs.readFileSync(path.join(workDir, '.codebuddy', 'diff-reviews.jsonl'), 'utf-8').trim().split('\n');
    expect(ledger).toHaveLength(1);
    const record = JSON.parse(ledger[0]!);
    expect(record.decision).toBe('accept');
    expect(record.applied).toBe(true);
    expect(record.appliedFiles).toEqual(['a.ts']);
    expect(record.checkpointId).toBeTruthy();
  });

  it('annotate (atomic) → nothing applied, annotations returned for revision', async () => {
    write('a.ts', 'v1\n');
    const client = jsonClient({
      correctness: '{"decision":"annotate","annotations":[{"path":"a.ts","severity":"warning","message":"add a test"}],"why":"revise"}',
    });

    const result = await reviewAndApply(
      { workDir, intent: 'bump a', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'v2\n' }] },
      { mode: 'full', client, lenses },
    );

    expect(result.verdict.decision).toBe('annotate');
    expect(result.apply).toBeNull();
    expect(result.verdict.annotations[0]!.message).toBe('add a test');
    expect(fs.readFileSync(path.join(workDir, 'a.ts'), 'utf-8')).toBe('v1\n');
    const record = JSON.parse(fs.readFileSync(path.join(workDir, '.codebuddy', 'diff-reviews.jsonl'), 'utf-8').trim());
    expect(record.decision).toBe('annotate');
    expect(record.applied).toBe(false);
  });

  it('reject → nothing applied, journaled', async () => {
    write('a.ts', 'v1\n');

    const result = await reviewAndApply(
      { workDir, intent: 'sneak a key in', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'const k = "AKIAABCDEFGHIJKLMNOP";\n' }] },
      { mode: 'static' },
    );

    expect(result.verdict.decision).toBe('reject');
    expect(result.apply).toBeNull();
    expect(fs.readFileSync(path.join(workDir, 'a.ts'), 'utf-8')).toBe('v1\n');
  });
});
