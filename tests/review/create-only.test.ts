import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyReviewedDiff } from '../../src/review/apply-transaction.js';
import { reviewGatedWrite } from '../../src/review/write-gate.js';
import { buildProposedDiff } from '../../src/review/diff-model.js';
import { reviseProposedDiff } from '../../src/review/revision-loop.js';
import { reviewProposedDiff } from '../../src/review/review-engine.js';
import { getCheckpointManager, resetCheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'cb-create-review-'));
  resetCheckpointManager();
});
afterEach(() => {
  resetCheckpointManager();
  fs.rmSync(dir, { recursive: true, force: true });
});
const accepted = '{"decision":"accept","annotations":[],"why":"safe"}';
const origin = { kind: 'agent' as const, label: 'create_file' };

describe('creation intent across the real review engine', () => {
  it('G1: full review with an accepting scripted client writes and checkpoints the file', async () => {
    const result = await reviewGatedWrite({ cwd: dir, intent: 'create', changes: [{ path: 'answer.txt', newContent: 'NEW\n', createOnly: true }] },
      { mode: 'full', client: { async chat() { return { content: accepted }; } } });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(join(dir, 'answer.txt'), 'utf8')).toBe('NEW\n');
    expect(getCheckpointManager().getCheckpoints().at(-1)?.files).toContainEqual({ path: join(dir, 'answer.txt'), content: '', existed: false });
  });

  it('G2: a creation appearing while the full reviewer answers is preserved', async () => {
    const target = join(dir, 'answer.txt');
    const result = await reviewGatedWrite({ cwd: dir, intent: 'create', changes: [{ path: 'answer.txt', newContent: 'AGENT\n', createOnly: true }] },
      { mode: 'full', client: { async chat() { fs.writeFileSync(target, 'CONCURRENT\n'); return { content: accepted }; } } });
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('CONCURRENT\n');
  });

  it('G2: a late creation conflict rolls back an earlier edit without changing the competitor', async () => {
    fs.writeFileSync(join(dir, 'existing.txt'), 'OLD\n');
    const diff = buildProposedDiff({ workDir: dir, intent: 'mixed', origin, changes: [
      { path: 'existing.txt', newContent: 'EDIT\n' },
      { path: 'answer.txt', newContent: 'AGENT\n', createOnly: true },
    ] });
    const verdict = await reviewProposedDiff(diff, { mode: 'static' });
    getCheckpointManager().once('checkpoint-created', () => fs.writeFileSync(join(dir, 'answer.txt'), 'CONCURRENT\n'));
    const result = applyReviewedDiff(diff, verdict);
    expect(result.applied).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(fs.readFileSync(join(dir, 'existing.txt'), 'utf8')).toBe('OLD\n');
    expect(fs.readFileSync(join(dir, 'answer.txt'), 'utf8')).toBe('CONCURRENT\n');
  });

  it('G2: rebuilding a revised creation never reads a newly introduced secret symlink', async () => {
    const input = { workDir: dir, intent: 'create', origin, changes: [{ path: 'answer.txt', newContent: 'AGENT\n', createOnly: true }] };
    const initial = buildProposedDiff(input);
    const verdict = await reviewProposedDiff(initial, { mode: 'static' });
    const revision = await reviseProposedDiff({ async chat() {
      fs.writeFileSync(join(dir, '.env'), 'CANARY_SECRET_B5');
      fs.symlinkSync(join(dir, '.env'), join(dir, 'answer.txt'));
      return { content: '{"files":[{"path":"answer.txt","newContent":"REVISED\\n"}]}' };
    } }, initial, verdict);
    expect(revision?.changes).toEqual([{ path: 'answer.txt', newContent: 'REVISED\n', createOnly: true }]);
    const revised = buildProposedDiff({ ...input, changes: revision!.changes });
    expect(revised.files[0]).toMatchObject({ action: 'create', baseContent: null });
    expect(JSON.stringify(revised)).not.toContain('CANARY_SECRET_B5');
    expect((await reviewProposedDiff(revised, { mode: 'static' })).decision).toBe('reject');
  });

  it('G2: a reviser cannot convert a creation into deletion of a competing file', async () => {
    const initial = buildProposedDiff({ workDir: dir, intent: 'create', origin, changes: [{ path: 'answer.txt', newContent: 'AGENT\n', createOnly: true }] });
    const verdict = await reviewProposedDiff(initial, { mode: 'static' });
    const revision = await reviseProposedDiff({ async chat() {
      fs.writeFileSync(join(dir, 'answer.txt'), 'CONCURRENT\n');
      return { content: '{"files":[{"path":"answer.txt","newContent":null}]}' };
    } }, initial, verdict);
    expect(revision).toBeNull();
    expect(fs.readFileSync(join(dir, 'answer.txt'), 'utf8')).toBe('CONCURRENT\n');
  });
});
