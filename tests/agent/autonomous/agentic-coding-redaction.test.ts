/**
 * Gate test for the agentic-coding secret-redaction fs.writeFile monkey-patch.
 *
 * The runner installs a global patch on `fs.writeFile` (node:fs/promises DEFAULT
 * export) that redacts secrets on string writes, EXCEPT while declared edits are
 * being applied (the `isApplyingEdits` flag). This test pins BOTH behaviours so
 * the cluster can be safely extracted out of the 8.4K-LOC runner (Phase 2.1
 * cycle 3) without a silent security regression.
 *
 * IMPORTANT: this file imports `fs` as the DEFAULT export — the patch mutates the
 * default export object, so a namespace import (`import * as fs`) would bypass it
 * and the test would not observe the redaction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// Importing the runner installs the global fs.writeFile redaction patch at module load.
import { applyDeclaredEdits } from '../../../src/agent/autonomous/agentic-coding-runner.js';

const execFileAsync = promisify(execFile);
const SECRET = 'sk-1234567890abcdef1234567890abcdef';

describe('agentic-coding fs.writeFile secret-redaction patch (cycle-3 extraction gate)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-redact-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('auto-redacts secrets on a normal fs.writeFile (outside declared edits)', async () => {
    const file = path.join(tmp, 'out.txt');
    await fs.writeFile(file, `OPENAI_API_KEY=${SECRET}\n`, 'utf8');
    const content = await fs.readFile(file, 'utf8');
    expect(content).not.toContain(SECRET);
    expect(content).toContain('[REDACTED');
  });

  it('does NOT redact while applyDeclaredEdits runs (isApplyingEdits gate)', async () => {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: repo });

    const rel = 'file.txt';
    // Seed marker has no secret, so the patch leaves it untouched.
    await fs.writeFile(path.join(repo, rel), 'PLACEHOLDER', 'utf8');

    const contract = {
      repo,
      task: 'inject config value',
      allowedPaths: [rel],
      verification: [],
      riskLevel: 'low',
      edits: [{
        type: 'replace_text',
        path: rel,
        find: 'PLACEHOLDER',
        replace: `OPENAI_API_KEY=${SECRET}`,
        expectedOccurrences: 1,
      }],
    } as never;

    const results = await applyDeclaredEdits(contract);
    expect(results[0]?.status).toBe('applied');

    const content = await fs.readFile(path.join(repo, rel), 'utf8');
    // Declared edits are applied verbatim — redaction is intentionally skipped.
    expect(content).toContain(SECRET);
  });
});
