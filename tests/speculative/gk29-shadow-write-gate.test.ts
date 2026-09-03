import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { maybeReviewGatedWrite } from '../../src/tools/review-gate-helper.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('GK29 shadow write-gate on the real editor path', () => {
  let testRoot: string;
  let repo: string;
  let previousHome: string | undefined;
  let previousShadow: string | undefined;
  let previousCmd: string | undefined;
  let previousReview: string | undefined;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gk29-shadow-gate-'));
    repo = path.join(testRoot, 'toy');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'gk29@example.test');
    git(repo, 'config', 'user.name', 'GK29');
    git(repo, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(repo, 'sum.js'), 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n');
    fs.mkdirSync(path.join(repo, 'tests'));
    fs.writeFileSync(
      path.join(repo, 'tests/sum.test.js'),
      "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { add } = require('../sum.js');\ntest('add', () => { assert.equal(add(1, 2), 3); });\n",
    );
    git(repo, 'add', 'sum.js', 'tests/sum.test.js');
    git(repo, 'commit', '-m', 'initial');

    previousHome = process.env.HOME;
    previousShadow = process.env.CODEBUDDY_SHADOW_WORKSPACE;
    previousCmd = process.env.CODEBUDDY_SHADOW_CMD;
    previousReview = process.env.CODEBUDDY_DIFF_REVIEW;
    process.env.HOME = path.join(testRoot, 'home');
    process.env.CODEBUDDY_SHADOW_WORKSPACE = 'true';
    process.env.CODEBUDDY_SHADOW_CMD = 'node --test tests/sum.test.js';
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
  });

  afterEach(() => {
    ConfirmationService.getInstance().setSessionFlag('fileOperations', false);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousShadow === undefined) delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
    else process.env.CODEBUDDY_SHADOW_WORKSPACE = previousShadow;
    if (previousCmd === undefined) delete process.env.CODEBUDDY_SHADOW_CMD;
    else process.env.CODEBUDDY_SHADOW_CMD = previousCmd;
    if (previousReview === undefined) delete process.env.CODEBUDDY_DIFF_REVIEW;
    else process.env.CODEBUDDY_DIFF_REVIEW = previousReview;
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('rejects a test-breaking edit without touching the real tree, then applies a valid one after ghost validation', async () => {
    const sumPath = path.join(repo, 'sum.js');
    const before = sha256File(sumPath);
    const editor = new TextEditorTool();
    editor.setBaseDirectory(repo);

    const broken = await editor.strReplace(
      sumPath,
      'return a + b;',
      'return a - b;',
    );
    expect(broken.success).toBe(false);
    expect(broken.error).toMatch(/shadow validation failed/i);
    expect(sha256File(sumPath)).toBe(before);
    expect(fs.readFileSync(sumPath, 'utf8')).toContain('return a + b;');

    const ghostGate = await maybeReviewGatedWrite({
      baseDirectory: repo,
      resolvedPath: sumPath,
      displayPath: 'sum.js',
      newContent: 'function add(a, b) { return a + b; }\nfunction identity(x) { return x; }\nmodule.exports = { add, identity };\n',
      intent: 'add identity helper',
      originLabel: 'str_replace',
    });
    expect(ghostGate).toEqual({ gated: false });
    expect(sha256File(sumPath)).toBe(before);

    const applied = await editor.strReplace(
      sumPath,
      'module.exports = { add };',
      'function identity(x) { return x; }\nmodule.exports = { add, identity };',
    );
    expect(applied.success).toBe(true);
    expect(sha256File(sumPath)).not.toBe(before);
    expect(fs.readFileSync(sumPath, 'utf8')).toContain('function identity');
  });

  it('does not load the shadow module when the env var is unset', async () => {
    delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
    const sumPath = path.join(repo, 'sum.js');
    const before = sha256File(sumPath);
    const editor = new TextEditorTool();
    editor.setBaseDirectory(repo);
    const result = await editor.strReplace(sumPath, 'return a + b;', 'return a - b;');
    expect(result.success).toBe(true);
    expect(sha256File(sumPath)).not.toBe(before);
  });
});
