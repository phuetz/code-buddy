import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  GoalCommandRuntimeAgent,
  GoalLoopAgent,
  LOCAL_GOAL_ACTOR_SYSTEM_PROMPT,
  applyGoalCliWorkingDirectory,
  buildLocalGoalActorSystemPrompt,
  parsePositiveIntegerOption,
  resolveLocalGoalActorSystemPrompt,
  resolveGoalCliJudgeModel,
  resolveGoalCliMaxToolRounds,
  resolveGoalCliWorkingDirectory,
  runGoalCommandWithAgent,
  runGoalLoop,
  shouldUseLocalGoalActorPrompt,
  validateGoalCommandNumericOptions,
} from '../../src/commands/goal-cli.js';
import type { ChatEntry } from '../../src/agent/codebuddy-agent.js';
import { getGoalManager, resetGoalManagers } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';

function judgeClient(replies: string[]) {
  const queue = [...replies];
  return {
    chat: vi.fn(async () => ({
      choices: [
        {
          message: { role: 'assistant', content: queue.shift() ?? replies[replies.length - 1] },
          finish_reason: 'stop',
        },
      ],
    })),
  };
}

function fakeAgent(client: ReturnType<typeof judgeClient>, responses: string[]): GoalLoopAgent {
  const queue = [...responses];
  return {
    processUserMessage: vi.fn(async () => [
      {
        type: 'assistant' as const,
        content: queue.shift() ?? 'still working',
        timestamp: new Date(),
      },
    ]),
    getClient: () => client as never,
  };
}

function fakeAgentEntries(client: ReturnType<typeof judgeClient>, responses: ChatEntry[][]): GoalLoopAgent {
  const queue = [...responses];
  return {
    processUserMessage: vi.fn(async () => queue.shift() ?? []),
    getClient: () => client as never,
  };
}

