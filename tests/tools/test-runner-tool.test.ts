import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { TestRunnerTool } from '../../src/tools/test-runner-tool.js';

describe('TestRunnerTool', () => {
  let homeDir: string;
  let originalHome: string | undefined;
  let originalCodebuddyHome: string | undefined;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'home-'));
    originalHome = process.env.HOME;
    originalCodebuddyHome = process.env.CODEBUDDY_HOME;
    process.env.HOME = homeDir;
    process.env.CODEBUDDY_HOME = path.join(homeDir, '.codebuddy');
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalCodebuddyHome !== undefined) process.env.CODEBUDDY_HOME = originalCodebuddyHome;
    else delete process.env.CODEBUDDY_HOME;
    await fs.rm(homeDir, { recursive: true, force: true });
  });

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

  it.each(['tap', 'spec'])('counts real Node %s results instead of declaring zero tests', async (reporter) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-runner-tap-'));
    try {
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: `node --test --test-reporter=${reporter} cases.mjs` } }));
      await fs.writeFile(path.join(root, 'cases.mjs'), [
        "import { test } from 'node:test';",
        "import { strict as assert } from 'node:assert';",
        "test('known sum', () => assert.equal(2 + 3, 5));",
        "test('known failure', () => assert.equal(2 + 3, 6));",
      ].join('\n'));

      const result = await new TestRunnerTool().execute({ root, timeoutMs: 10_000 });

      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({ runner: 'node', passed: 1, failed: 1, exitCode: 1, timedOut: false });
      expect((result.data as { stdoutTail: string }).stdoutTail).toContain(`${reporter === 'tap' ? '#' : 'ℹ'} pass 1`);
      expect((result.data as { stdoutTail: string }).stdoutTail).toContain(`${reporter === 'tap' ? '#' : 'ℹ'} fail 1`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
