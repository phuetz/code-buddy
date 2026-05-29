/**
 * Regression guard for the fs-extra ESM default-import bug (smoke-test finding F6, 2026-05-29).
 *
 * `import * as fs from 'fs-extra'` only exposes fs-extra's own helpers (pathExists/ensureDir)
 * under ESM — Node's CJS lexer does not surface the node-fs methods (existsSync, writeFile,
 * readFile, ...), so they are `undefined` on the namespace and throw at runtime. This silently
 * broke workspace semantic indexing, /plan persistence, and submit_plan, while unit tests passed
 * because they MOCK fs-extra. The fix is the default import (`import fs from 'fs-extra'`).
 *
 * This file deliberately does NOT mock fs-extra so it exercises the real module.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { SubmitPlanTool } from '../../src/tools/submit-plan-tool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

describe('fs-extra default-import contract (regression F6)', () => {
  it('default import exposes the node-fs methods our code relies on', () => {
    // If fs-extra ever changes its export shape, this trips before the features silently break.
    for (const method of [
      'existsSync',
      'writeFileSync',
      'readFileSync',
      'writeFile',
      'readFile',
      'appendFile',
      'pathExists',
      'ensureDir',
    ]) {
      expect(typeof (fs as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('the three affected source files use the default import, not `import * as fs`', () => {
    const files = [
      'src/knowledge/workspace-indexer.ts',
      'src/tools/plan-tool.ts',
      'src/tools/submit-plan-tool.ts',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
      expect(src, `${rel} must NOT use a namespace import for fs-extra`).not.toMatch(
        /import \* as \w+ from ['"]fs-extra['"]/,
      );
      expect(src, `${rel} must use the default import for fs-extra`).toMatch(
        /import \w+ from ['"]fs-extra['"]/,
      );
    }
  });
});

describe('submit_plan persists the plan file at runtime (regression F6)', () => {
  let tmpDir: string;
  let prevCwd: string;

  beforeEach(async () => {
    prevCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-submitplan-'));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await fs.remove(tmpDir).catch(() => {});
  });

  it('writes .codebuddy/plans/current.md (would be undefined-throw under the old namespace import)', async () => {
    const tool = new SubmitPlanTool();
    const planContent = '# Test plan\n\n- step one\n- step two\n';

    const result = await tool.execute({ plan_content: planContent });

    // The tool swallows write errors and still returns success, so the real proof is the FILE.
    const planPath = path.join(tmpDir, '.codebuddy', 'plans', 'current.md');
    expect(await fs.pathExists(planPath)).toBe(true);
    expect(await fs.readFile(planPath, 'utf-8')).toBe(planContent);
    expect(result.success).toBe(true);
  });
});