describe('runGoalLoop (buddy goal headless)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-cli-test-'));
    resetGoalManagers(new GoalStore({ storeDir: tmpDir }));
  });

  afterEach(() => {
    resetGoalManagers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loops with continuation prompts until the judge says done', async () => {
    const client = judgeClient([
      '{"done": false, "reason": "tests still failing"}',
      '{"done": true, "reason": "all tests pass"}',
    ]);
    const agent = fakeAgent(client, ['Fixed one test.', 'Fixed the last test. All green.']);
    const messages: string[] = [];

    const result = await runGoalLoop(agent, 'fix the tests', {
      onMessage: text => messages.push(text),
    });

    expect(result.status).toBe('done');
    expect(result.turnsUsed).toBe(2);
    expect(agent.processUserMessage).toHaveBeenCalledTimes(2);
    // Turn 1 = the goal text; turn 2 = the continuation prompt.
    expect(agent.processUserMessage).toHaveBeenNthCalledWith(1, 'fix the tests');
    expect(vi.mocked(agent.processUserMessage).mock.calls[1]![0]).toContain(
      '[Continuing toward your standing goal]'
    );
    expect(messages[0]).toContain('⊙ Goal set');
    expect(messages.some(m => m.startsWith('↻ Continuing toward goal (1/'))).toBe(true);
    expect(messages.at(-1)).toBe('✓ Goal achieved: all tests pass');
  });

  it('stops with paused status when the turn budget is exhausted', async () => {
    const client = judgeClient(['{"done": false, "reason": "not yet"}']);
    const agent = fakeAgent(client, ['progress']);

    const result = await runGoalLoop(agent, 'impossible goal', { maxTurns: 2 });

    expect(result.status).toBe('paused');
    expect(result.turnsUsed).toBe(2);
    expect(result.lastReason).toBe('not yet');
    expect(getGoalManager().state?.pausedReason).toBe('turn budget exhausted (2/2)');
    expect(agent.processUserMessage).toHaveBeenCalledTimes(2);
  });

  it('uses the configured manager default budget when maxTurns is omitted', async () => {
    const previous = process.env.CODEBUDDY_GOAL_MAX_TURNS;
    try {
      process.env.CODEBUDDY_GOAL_MAX_TURNS = '1';
      resetGoalManagers(new GoalStore({ storeDir: tmpDir }));
      const client = judgeClient(['{"done": false, "reason": "not enough proof"}']);
      const agent = fakeAgent(client, ['I inspected the file but did not finish.']);

      const result = await runGoalLoop(agent, 'finish the change');

      expect(result.status).toBe('paused');
      expect(result.turnsUsed).toBe(1);
      expect(getGoalManager().state).toMatchObject({
        maxTurns: 1,
        pausedReason: 'turn budget exhausted (1/1)',
      });
      expect(agent.processUserMessage).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_GOAL_MAX_TURNS;
      else process.env.CODEBUDDY_GOAL_MAX_TURNS = previous;
      resetGoalManagers(new GoalStore({ storeDir: tmpDir }));
    }
  });

  it('rejects invalid programmatic maxTurns instead of falling back to the default', async () => {
    const client = judgeClient(['{"done": false, "reason": "not yet"}']);
    const agent = fakeAgent(client, ['progress']);

    await expect(runGoalLoop(agent, 'goal', { maxTurns: 0 })).rejects.toThrow(
      'maxTurns must be a positive integer'
    );
    expect(agent.processUserMessage).not.toHaveBeenCalled();
  });

  it('never exceeds the iteration backstop even if the loop misbehaves', async () => {
    const client = judgeClient(['{"done": false, "reason": "never"}']);
    const agent = fakeAgent(client, ['progress']);

    const result = await runGoalLoop(agent, 'goal', { maxTurns: 3 });
    expect(vi.mocked(agent.processUserMessage).mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.status).toBe('paused');
  });

  it('includes tool results in the judged turn summary', async () => {
    const client = judgeClient(['{"done": true, "reason": "tool output proves completion"}']);
    const agent = fakeAgentEntries(client, [
      [
        {
          type: 'assistant',
          content: 'I ran the requested command.',
          timestamp: new Date(),
        },
        {
          type: 'tool_result',
          content: 'TOOL_OK',
          timestamp: new Date(),
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'bash',
              arguments: '{"command":"echo TOOL_OK"}',
            },
          },
          toolResult: {
            success: true,
            output: 'TOOL_OK',
          },
        },
      ],
    ]);

    const result = await runGoalLoop(agent, 'run echo TOOL_OK');

    expect(result.status).toBe('done');
    const judgePrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(judgePrompt).toContain('I ran the requested command.');
    expect(judgePrompt).toContain('[tool:bash success]');
    expect(judgePrompt).toContain('TOOL_OK');
  });

  it('judges cumulative tool evidence across continuation turns', async () => {
    const client = {
      chat: vi.fn(async (messages: Array<{ content?: unknown }>) => {
        const prompt = String(messages[1]?.content ?? '');
        const done = prompt.includes('PHASE1_OK') && prompt.includes('PHASE2_OK');
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: done
                  ? '{"done": true, "reason": "both phase proofs are present"}'
                  : '{"done": false, "reason": "phase2 proof is missing"}',
              },
              finish_reason: 'stop',
            },
          ],
        };
      }),
    };
    const agent = fakeAgentEntries(client, [
      [
        {
          type: 'tool_result',
          content: 'PHASE1_OK',
          timestamp: new Date(),
          toolCall: {
            id: 'call_phase1',
            type: 'function',
            function: { name: 'view_file', arguments: '{"path":"phase1.txt"}' },
          },
          toolResult: { success: true, output: 'PHASE1_OK' },
        },
      ],
      [
        {
          type: 'tool_result',
          content: 'PHASE2_OK',
          timestamp: new Date(),
          toolCall: {
            id: 'call_phase2',
            type: 'function',
            function: { name: 'view_file', arguments: '{"path":"phase2.txt"}' },
          },
          toolResult: { success: true, output: 'PHASE2_OK' },
        },
      ],
    ]);

    const result = await runGoalLoop(agent, 'verify phase1 and phase2 across turns', {
      maxTurns: 3,
    });

    expect(result.status).toBe('done');
    expect(client.chat).toHaveBeenCalledTimes(2);
    const firstJudgePrompt = client.chat.mock.calls[0]![0][1].content as string;
    const secondJudgePrompt = client.chat.mock.calls[1]![0][1].content as string;
    expect(firstJudgePrompt).toContain('[Goal turn 1]');
    expect(firstJudgePrompt).toContain('PHASE1_OK');
    expect(firstJudgePrompt).not.toContain('PHASE2_OK');
    expect(secondJudgePrompt).toContain('[Goal turn 1]');
    expect(secondJudgePrompt).toContain('PHASE1_OK');
    expect(secondJudgePrompt).toContain('[Goal turn 2]');
    expect(secondJudgePrompt).toContain('PHASE2_OK');
  });

  it('marks assistant-only turns as having no tool evidence for the judge', async () => {
    const client = judgeClient(['{"done": false, "reason": "no concrete evidence"}']);
    const agent = fakeAgent(client, ['I created the requested file.']);

    await runGoalLoop(agent, 'create a file named proof.txt', { maxTurns: 1 });

    const judgePrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(judgePrompt).toContain('[tool evidence: none]');
    expect(judgePrompt).toContain('I created the requested file.');
  });

  it('pauses instead of leaving an active goal when a headless turn has no judgeable response', async () => {
    const client = judgeClient(['{"done": true, "reason": "should not judge"}']);
    const agent = fakeAgentEntries(client, [[]]);
    const messages: string[] = [];

    const result = await runGoalLoop(agent, 'produce output', {
      onMessage: text => messages.push(text),
    });

    expect(result.status).toBe('paused');
    expect(result.turnsUsed).toBe(0);
    expect(result.lastReason).toBeUndefined();
    expect(client.chat).not.toHaveBeenCalled();
    expect(messages.at(-1)).toBe('⏸ Goal paused — the agent produced no judgeable response.');
  });

  it('can use a standalone judge client instead of the agent client', async () => {
    const agentClient = judgeClient(['{"done": false, "reason": "agent client should not judge"}']);
    const standaloneJudgeClient = judgeClient(['{"done": true, "reason": "standalone judge accepted it"}']);
    const agent = fakeAgent(agentClient, ['Done. Verification passed.']);

    const result = await runGoalLoop(agent, 'verify with a standalone judge', {
      judgeClient: standaloneJudgeClient as never,
    });

    expect(result.status).toBe('done');
    expect(standaloneJudgeClient.chat).toHaveBeenCalledTimes(1);
    expect(agentClient.chat).not.toHaveBeenCalled();
  });
});

