import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { LintProjectTool } from '../../src/tools/lint-project-tool.js';

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, { mode: 0o755 });
}

describe('LintProjectTool', () => {
  it('summarizes project-local eslint json output by file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-project-tool-'));
    const binDir = path.join(root, 'node_modules', '.bin');
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(root, 'bad.ts'), 'const x = 1\n');
    const fakeEslint = `console.log(JSON.stringify([{filePath: process.cwd() + '/bad.ts', errorCount: 1, warningCount: 1, messages: [{ruleId: 'semi', severity: 2, line: 1, column: 12, message: 'Missing semicolon.'}, {ruleId: 'no-unused-vars', severity: 1, line: 1, column: 7, message: 'x unused'}]}]));
process.exit(1);
`;
    await writeExecutable(path.join(binDir, 'eslint'), `#!/usr/bin/env node\n${fakeEslint}`);
    // Windows: the tool looks for the npm-style `.cmd` shim, then runs eslint's JS entry through node.
    await fs.writeFile(path.join(binDir, 'eslint.cmd'), '@node "%~dp0..\\eslint\\bin\\eslint.js" %*\r\n');
    await fs.mkdir(path.join(root, 'node_modules', 'eslint', 'bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'), fakeEslint);

    const result = await new LintProjectTool().execute({ root, timeoutMs: 5000 });

    expect(result.success).toBe(false);
    const data = result.data as { errorCount: number; warningCount: number; files: Array<{ filePath: string; errors: number; warnings: number }> };
    expect(data.errorCount).toBe(1);
    expect(data.warningCount).toBe(1);
    expect(data.files[0]).toMatchObject({ filePath: 'bad.ts', errors: 1, warnings: 1 });
  });

  it('no-ops when eslint is absent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-project-tool-missing-'));
    const result = await new LintProjectTool().execute({ root });
    expect(result.success).toBe(true);
    expect((result.data as { missing: boolean }).missing).toBe(true);
  });
});
