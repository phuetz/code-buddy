/**
 * Automatic revision loop — a revisable verdict is handed to a reviser LLM
 * with the annotations; the revised diff re-enters the SAME gate, bounded
 * rounds, fail-closed at every link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { buildProposedDiff } from '../../src/review/diff-model.js';
import { reviewProposedDiff } from '../../src/review/review-engine.js';
import { reviseProposedDiff, reviewApplyWithRevisions } from '../../src/review/revision-loop.js';
import { reviewGatedWrite } from '../../src/review/write-gate.js';
import { resetCheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import type { CouncilChatClient } from '../../src/council/types.js';
import type { ReviewLens } from '../../src/review/types.js';

let workDir: string;

beforeEach(() => {
  resetCheckpointManager();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-loop-'));
});

afterEach(() => {
  resetCheckpointManager();
  fs.rmSync(workDir, { recursive: true, force: true });
});

const ORIGIN = { kind: 'agent' as const, label: 't' };
const LENSES: ReviewLens[] = [{ id: 'correctness', label: 'Correctness reviewer', focus: 'bugs' }];

function write(rel: string, content: string): void {
  const abs = path.join(workDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function read(rel: string): string {
  return fs.readFileSync(path.join(workDir, rel), 'utf-8');
}

function jsonClient(fn: (system: string, user: string) => string): CouncilChatClient {
  return {
    async chat(messages) {
      const system = messages[0]!.content;
      const user = messages[messages.length - 1]!.content;
      return { content: fn(system, user), promptTokens: 1, totalTokens: 2 };
    },
  };
}

/** Reviewer that annotates until it sees the fixed content, then accepts. */
function convergingReviewer(fixedMarker: string): CouncilChatClient {
  return jsonClient((_system, user) =>
    user.includes(fixedMarker)
      ? '{"decision":"accept","annotations":[],"why":"fixed"}'
      : '{"decision":"annotate","annotations":[{"path":"a.ts","line":1,"severity":"warning","message":"wrong value","suggestedFix":"const a = 3;"}],"why":"revise"}',
  );
}

function fixingReviser(): CouncilChatClient {
  return jsonClient(
    () => '{"files":[{"path":"a.ts","newContent":"const a = 3;\\n"}],"note":"applied the suggested fix"}',
  );
}

describe('reviewApplyWithRevisions — converging loop', () => {
  it('annotate → revise → accept → applied, with lineage in the ledger', async () => {
    write('a.ts', 'const a = 1;\n');

    const result = await reviewApplyWithRevisions(
      { workDir, intent: 'bump a', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }] },
      { mode: 'full', client: convergingReviewer('const a = 3'), lenses: LENSES },
      {},
      { client: fixingReviser(), maxRounds: 3 },
    );

    expect(result.revised).toBe(true);
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]!.decision).toBe('annotate');
    expect(result.rounds[0]!.reviserNote).toBe('applied the suggested fix');
    expect(result.rounds[1]!.decision).toBe('accept');
    expect(result.final.apply?.applied).toBe(true);
    expect(read('a.ts')).toBe('const a = 3;\n');

    const ledger = read('.codebuddy/diff-reviews.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    expect(ledger).toHaveLength(2);
    expect(ledger[1].intent).toMatch(/revision 1 of diff-[0-9a-f]{16}/);
    expect(ledger[1].applied).toBe(true);
  });

  it('revises a MERIT static reject (smuggled secret removed) even without a reviewer LLM', async () => {
    write('a.ts', 'const a = 1;\n');
    const reviser = jsonClient(
      () => '{"files":[{"path":"a.ts","newContent":"const a = 2;\\n"}],"note":"dropped the hardcoded key"}',
    );

    const result = await reviewApplyWithRevisions(
      {
        workDir,
        intent: 'bump a',
        origin: ORIGIN,
        changes: [{ path: 'a.ts', newContent: 'const k = "AKIAABCDEFGHIJKLMNOP";\n' }],
      },
      { mode: 'static' },
      {},
      { client: reviser, maxRounds: 2 },
    );

    expect(result.rounds[0]!.decision).toBe('reject');
    expect(result.final.verdict.decision).toBe('accept');
    expect(result.final.apply?.applied).toBe(true);
    expect(read('a.ts')).toBe('const a = 2;\n');
  });

  it('stops honestly when the reviser fails (non-JSON) — last verdict kept, nothing applied', async () => {
    write('a.ts', 'const a = 1;\n');
    const brokenReviser = jsonClient(() => 'I would rather write prose.');

    const result = await reviewApplyWithRevisions(
      { workDir, intent: 'sneak', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'const k = "AKIAABCDEFGHIJKLMNOP";\n' }] },
      { mode: 'static' },
      {},
      { client: brokenReviser, maxRounds: 3 },
    );

    expect(result.revised).toBe(false);
    expect(result.rounds).toHaveLength(1);
    expect(result.final.verdict.decision).toBe('reject');
    expect(read('a.ts')).toBe('const a = 1;\n');
  });

  it('does NOT revise fail-closed verdicts (nothing to revise from)', async () => {
    write('a.ts', 'const a = 1;\n');
    const reviser = { chat: vi.fn() };

    const result = await reviewApplyWithRevisions(
      { workDir, intent: 'bump', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }] },
      { mode: 'full', client: null }, // no reviewer → failClosed reject
      {},
      { client: reviser as unknown as CouncilChatClient, maxRounds: 3 },
    );

    expect(result.rounds).toHaveLength(1);
    expect(result.final.verdict.failClosed).toBe(true);
    expect(reviser.chat).not.toHaveBeenCalled();
  });

  it('exhausts maxRounds and returns the last honest verdict', async () => {
    write('a.ts', 'const a = 1;\n');
    const neverSatisfiedReviewer = jsonClient(
      () => '{"decision":"annotate","annotations":[{"path":"a.ts","severity":"warning","message":"still not right"}],"why":"no"}',
    );
    const stubbornReviser = jsonClient(
      () => '{"files":[{"path":"a.ts","newContent":"const a = 42;\\n"}],"note":"tried again"}',
    );

    const result = await reviewApplyWithRevisions(
      { workDir, intent: 'bump', origin: ORIGIN, changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }] },
      { mode: 'full', client: neverSatisfiedReviewer, lenses: LENSES },
      {},
      { client: stubbornReviser, maxRounds: 2 },
    );

    expect(result.rounds).toHaveLength(2);
    expect(result.final.verdict.decision).toBe('annotate');
    expect(result.final.apply).toBeNull();
    expect(read('a.ts')).toBe('const a = 1;\n');
  });
});

