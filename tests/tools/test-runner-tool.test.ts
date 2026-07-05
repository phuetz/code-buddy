import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { TestRunnerTool } from '../../src/tools/test-runner-tool.js';

describe('TestRunnerTool', () => {
  it('runs only the declared npm test script and summarizes output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-runner-tool-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node vitest-sim.js' } }));
    await fs.writeFile(path.join(root, 'vitest-sim.js'), 'console.log("Tests 2 passed");\nconsole.log("Tests 1 failed");\nprocess.exit(1);\n');

    const result = await new TestRunnerTool().execute({ root, timeoutMs: 10_000 });

    expect(result.success).toBe(false);
    const data = result.data as { runner: string; passed: number; failed: number; stdoutTail: string };
    expect(data.runner).toBe('vitest');
    expect(data.passed).toBe(2);
    expect(data.failed).toBe(1);
    expect(data.stdoutTail).toContain('Tests 2 passed');
  });
});
