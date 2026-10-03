import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getCheckpointManager, resetCheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';

// Real writes, review engine and checkpoints. Only the human response is scripted.
describe('B5 adverse review: creation safety', () => {
  let dir: string;
  let editor: TextEditorTool;
  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), 'cb-create-safety-'));
    ConfirmationService.getInstance().resetSession();
    resetCheckpointManager();
    editor = new TextEditorTool();
    editor.setBaseDirectory(dir);
    vi.stubEnv('CODEBUDDY_DIFF_REVIEW', 'static');
    vi.stubEnv('CODEBUDDY_DIFF_REVIEW_REVISE', 'false');
    vi.stubEnv('CODEBUDDY_SHADOW_WORKSPACE', 'false');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    editor.dispose();
    ConfirmationService.getInstance().resetSession();
    resetCheckpointManager();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(['create', 'strReplace', 'insert', 'replaceLines'] as const)('G1: accepted static review really writes %s and records a checkpoint', async operation => {
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
    const target = join(dir, 'answer.txt');
    if (operation !== 'create') fs.writeFileSync(target, 'OLD\n');
    const result = operation === 'create' ? await editor.create(target, 'NEW\n')
      : operation === 'strReplace' ? await editor.strReplace(target, 'OLD', 'NEW')
      : operation === 'insert' ? await editor.insert(target, 1, 'NEW')
      : await editor.replaceLines(target, 1, 1, 'NEW');
    expect(result.success).toBe(true);
    expect(result.output).toContain('review accepted');
    expect(fs.readFileSync(target, 'utf8')).toContain('NEW');
    const records = fs.readFileSync(join(dir, '.codebuddy/diff-reviews.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(records.at(-1)).toMatchObject({ applied: true, decision: 'accept' });
    expect(getCheckpointManager().getCheckpoint(records.at(-1).checkpointId)).toBeDefined();
  });

  it.each(['off', 'static'])('G2: a file created during confirmation survives with review %s', async mode => {
    vi.stubEnv('CODEBUDDY_DIFF_REVIEW', mode);
    const target = join(dir, 'answer.txt');
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async () => {
      fs.writeFileSync(target, 'CONCURRENT\n');
      return { confirmed: true };
    });
    const result = await editor.create(target, 'AGENT\n');
    expect(result.success).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('CONCURRENT\n');
  });

  it.each(['file', 'secret-link'])('G2: an entry (%s) created after conflict checking survives both apply and rollback', async kind => {
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
    const target = join(dir, 'answer.txt');
    const secret = join(dir, '.env');
    fs.writeFileSync(secret, 'CANARY_SECRET_B5');
    getCheckpointManager().once('checkpoint-created', () => {
      if (kind === 'file') fs.writeFileSync(target, 'CONCURRENT\n');
      else fs.symlinkSync(secret, target);
    });
    const result = await editor.create(target, 'AGENT\n');
    expect(result.success).toBe(false);
    if (kind === 'file') expect(fs.readFileSync(target, 'utf8')).toBe('CONCURRENT\n');
    else {
      expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(secret, 'utf8')).toBe('CANARY_SECRET_B5');
    }
    expect(JSON.stringify(getCheckpointManager().getCheckpoints())).not.toContain('CANARY_SECRET_B5');
    expect(fs.readdirSync(dir).some(name => name.startsWith('.cb-create-'))).toBe(false);
  });

  it('G2: a secret symlink introduced during confirmation is neither read nor overwritten', async () => {
    const secret = join(dir, '.env');
    const target = join(dir, 'answer.txt');
    fs.writeFileSync(secret, 'TOKEN=CANARY_SECRET_B5\n');
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async () => {
      fs.symlinkSync(secret, target);
      return { confirmed: true };
    });
    const read = vi.spyOn(fs, 'readFileSync');
    const result = await editor.create(target, 'AGENT\n');
    expect(result.success).toBe(false);
    expect(read.mock.calls.some(([p]) => p === target || p === secret)).toBe(false);
    expect(JSON.stringify(result)).not.toContain('CANARY_SECRET_B5');
    expect(fs.readFileSync(secret, 'utf8')).toBe('TOKEN=CANARY_SECRET_B5\n');
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
  });

  it('G2: revalidates containment when the parent changes after review', async () => {
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
    const parent = join(dir, 'sub');
    const outside = fs.mkdtempSync(join(tmpdir(), 'cb-create-outside-'));
    fs.mkdirSync(parent);
    getCheckpointManager().once('checkpoint-created', () => {
      fs.renameSync(parent, join(dir, 'old-sub'));
      fs.symlinkSync(outside, parent);
    });
    try {
      const result = await editor.create(join(parent, 'answer.txt'), 'AGENT\n');
      expect(result.success).toBe(false);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it.each(['directory', 'dangling-link'])('G4: rejects an existing %s before requesting confirmation', async kind => {
    const target = join(dir, 'answer.txt');
    if (kind === 'directory') fs.mkdirSync(target);
    else fs.symlinkSync(join(dir, 'missing'), target);
    const confirm = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockResolvedValue({ confirmed: true });
    const result = await editor.create(target, 'AGENT\n');
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(confirm).not.toHaveBeenCalled();
    expect(fs.lstatSync(target)[kind === 'directory' ? 'isDirectory' : 'isSymbolicLink']()).toBe(true);
  });
});