describe('reviseProposedDiff — reviser output guard rails', () => {
  async function annotatedDiff(changes: Array<{ path: string; newContent: string | null }>) {
    const diff = buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes });
    const verdict = await reviewProposedDiff(diff, { mode: 'static' });
    return { diff, verdict };
  }

  it('drops paths outside the original diff (a revision must narrow, not expand)', async () => {
    write('a.ts', 'const a = 1;\n');
    const { diff, verdict } = await annotatedDiff([{ path: 'a.ts', newContent: 'const k = "AKIAABCDEFGHIJKLMNOP";\n' }]);
    const reviser = jsonClient(
      () =>
        '{"files":[{"path":"a.ts","newContent":"const a = 2;\\n"},{"path":"evil.ts","newContent":"malware"}],"note":"fixed"}',
    );

    const attempt = await reviseProposedDiff(reviser, diff, verdict, 1000);

    expect(attempt).not.toBeNull();
    expect(attempt!.changes.map((c) => c.path)).toEqual(['a.ts']);
    expect(attempt!.droppedPaths).toEqual(['evil.ts']);
  });

  it('KEEP-BASE withdraws a file; withdrawing everything fails closed', async () => {
    write('a.ts', 'const a = 1;\n');
    const { diff, verdict } = await annotatedDiff([{ path: 'a.ts', newContent: 'const k = "AKIAABCDEFGHIJKLMNOP";\n' }]);
    const withdrawingReviser = jsonClient(() => '{"files":[{"path":"a.ts","newContent":"KEEP-BASE"}],"note":"drop it"}');

    expect(await reviseProposedDiff(withdrawingReviser, diff, verdict, 1000)).toBeNull();
  });

  it('carries forgotten files over unchanged (a partial answer must not drop half the proposal)', async () => {
    write('a.ts', 'const a = 1;\n');
    write('b.ts', 'const b = 1;\n');
    const { diff, verdict } = await annotatedDiff([
      { path: 'a.ts', newContent: 'const k = "AKIAABCDEFGHIJKLMNOP";\n' },
      { path: 'b.ts', newContent: 'const b = 2;\n' },
    ]);
    const forgetfulReviser = jsonClient(
      () => '{"files":[{"path":"a.ts","newContent":"const a = 2;\\n"}],"note":"fixed a only"}',
    );

    const attempt = await reviseProposedDiff(forgetfulReviser, diff, verdict, 1000);

    expect(attempt!.changes).toHaveLength(2);
    expect(attempt!.changes.find((c) => c.path === 'b.ts')!.newContent).toBe('const b = 2;\n');
  });

  it('fails closed on oversized files instead of risking truncated content', async () => {
    write('big.ts', 'x\n');
    const { diff, verdict } = await annotatedDiff([{ path: 'big.ts', newContent: `${'y'.repeat(25_000)}\n// ... rest of the code ...\n` }]);
    const reviser = { chat: vi.fn() };

    expect(await reviseProposedDiff(reviser as unknown as CouncilChatClient, diff, verdict, 1000)).toBeNull();
    expect(reviser.chat).not.toHaveBeenCalled();
  });
});

describe('reviewGatedWrite — revision integration', () => {
  it('reports the revision rounds and notes in the agent-facing summary', async () => {
    write('a.ts', 'const a = 1;\n');

    const outcome = await reviewGatedWrite(
      { changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }], cwd: workDir, intent: 'bump a' },
      {
        mode: 'full',
        client: convergingReviewer('const a = 3'),
        revision: { enabled: true, maxRounds: 3, client: fixingReviser() },
      },
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toMatch(/review accepted after 1 revision round \(full:/);
    expect(outcome.summary).toMatch(/revision 1: applied the suggested fix/);
    expect(read('a.ts')).toBe('const a = 3;\n');
  });

  it('stays single-shot when revision is disabled (default)', async () => {
    write('a.ts', 'const a = 1;\n');

    const outcome = await reviewGatedWrite(
      { changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }], cwd: workDir, intent: 'bump a' },
      { mode: 'full', client: convergingReviewer('const a = 3') },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/requests changes \(full:/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });
});
