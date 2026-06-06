import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RememberTool } from '../../src/tools/registry/memory-tools.js';

const mocks = vi.hoisted(() => ({
  remember: vi.fn(),
  executeHermesLifecycleHook: vi.fn(),
}));

vi.mock('../../src/memory/persistent-memory.js', () => ({
  getMemoryManager: () => ({
    remember: mocks.remember,
  }),
}));

vi.mock('../../src/hooks/hermes-lifecycle-hooks.js', () => ({
  executeHermesLifecycleHook: mocks.executeHermesLifecycleHook,
}));

const guardedEnvNames = [
  'CODEBUDDY_SELF_IMPROVEMENT',
  'CODEBUDDY_SELF_IMPROVE',
  'CODEBUDDY_LEARNING_BACKGROUND_REVIEW',
  'CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS',
  'CODEBUDDY_LEARNING_DAEMON',
];

describe('RememberTool automated memory scope guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of guardedEnvNames) {
      delete process.env[name];
    }
    mocks.executeHermesLifecycleHook.mockResolvedValue({ allowed: true });
  });

  it('keeps explicit user-scope writes available outside automated review flows', async () => {
    const tool = new RememberTool();

    const result = await tool.execute({
      key: 'preferred-shell',
      value: 'PowerShell',
      scope: 'user',
      category: 'preferences',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('in user memory');
    expect(mocks.remember).toHaveBeenCalledWith('preferred-shell', 'PowerShell', {
      category: 'preferences',
      scope: 'user',
    });
  });

  it('downgrades self-improvement user-scope writes to project memory', async () => {
    process.env.CODEBUDDY_SELF_IMPROVEMENT = 'true';
    const tool = new RememberTool();

    const result = await tool.execute({
      key: 'review-finding',
      value: 'Prefer proof ledgers before promotion.',
      scope: 'user',
      category: 'patterns',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('in project memory');
    expect(mocks.remember).toHaveBeenCalledWith('review-finding', 'Prefer proof ledgers before promotion.', {
      category: 'patterns',
      scope: 'project',
    });
  });

  it('applies the project guard after lifecycle hook input updates', async () => {
    process.env.CODEBUDDY_LEARNING_BACKGROUND_REVIEW = '1';
    mocks.executeHermesLifecycleHook.mockResolvedValue({
      allowed: true,
      updatedInput: {
        key: 'background-review',
        value: 'Do not promote without tests.',
        scope: 'user',
        category: 'decisions',
      },
    });
    const tool = new RememberTool();

    const result = await tool.execute({
      key: 'original',
      value: 'original',
      scope: 'project',
      category: 'custom',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('in project memory');
    expect(mocks.remember).toHaveBeenCalledWith('background-review', 'Do not promote without tests.', {
      category: 'decisions',
      scope: 'project',
    });
  });
});
