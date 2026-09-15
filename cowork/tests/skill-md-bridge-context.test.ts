import { describe, expect, it, vi } from 'vitest';
const executeSkill = vi.hoisted(() => vi.fn(async (_name, context) => ({ success: true, output: context.request, duration: 0 })));
vi.mock('../src/main/utils/core-loader', () => ({ loadCoreModule: vi.fn(async () => ({ initializeAllSkills: vi.fn(), executeSkill })) }));
vi.mock('../src/main/utils/logger', () => ({ log: vi.fn(), logWarn: vi.fn() }));
import { SkillMdBridge } from '../src/main/skills/skill-md-bridge';
describe('skill execution context crosses the desktop boundary', () => {
  it('maps the user task and workspace to the core contract', async () => {
    const result = await new SkillMdBridge().execute('workspace-organizer', { userInput: 'Inspect files only', workspaceRoot: '/tmp/fixture' });
    expect(result.output).toBe('Inspect files only');
    expect(executeSkill).toHaveBeenLastCalledWith('workspace-organizer', { request: 'Inspect files only', cwd: '/tmp/fixture' });
  });
  it('has meaningful guidance when no task was supplied', async () => {
    const result = await new SkillMdBridge().execute('workspace-organizer', {});
    expect(result.output).toContain('workspace-organizer');
    expect(result.output).not.toContain('undefined');
  });
});
