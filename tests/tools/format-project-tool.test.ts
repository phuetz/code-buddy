import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { FormatProjectTool } from '../../src/tools/format-project-tool.js';

describe('FormatProjectTool', () => {
  it('runs project-local prettier check and lists reported files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-project-tool-'));
    const binDir = path.join(root, 'node_modules', '.bin');
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(binDir, 'prettier'), '#!/usr/bin/env node\nconsole.log("Checking formatting...");\nconsole.log("[warn] bad.ts");\nprocess.exit(1);\n', { mode: 0o755 });
    // Windows: the tool looks for the npm-style `.cmd` shim, then runs prettier's JS entry through node.
    await fs.writeFile(path.join(binDir, 'prettier.cmd'), '@echo off\r\necho Checking formatting...\r\necho [warn] bad.ts\r\nexit /b 1\r\n');
    await fs.mkdir(path.join(root, 'node_modules', 'prettier', 'bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), 'console.log("Checking formatting...");\nconsole.log("[warn] bad.ts");\nprocess.exit(1);\n');
    const result = await new FormatProjectTool().execute({ root });
    expect(result.success).toBe(false);
    expect((result.data as { files: string[] }).files).toContain('bad.ts');
  });
});
