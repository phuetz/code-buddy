/**
 * Write gate wiring — apply_patch dry-run + bridge outcomes, and the
 * create_file/write_file path through TextEditorTool.create, all behind
 * CODEBUDDY_DIFF_REVIEW (off paths untouched).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { ApplyPatchTool, computePatchedFiles, parsePatch } from '../../src/tools/apply-patch.js';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { MultiEditTool } from '../../src/tools/multi-edit.js';
import { reviewGatedWrite } from '../../src/review/write-gate.js';
import { resetCheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import type { CouncilChatClient } from '../../src/council/types.js';

let workDir: string;
let previousCwd: string;
let previousEnv: string | undefined;

beforeEach(() => {
  resetCheckpointManager();
  previousCwd = process.cwd();
  previousEnv = process.env.CODEBUDDY_DIFF_REVIEW;
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-gate-'));
  ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
});

afterEach(() => {
  process.chdir(previousCwd);
  if (previousEnv === undefined) delete process.env.CODEBUDDY_DIFF_REVIEW;
  else process.env.CODEBUDDY_DIFF_REVIEW = previousEnv;
  resetCheckpointManager();
  fs.rmSync(workDir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(workDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function read(rel: string): string {
  return fs.readFileSync(path.join(workDir, rel), 'utf-8');
}

const UPDATE_PATCH = [
  '*** Begin Patch',
  '*** Update File: a.ts',
  '@@',
  '-const a = 1;',
  '+const a = 2;',
  '*** End Patch',
].join('\n');

describe('computePatchedFiles (dry-run)', () => {
  it('computes full resulting content for add/update/delete/move without writing', () => {
    write('a.ts', 'const a = 1;\nconst keep = true;\n');
    write('dead.ts', 'x\n');
    write('moved.ts', 'const m = 1;\n');
    const ops = parsePatch(
      [
        '*** Begin Patch',
        '*** Add File: fresh.ts',
        '+created',
        '*** Delete File: dead.ts',
        '*** Update File: a.ts',
        '@@',
        '-const a = 1;',
        '+const a = 2;',
        '*** Update File: moved.ts',
        '*** Move to: renamed.ts',
        '@@',
        '-const m = 1;',
        '+const m = 2;',
        '*** End Patch',
      ].join('\n'),
    );

    const { changes, errors } = computePatchedFiles(ops, workDir);

    expect(errors).toEqual([]);
    const byPath = new Map(changes.map((c) => [c.path, c.newContent]));
    expect(byPath.get('fresh.ts')).toBe('created');
    expect(byPath.get('dead.ts')).toBeNull();
    expect(byPath.get('a.ts')).toBe('const a = 2;\nconst keep = true;\n');
    expect(byPath.get('renamed.ts')).toBe('const m = 2;\n');
    expect(byPath.get('moved.ts')).toBeNull();
    // Nothing was written.
    expect(read('a.ts')).toContain('const a = 1;');
    expect(fs.existsSync(path.join(workDir, 'fresh.ts'))).toBe(false);
  });

  it('is strict: a failed hunk is an error, not a partial resolve', () => {
    write('a.ts', 'completely different content\n');
    const ops = parsePatch(UPDATE_PATCH);
    const { changes, errors } = computePatchedFiles(ops, workDir);
    expect(errors[0]).toMatch(/Hunk failed/);
    expect(changes).toEqual([]);
  });
});

describe('reviewGatedWrite (shared gate)', () => {
  it('static mode: clean change → reviewed, applied transactionally, ok summary', async () => {
    write('a.ts', 'const a = 1;\n');
    const { changes } = computePatchedFiles(parsePatch(UPDATE_PATCH), workDir);

    const outcome = await reviewGatedWrite({ changes, cwd: workDir, intent: 'bump a' }, { mode: 'static' });

    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toMatch(/review accepted \(static: static-gate\)/);
    expect(read('a.ts')).toBe('const a = 2;\n');
    expect(fs.existsSync(path.join(workDir, '.codebuddy', 'diff-reviews.jsonl'))).toBe(true);
  });

  it('static mode: introduced secret → blocked with annotations, nothing applied', async () => {
    write('a.ts', 'const a = 1;\n');
    const outcome = await reviewGatedWrite(
      { changes: [{ path: 'a.ts', newContent: 'const k = "AKIAABCDEFGHIJKLMNOP";\n' }], cwd: workDir, intent: 'sneak' },
      { mode: 'static' },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/REJECTED/);
    expect(outcome.summary).toMatch(/\[blocker\] a\.ts/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });

  it('full mode: an annotate verdict comes back as actionable revision guidance', async () => {
    write('a.ts', 'const a = 1;\n');
    const client: CouncilChatClient = {
      async chat() {
        return {
          content:
            '{"decision":"annotate","annotations":[{"path":"a.ts","line":1,"severity":"warning","message":"add a unit test for the new value","suggestedFix":"expect(a).toBe(2)"}],"why":"revise"}',
          promptTokens: 1,
          totalTokens: 2,
        };
      },
    };

    const outcome = await reviewGatedWrite(
      { changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }], cwd: workDir, intent: 'bump a' },
      { mode: 'full', client },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/requests changes/);
    expect(outcome.summary).toMatch(/\[warning\] a\.ts:1 — add a unit test/);
    expect(outcome.summary).toMatch(/fix: expect\(a\)\.toBe\(2\)/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });

  it('full mode with client=null fails CLOSED with a retry hint', async () => {
    write('a.ts', 'const a = 1;\n');
    const outcome = await reviewGatedWrite(
      { changes: [{ path: 'a.ts', newContent: 'const a = 2;\n' }], cwd: workDir, intent: 'bump a' },
      { mode: 'full', client: null },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toMatch(/review UNAVAILABLE/);
    expect(outcome.summary).toMatch(/CODEBUDDY_DIFF_REVIEW=static/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });
});

describe('ApplyPatchTool — gated behind CODEBUDDY_DIFF_REVIEW', () => {
  it('off (default): legacy path, no review artifacts', async () => {
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    write('a.ts', 'const a = 1;\n');
    process.chdir(workDir);

    const result = await new ApplyPatchTool().execute({ patch: UPDATE_PATCH });

    expect(result.success).toBe(true);
    expect(read('a.ts')).toBe('const a = 2;\n');
    expect(fs.existsSync(path.join(workDir, '.codebuddy'))).toBe(false);
  });

  it('static: applies through the gate and journals', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'const a = 1;\n');
    process.chdir(workDir);

    const result = await new ApplyPatchTool().execute({ patch: UPDATE_PATCH, intent: 'bump a' });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/review accepted/);
    expect(read('a.ts')).toBe('const a = 2;\n');
    const ledger = JSON.parse(read('.codebuddy/diff-reviews.jsonl').trim());
    expect(ledger.intent).toBe('bump a');
    expect(ledger.origin.label).toBe('apply_patch');
    expect(ledger.applied).toBe(true);
  });

  it('static: a blocked patch returns the annotations as the tool error', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'const a = 1;\n');
    process.chdir(workDir);
    const secretPatch = [
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      '-const a = 1;',
      '+const k = "AKIAABCDEFGHIJKLMNOP";',
      '*** End Patch',
    ].join('\n');

    const result = await new ApplyPatchTool().execute({ patch: secretPatch });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/REJECTED/);
    expect(result.error).toMatch(/AWS access key/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });

  it('static: an unresolvable patch fails closed before any review', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'totally different\n');
    process.chdir(workDir);

    const result = await new ApplyPatchTool().execute({ patch: UPDATE_PATCH });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not resolve/);
    expect(read('a.ts')).toBe('totally different\n');
  });
});

describe('TextEditorTool.create — gated behind CODEBUDDY_DIFF_REVIEW (create_file + write_file alias)', () => {
  function editor(): TextEditorTool {
    // Relative paths resolve against process.cwd() (basicResolvePath), the
    // base directory is the isolation boundary — align both on workDir.
    process.chdir(workDir);
    const tool = new TextEditorTool();
    tool.setBaseDirectory(workDir);
    return tool;
  }

  it('off (default): legacy path, no review artifacts', async () => {
    delete process.env.CODEBUDDY_DIFF_REVIEW;

    const result = await editor().create('fresh.ts', 'export const a = 1;\n');

    expect(result.success).toBe(true);
    expect(read('fresh.ts')).toBe('export const a = 1;\n');
    expect(fs.existsSync(path.join(workDir, '.codebuddy'))).toBe(false);
  });

  it('static: a clean creation is reviewed, applied and journaled', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';

    const result = await editor().create('src/fresh.ts', 'export const a = 1;\n');

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/review accepted/);
    expect(read('src/fresh.ts')).toBe('export const a = 1;\n');
    const ledger = JSON.parse(read('.codebuddy/diff-reviews.jsonl').trim());
    expect(ledger.origin.label).toBe('create_file');
    expect(ledger.intent).toBe('create src/fresh.ts');
    expect(ledger.applied).toBe(true);
  });

  it('static: a creation smuggling a secret is blocked with the annotations', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';

    const result = await editor().create('cfg.ts', 'export const key = "AKIAABCDEFGHIJKLMNOP";\n');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/REJECTED/);
    expect(result.error).toMatch(/AWS access key/);
    expect(fs.existsSync(path.join(workDir, 'cfg.ts'))).toBe(false);
  });

  it('full mode with an injected-free environment fails closed rather than writing unreviewed', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    // Escape attempt: absolute path outside the base directory.
    const outside = path.join(os.tmpdir(), `write-gate-escape-${Date.now()}.ts`);

    const result = await editor().create(outside, 'export const a = 1;\n');

    expect(result.success).toBe(false);
    expect(fs.existsSync(outside)).toBe(false);
  });
});

describe('TextEditorTool.strReplace — gated behind CODEBUDDY_DIFF_REVIEW', () => {
  function editor(): TextEditorTool {
    process.chdir(workDir);
    const tool = new TextEditorTool();
    tool.setBaseDirectory(workDir);
    return tool;
  }

  it('off (default): legacy path, no review artifacts', async () => {
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    write('a.ts', 'const a = 1;\n');

    const result = await editor().strReplace('a.ts', 'const a = 1;', 'const a = 2;');

    expect(result.success).toBe(true);
    expect(read('a.ts')).toBe('const a = 2;\n');
    expect(fs.existsSync(path.join(workDir, '.codebuddy'))).toBe(false);
  });

  it('static: the resolved full content is reviewed, applied and journaled', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'const a = 1;\nconst keep = true;\n');

    const result = await editor().strReplace('a.ts', 'const a = 1;', 'const a = 2;');

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/review accepted/);
    expect(read('a.ts')).toBe('const a = 2;\nconst keep = true;\n');
    const ledger = JSON.parse(read('.codebuddy/diff-reviews.jsonl').trim());
    expect(ledger.origin.label).toBe('str_replace');
    expect(ledger.applied).toBe(true);
  });

  it('static: a replacement smuggling a secret is blocked, file untouched', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'const a = 1;\n');

    const result = await editor().strReplace('a.ts', 'const a = 1;', 'const k = "AKIAABCDEFGHIJKLMNOP";');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/REJECTED/);
    expect(result.error).toMatch(/AWS access key/);
    expect(read('a.ts')).toBe('const a = 1;\n');
  });
});

describe('MultiEditTool — gated behind CODEBUDDY_DIFF_REVIEW', () => {
  function multiEditor(): MultiEditTool {
    process.chdir(workDir);
    const tool = new MultiEditTool();
    tool.setBaseDirectory(workDir);
    return tool;
  }

  it('off (default): legacy path, no review artifacts', async () => {
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    write('a.ts', 'const a = 1;\nconst b = 1;\n');

    const result = await multiEditor().execute('a.ts', [
      { old_string: 'const a = 1;', new_string: 'const a = 2;' },
      { old_string: 'const b = 1;', new_string: 'const b = 2;' },
    ]);

    expect(result.success).toBe(true);
    expect(read('a.ts')).toBe('const a = 2;\nconst b = 2;\n');
    expect(fs.existsSync(path.join(workDir, '.codebuddy'))).toBe(false);
  });

  it('static: the atomically resolved content is reviewed, applied and journaled', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'const a = 1;\nconst b = 1;\n');

    const result = await multiEditor().execute('a.ts', [
      { old_string: 'const a = 1;', new_string: 'const a = 2;' },
      { old_string: 'const b = 1;', new_string: 'const b = 2;' },
    ]);

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/review accepted/);
    expect(read('a.ts')).toBe('const a = 2;\nconst b = 2;\n');
    const ledger = JSON.parse(read('.codebuddy/diff-reviews.jsonl').trim());
    expect(ledger.origin.label).toBe('multi_edit');
    expect(ledger.intent).toBe('multi_edit (2 edits) on a.ts');
    expect(ledger.applied).toBe(true);
  });

  it('static: one edit smuggling a secret blocks the WHOLE batch (atomicity preserved)', async () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
    write('a.ts', 'const a = 1;\nconst b = 1;\n');

    const result = await multiEditor().execute('a.ts', [
      { old_string: 'const a = 1;', new_string: 'const a = 2;' },
      { old_string: 'const b = 1;', new_string: 'const k = "AKIAABCDEFGHIJKLMNOP";' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/REJECTED/);
    expect(read('a.ts')).toBe('const a = 1;\nconst b = 1;\n'); // neither edit landed
  });
});
