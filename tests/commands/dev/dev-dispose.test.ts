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
    const runBlock = source.slice(source.indexOf(".command('run <objective>')"), source.indexOf(".command('pr <objective>')"));
    const prBlock = source.slice(source.indexOf(".command('pr <objective>')"), source.indexOf(".command('fix-ci')"));
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
