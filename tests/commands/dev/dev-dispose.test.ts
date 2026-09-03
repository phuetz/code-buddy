import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { disposePlanResources } from '../../../src/commands/dev/index.js';

describe('dev plan resource disposal', () => {
  it('disposes the agent, skill registry, MCP client and run store', async () => {
    const agent = { dispose: vi.fn() };
    await disposePlanResources(agent as never);
    expect(agent.dispose).toHaveBeenCalledWith({ skipSessionLearning: true });
  });

  it('uses the same cleanup for plan, run and pr', () => {
    const source = readFileSync(new URL('../../../src/commands/dev/index.ts', import.meta.url), 'utf8');
    const runNeedle = source.includes(".command('run [objective]')")
      ? ".command('run [objective]')"
      : ".command('run <objective>')";
    const prNeedle = source.includes(".command('pr [objective]')")
      ? ".command('pr [objective]')"
      : ".command('pr <objective>')";
    const runBlock = source.slice(source.indexOf(runNeedle), source.indexOf(prNeedle));
    const prBlock = source.slice(source.indexOf(prNeedle), source.indexOf(".command('fix-ci')"));
    expect(runBlock).toContain('resolveRunObjective');
    expect(runBlock).toContain('workflowExitCode');
    expect(runBlock).toContain('conventionalCommitNamedFiles');
    expect(runBlock).toContain('buildConventionalCommitMessage');
    expect(runBlock).toContain('disposePlanResources(agent)');
    expect(prBlock).toContain('disposePlanResources(agent)');
  });

  it('uses the same cleanup for fix-ci and explain', () => {
    const source = readFileSync(new URL('../../../src/commands/dev/index.ts', import.meta.url), 'utf8');
    const fixCiBlock = source.slice(source.indexOf(".command('fix-ci')"), source.indexOf(".command('issue"));
    const explainBlock = source.slice(source.indexOf(".command('explain')"));
    expect(fixCiBlock).toContain('disposePlanResources(agent)');
    expect(fixCiBlock).not.toMatch(/agent\.dispose\?\.\(\)/);
    expect(explainBlock).toContain('disposePlanResources(agent)');
    expect(explainBlock).not.toMatch(/agent\.dispose\?\.\(\)/);
  });
});
