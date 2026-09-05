import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
}));

vi.mock('../../src/commands/llm-provider-resolution.js', () => ({
  resolveCommandProvider: () => ({
    apiKey: 'test-key',
    model: 'test-model',
    baseURL: 'http://127.0.0.1:11434/v1',
    providerLabel: 'test-provider',
  }),
}));

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    chat = mocks.chat;
  },
}));

import { createFlowCommand } from '../../src/commands/flow.js';

async function runFlow(): Promise<string[]> {
  const logs: string[] = [];
  const command = createFlowCommand();
  command.exitOverride();
  const logSpy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
    logs.push(String(value ?? ''));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await command.parseAsync(['node', 'flow', 'test goal', '--max-retries', '0']);
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
  return logs;
}

describe('buddy flow exit status', () => {
  beforeEach(() => {
    mocks.chat.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('returns exit code 1 when a planned step fails', async () => {
    mocks.chat
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              steps: [{
                id: 'step_1',
                title: 'Failing step',
                description: 'Fail now',
                dependencies: [],
              }],
            }),
          },
        }],
      })
      .mockRejectedValueOnce(new Error('agent failed'));

    const logs = await runFlow();

    expect(logs.join('\n')).toContain('1 failed');
    expect(process.exitCode).toBe(1);
  });

  it('returns exit code 1 when a step only emits unexecuted tool-call markup', async () => {
    mocks.chat
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              steps: [{
                id: 'step_1',
                title: 'Create file',
                description: 'write title-case.js',
                dependencies: [],
              }],
            }),
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: '<tool_call>\n<function=Bash>\n<parameter=command>\nls\n',
          },
        }],
      });

    const logs = await runFlow();

    expect(logs.join('\n')).toContain('1 failed');
    expect(process.exitCode).toBe(1);
  });

  it('keeps a successful flow at exit code 0', async () => {
    mocks.chat
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              steps: [{
                id: 'step_1',
                title: 'Working step',
                description: 'Complete now',
                dependencies: [],
              }],
            }),
          },
        }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'done' } }] });

    await runFlow();

    expect(process.exitCode).toBeUndefined();
  });
});
