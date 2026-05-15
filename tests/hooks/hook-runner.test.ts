import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HookRunner } from '../../src/hooks/hook-runner.js';
import type { ExtendedHook } from '../../src/hooks/hook-types.js';

describe('HookRunner unsupported handlers', () => {
  let projectRoot: string;
  let runner: HookRunner;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'codebuddy-hook-runner-'));
    runner = new HookRunner(projectRoot);
  });

  afterEach(() => {
    runner.dispose();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reports prompt hooks as failed instead of successful skipped evaluations', async () => {
    runner.addHook({
      event: 'PreToolUse',
      handler: {
        type: 'prompt',
        prompt: 'Only allow read-only commands.',
      },
    } satisfies ExtendedHook);

    const result = await runner.run('PreToolUse', {
      toolName: 'bash',
      toolArgs: { command: 'npm test' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Prompt hook handlers are not wired');
  });

  it('reports agent hooks as failed instead of deferred successful evaluations', async () => {
    runner.addHook({
      event: 'PreToolUse',
      handler: {
        type: 'agent',
        agent: 'security-reviewer',
      },
    } satisfies ExtendedHook);

    const result = await runner.run('PreToolUse', {
      toolName: 'edit',
      toolArgs: { path: 'src/index.ts' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent hook handlers are not wired');
  });
});