describe('runGoalCommandWithAgent lifecycle', () => {
  it('disposes the runtime agent when the goal loop throws', async () => {
    const client = judgeClient(['{"done": false, "reason": "unused"}']);
    const dispose = vi.fn();
    const agent: GoalCommandRuntimeAgent = {
      processUserMessage: vi.fn(),
      getClient: () => client as never,
      systemPromptReady: Promise.resolve(),
      dispose,
    };
    const runLoop = vi.fn(async () => {
      throw new Error('loop failed');
    });

    await expect(
      runGoalCommandWithAgent(agent, 'goal', {
        provider: { apiKey: 'key', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.5' },
        createJudgeClient: vi.fn(async () => undefined),
        runLoop,
      })
    ).rejects.toThrow('loop failed');

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('applies the compact local goal prompt for Ollama actors', async () => {
    const client = judgeClient(['{"done": false, "reason": "unused"}']);
    const setSystemPrompt = vi.fn();
    const agent: GoalCommandRuntimeAgent = {
      processUserMessage: vi.fn(),
      getClient: () => client as never,
      systemPromptReady: Promise.resolve(),
      setSystemPrompt,
    };
    const runLoop = vi.fn(async () => ({ status: 'done' as const, turnsUsed: 1 }));

    await runGoalCommandWithAgent(agent, 'goal', {
      provider: {
        apiKey: 'ollama',
        baseURL: 'http://localhost:11434/v1',
        providerLabel: 'ollama',
      },
      workingDirectory: '/tmp/local-goal-project',
      createJudgeClient: vi.fn(async () => undefined),
      runLoop,
    });

    expect(setSystemPrompt).toHaveBeenCalledWith(
      buildLocalGoalActorSystemPrompt('/tmp/local-goal-project')
    );
    expect(runLoop).toHaveBeenCalledTimes(1);
  });
});

describe('local goal actor prompt routing', () => {
  it('detects Ollama providers without matching ChatGPT providers', () => {
    expect(
      shouldUseLocalGoalActorPrompt({
        apiKey: 'ollama',
        baseURL: 'http://localhost:11434/v1',
        providerLabel: 'ollama',
      })
    ).toBe(true);
    expect(
      shouldUseLocalGoalActorPrompt({
        apiKey: 'oauth-chatgpt',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        providerLabel: 'chatgpt',
      })
    ).toBe(false);
  });

  it('returns a compact initial prompt only for local goal actors', () => {
    expect(
      resolveLocalGoalActorSystemPrompt({
        apiKey: 'ollama',
        baseURL: 'http://localhost:11434/v1',
        providerLabel: 'ollama',
      }, '/tmp/project')
    ).toBe(buildLocalGoalActorSystemPrompt('/tmp/project'));

    expect(
      resolveLocalGoalActorSystemPrompt({
        apiKey: 'oauth-chatgpt',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        providerLabel: 'chatgpt',
      })
    ).toBeUndefined();
  });

  it('tells local goal actors the real cwd and not to invent container paths', () => {
    const prompt = buildLocalGoalActorSystemPrompt('/tmp/project');

    expect(prompt).toContain(LOCAL_GOAL_ACTOR_SYSTEM_PROMPT);
    expect(prompt).toContain('Current project directory: /tmp/project');
    expect(prompt).toContain('Do not invent container paths such as /workspace');
    expect(prompt).toContain('root paths such as /src');
  });
});

describe('goal CLI judge model resolution', () => {
  const savedJudgeModel = process.env.CODEBUDDY_GOAL_JUDGE_MODEL;

  afterEach(() => {
    if (savedJudgeModel === undefined) delete process.env.CODEBUDDY_GOAL_JUDGE_MODEL;
    else process.env.CODEBUDDY_GOAL_JUDGE_MODEL = savedJudgeModel;
  });

  it('uses the explicit --judge-model value first', () => {
    process.env.CODEBUDDY_GOAL_JUDGE_MODEL = 'gpt-5.5';

    expect(resolveGoalCliJudgeModel('qwen3:8b')).toBe('qwen3:8b');
  });

  it('falls back to CODEBUDDY_GOAL_JUDGE_MODEL when --judge-model is omitted', () => {
    process.env.CODEBUDDY_GOAL_JUDGE_MODEL = 'gpt-5.5';

    expect(resolveGoalCliJudgeModel(undefined)).toBe('gpt-5.5');
  });
});

describe('goal CLI numeric option parsing', () => {
  it('accepts positive integers', () => {
    expect(parsePositiveIntegerOption('3', '--max-turns')).toBe(3);
  });

  it('rejects zero, negatives, decimals, and non-numbers', () => {
    expect(() => parsePositiveIntegerOption('0', '--max-turns')).toThrow(
      '--max-turns must be a positive integer'
    );
    expect(() => parsePositiveIntegerOption('-1', '--max-turns')).toThrow(
      '--max-turns must be a positive integer'
    );
    expect(() => parsePositiveIntegerOption('1.5', '--max-turns')).toThrow(
      '--max-turns must be a positive integer'
    );
    expect(() => parsePositiveIntegerOption('abc', '--max-tool-rounds')).toThrow(
      '--max-tool-rounds must be a positive integer'
    );
    expect(() => parsePositiveIntegerOption('1e3', '--max-turns')).toThrow(
      '--max-turns must be a positive integer'
    );
    expect(() => parsePositiveIntegerOption('0x10', '--max-tool-rounds')).toThrow(
      '--max-tool-rounds must be a positive integer'
    );
    expect(() => parsePositiveIntegerOption('9007199254740992', '--max-turns')).toThrow(
      '--max-turns must be a positive integer'
    );
  });

  it('validates raw argv before the lazy goal command can swallow unknown options', () => {
    expect(() =>
      validateGoalCommandNumericOptions(['node', 'buddy', 'goal', 'x', '--max-tool-rounds', 'abc'])
    ).toThrow('--max-tool-rounds must be a positive integer');
    expect(() =>
      validateGoalCommandNumericOptions(['node', 'buddy', 'goal', '--max-turns=-1', 'x'])
    ).toThrow('--max-turns must be a positive integer');
    expect(() =>
      validateGoalCommandNumericOptions(['node', 'buddy', 'goal', '--max-turns', '2', 'x'])
    ).not.toThrow();
  });
});

describe('goal CLI max tool rounds resolution', () => {
  function fakeCommand(
    commandSource: string | undefined,
    parentSource: string | undefined,
    parentValue: unknown
  ) {
    return {
      getOptionValueSource: vi.fn(() => commandSource),
      parent: {
        getOptionValueSource: vi.fn(() => parentSource),
      },
      optsWithGlobals: vi.fn(() => ({ maxToolRounds: parentValue })),
    } as never;
  }

  it('uses the command option when the real goal command parsed it', () => {
    expect(resolveGoalCliMaxToolRounds(7, fakeCommand('cli', 'default', '400'))).toBe(7);
  });

  it('uses the global value when the lazy parent command consumed --max-tool-rounds', () => {
    expect(resolveGoalCliMaxToolRounds(50, fakeCommand('default', 'cli', '5'))).toBe(5);
  });

  it('keeps the goal default when neither command nor parent option was explicit', () => {
    expect(resolveGoalCliMaxToolRounds(50, fakeCommand('default', 'default', '400'))).toBe(50);
  });
});

describe('goal CLI working directory handling', () => {
  const originalCwd = process.cwd();
  let tmpDirs: string[] = [];

  function fakeDirectoryCommand(directory: unknown) {
    return {
      optsWithGlobals: vi.fn(() => ({ directory })),
    } as never;
  }

  beforeEach(() => {
    process.chdir(originalCwd);
    tmpDirs = [];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  it('resolves the global --directory option against the current launch cwd', () => {
    const parent = makeTmpDir('goal-cli-directory-parent-');
    const target = path.join(parent, 'target');
    fs.mkdirSync(target);
    process.chdir(parent);

    // Resolved against process.cwd(), which is canonical after chdir through a
    // symlinked tmpdir (macOS /var → /private/var).
    expect(resolveGoalCliWorkingDirectory(fakeDirectoryCommand('target'))).toBe(fs.realpathSync(target));
  });

  it('applies the global --directory option before the headless goal run starts', () => {
    const target = makeTmpDir('goal-cli-directory-target-');

    const cwd = applyGoalCliWorkingDirectory(fakeDirectoryCommand(target));

    // process.cwd() reports the canonical path after chdir (symlinked tmpdir on macOS).
    expect(cwd).toBe(fs.realpathSync(target));
    expect(process.cwd()).toBe(fs.realpathSync(target));
  });

  it('leaves cwd unchanged when no directory option is available', () => {
    const cwd = applyGoalCliWorkingDirectory(fakeDirectoryCommand(undefined));

    expect(cwd).toBe(originalCwd);
    expect(process.cwd()).toBe(originalCwd);
  });
});
