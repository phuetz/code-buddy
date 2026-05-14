/**
 * Tests for the A2A inbound TaskExecutor (Code Buddy implementation).
 *
 * Verifies the bounded-loop semantics, fleetSafe enforcement, cost cap,
 * and audit logging of `createCodeBuddyTaskExecutor()`. Does NOT exercise
 * Express routing — that's covered by `a2a-protocol.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock factories are hoisted above imports — variables they reference
// must be declared via vi.hoisted (audit pattern, see MEMORY.md).
const mocks = vi.hoisted(() => ({
  chatMock: vi.fn(),
  formalExecuteMock: vi.fn(),
  fleetSafeListMock: vi.fn(),
  isFleetSafeMock: vi.fn(),
  detectProviderMock: vi.fn(),
  clientConstructorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('../../src/codebuddy/client.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/codebuddy/client.js')>(
    '../../src/codebuddy/client.js'
  );
  // Use a real class so `new CodeBuddyClient(...)` in the executor works.
  // vi.fn().mockImplementation(...) doesn't always behave correctly with `new`.
  class MockCodeBuddyClient {
    constructor(apiKey: string, model?: string, baseURL?: string) {
      mocks.clientConstructorMock(apiKey, model, baseURL);
    }

    chat = mocks.chatMock;
  }
  return {
    ...actual,
    CodeBuddyClient: MockCodeBuddyClient,
  };
});

vi.mock('../../src/tools/registry/tool-registry.js', () => ({
  getFormalToolRegistry: () => ({ execute: mocks.formalExecuteMock }),
}));

vi.mock('../../src/tools/registry.js', () => ({
  getToolRegistry: () => ({
    getFleetSafeTools: mocks.fleetSafeListMock,
    isFleetSafe: mocks.isFleetSafeMock,
  }),
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: mocks.detectProviderMock,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: mocks.loggerInfoMock,
    warn: mocks.loggerWarnMock,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  chatMock,
  formalExecuteMock,
  fleetSafeListMock,
  isFleetSafeMock,
  detectProviderMock,
  clientConstructorMock,
  loggerInfoMock,
  loggerWarnMock,
} = mocks;

import { createCodeBuddyTaskExecutor } from '../../src/protocols/a2a/codebuddy-executor.js';
import { TaskStatus, type Task } from '../../src/protocols/a2a/index.js';

function makeTask(text: string, metadata?: Record<string, string>): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: 'sess-1',
    status: { status: TaskStatus.SUBMITTED, timestamp: Date.now() },
    messages: [{ role: 'user', parts: [{ type: 'text', text }] }],
    artifacts: [],
    metadata,
    history: [{ status: TaskStatus.SUBMITTED, timestamp: Date.now() }],
  };
}

const SAFE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'view_file',
    description: 'view a file',
    parameters: { type: 'object' as const, properties: {}, required: [] },
  },
};

describe('A2A inbound TaskExecutor', () => {
  beforeEach(() => {
    chatMock.mockReset();
    formalExecuteMock.mockReset();
    fleetSafeListMock.mockReset();
    isFleetSafeMock.mockReset();
    detectProviderMock.mockReset();
    clientConstructorMock.mockReset();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();

    // Default: provider auto-detect succeeds, fleet list non-empty.
    detectProviderMock.mockReturnValue({
      provider: 'grok',
      apiKey: 'test-key',
      baseURL: 'https://api.x.ai/v1',
      defaultModel: 'grok-3-latest',
    });
    fleetSafeListMock.mockReturnValue([SAFE_TOOL]);
    isFleetSafeMock.mockImplementation((name: string) => name === 'view_file');
  });

  afterEach(() => {
    delete process.env.GROK_API_KEY;
  });

  it('happy path: LLM returns final answer in one turn', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: { role: 'assistant', content: 'Hello peer', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const executor = createCodeBuddyTaskExecutor();
    const task = await executor(makeTask('say hi'));

    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    const reply = task.messages.find((m) => m.role === 'agent');
    expect(reply).toBeDefined();
    expect((reply!.parts[0] as { text: string }).text).toBe('Hello peer');
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(clientConstructorMock).toHaveBeenCalledWith(
      'test-key',
      'grok-3-latest',
      'https://api.x.ai/v1',
    );
    // Fleet-safe tool list was passed to the LLM.
    expect(chatMock.mock.calls[0]?.[1]).toEqual([SAFE_TOOL]);
  });

  it('uses ChatGPT Codex OAuth when provider auto-detection resolves chatgpt', async () => {
    detectProviderMock.mockReturnValueOnce({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: { role: 'assistant', content: 'Bonjour peer', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const executor = createCodeBuddyTaskExecutor();
    const task = await executor(makeTask('dis bonjour'));

    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    expect(clientConstructorMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'gpt-5.5',
      'https://chatgpt.com/backend-api/codex',
    );
  });

  it('tool dispatch: LLM requests tool, executor runs it and feeds result back', async () => {
    chatMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'view_file', arguments: '{"path":"foo.txt"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Here is the content of foo.txt',
              tool_calls: undefined,
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
      });

    formalExecuteMock.mockResolvedValueOnce({
      success: true,
      output: 'hello world',
      toolName: 'view_file',
      duration: 1,
      timestamp: new Date(),
    });

    const executor = createCodeBuddyTaskExecutor();
    const task = await executor(makeTask('show me foo.txt'));

    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    expect(formalExecuteMock).toHaveBeenCalledWith('view_file', { path: 'foo.txt' });
    const reply = task.messages.find((m) => m.role === 'agent');
    expect((reply!.parts[0] as { text: string }).text).toBe(
      'Here is the content of foo.txt'
    );
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('fleet-safe defense in depth: hallucinated tool name is rejected even if LLM tries it', async () => {
    chatMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'bash', arguments: '{"command":"rm -rf /"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: { role: 'assistant', content: 'I cannot run shell commands', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
      });

    // bash is NOT fleet-safe by our mock (only view_file is).
    const executor = createCodeBuddyTaskExecutor();
    const task = await executor(makeTask('run rm -rf /'));

    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    // formalExecute MUST NOT have been called for the rejected tool.
    expect(formalExecuteMock).not.toHaveBeenCalled();
  });

  it('turn cap: 3 turns max even if LLM keeps requesting tools', async () => {
    const wantTools = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-x',
                type: 'function',
                function: { name: 'view_file', arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    };
    chatMock
      .mockResolvedValueOnce(wantTools)
      .mockResolvedValueOnce(wantTools)
      .mockResolvedValueOnce(wantTools)
      .mockResolvedValueOnce(wantTools); // 4th call should never happen

    formalExecuteMock.mockResolvedValue({
      success: true,
      output: 'data',
      toolName: 'view_file',
      duration: 1,
      timestamp: new Date(),
    });

    const executor = createCodeBuddyTaskExecutor();
    const task = await executor(makeTask('loop forever'));

    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    expect(task.status.message).toMatch(/cap warning/i);
    expect(chatMock).toHaveBeenCalledTimes(3);
  });

  it('cost cap: aborts when cumulative tokens exceed 100k', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: { role: 'assistant', content: 'partial answer', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 80_000, completion_tokens: 30_000, total_tokens: 110_000 },
    });

    const executor = createCodeBuddyTaskExecutor();
    const task = await executor(makeTask('expensive question'));

    expect(task.status.status).toBe(TaskStatus.COMPLETED);
    expect(task.status.message).toMatch(/cap warning/i);
  });

  it('fails closed: empty fleet-safe list rejects task with explicit error', async () => {
    fleetSafeListMock.mockReturnValueOnce([]);

    const executor = createCodeBuddyTaskExecutor();
    const task = await executor(makeTask('any task'));

    expect(task.status.status).toBe(TaskStatus.FAILED);
    expect(task.status.message).toMatch(/no fleet-safe tools/i);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('fails closed: missing provider credentials rejects task before LLM call', async () => {
    detectProviderMock.mockReturnValueOnce(null);

    const executor = createCodeBuddyTaskExecutor();
    const task = await executor(makeTask('any task'));

    expect(task.status.status).toBe(TaskStatus.FAILED);
    expect(task.status.message).toMatch(/api key/i);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('audit log: emits one structured a2a:inbound entry per task', async () => {
    chatMock.mockResolvedValueOnce({
      choices: [
        {
          message: { role: 'assistant', content: 'ok', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const executor = createCodeBuddyTaskExecutor();
    await executor(makeTask('hello', { peerId: 'ministar' }));

    expect(loggerInfoMock).toHaveBeenCalledWith(
      '[a2a:inbound]',
      expect.objectContaining({
        peerId: 'ministar',
        turns: 1,
        tokensUsed: 15,
        status: TaskStatus.COMPLETED,
      })
    );
    // Audit log MUST NOT contain the user prompt content (PII concern).
    const loggedPayload = loggerInfoMock.mock.calls[0]?.[1] as Record<string, unknown>;
    const serialized = JSON.stringify(loggedPayload);
    expect(serialized).not.toContain('hello');
  });

  // ─── V1.0 audit follow-ups (M1) ──────────────────────────────────────────

  describe('error paths (V1.0 audit)', () => {
    it('fails closed when provider auto-detection returns null', async () => {
      detectProviderMock.mockReturnValueOnce(null);
      const executor = createCodeBuddyTaskExecutor();
      const task = await executor(makeTask('anything'));
      expect(task.status.status).toBe(TaskStatus.FAILED);
      expect(task.status.message).toMatch(/api key/i);
      expect(chatMock).not.toHaveBeenCalled();
    });

    it('fails closed when no fleet-safe tools are registered', async () => {
      fleetSafeListMock.mockReturnValue([]);
      const executor = createCodeBuddyTaskExecutor();
      const task = await executor(makeTask('anything'));
      expect(task.status.status).toBe(TaskStatus.FAILED);
      expect(task.status.message).toMatch(/no fleet-safe tools/i);
      expect(chatMock).not.toHaveBeenCalled();
    });

    it('fails when user message is empty (after part filtering)', async () => {
      const task: Task = {
        id: 'empty',
        sessionId: 'sess-1',
        status: { status: TaskStatus.SUBMITTED, timestamp: Date.now() },
        messages: [{ role: 'user', parts: [{ type: 'text', text: '   ' }] }],
        artifacts: [],
        history: [{ status: TaskStatus.SUBMITTED, timestamp: Date.now() }],
      };
      const executor = createCodeBuddyTaskExecutor();
      const result = await executor(task);
      expect(result.status.status).toBe(TaskStatus.FAILED);
      expect(result.status.message).toMatch(/empty user message/i);
    });

    it('fails when LLM call throws on the first turn', async () => {
      chatMock.mockRejectedValueOnce(new Error('upstream 503'));
      const executor = createCodeBuddyTaskExecutor();
      const task = await executor(makeTask('hello'));
      expect(task.status.status).toBe(TaskStatus.FAILED);
      expect(task.status.message).toMatch(/llm call failed.*upstream 503/i);
      // Warning logged (with phase=llm_call), with no peer prompt content.
      const warnArgs = loggerWarnMock.mock.calls[0];
      expect(warnArgs?.[0]).toBe('[a2a:inbound]');
      expect(JSON.stringify(warnArgs?.[1])).not.toContain('hello');
    });

    it('rejects hallucinated non-fleet-safe tool (defense-in-depth)', async () => {
      // First turn: LLM hallucinates an unsafe tool.
      chatMock
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-bad',
                    type: 'function',
                    function: { name: 'shell_exec', arguments: '{"cmd":"rm -rf /"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { total_tokens: 10 },
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: { role: 'assistant', content: 'Cannot do that.', tool_calls: undefined },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 18 },
        });
      // shell_exec is NOT fleet-safe — defensive registry check refuses.
      isFleetSafeMock.mockImplementation((name: string) => name === 'view_file');

      const executor = createCodeBuddyTaskExecutor();
      const task = await executor(makeTask('please run shell'));
      expect(task.status.status).toBe(TaskStatus.COMPLETED);
      // formalExecuteMock should NOT have been called for the unsafe tool.
      expect(formalExecuteMock).not.toHaveBeenCalled();
      // Final message is the LLM's recovery reply.
      const reply = task.messages.find((m) => m.role === 'agent');
      expect((reply!.parts[0] as { text: string }).text).toBe('Cannot do that.');
    });

    it('terminates at MAX_TURNS cap and returns partial answer', async () => {
      // 3 successive tool_calls turns → executor caps and returns partial.
      const toolTurn = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Still working...',
              tool_calls: [
                {
                  id: 'call-x',
                  type: 'function',
                  function: { name: 'view_file', arguments: '{"path":"a.txt"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { total_tokens: 15 },
      };
      chatMock
        .mockResolvedValueOnce(toolTurn)
        .mockResolvedValueOnce(toolTurn)
        .mockResolvedValueOnce(toolTurn);
      formalExecuteMock.mockResolvedValue({ success: true, output: 'file contents' });

      const executor = createCodeBuddyTaskExecutor();
      const task = await executor(makeTask('keep going'));
      // Reach the cap → COMPLETED with whatever content the last reply had.
      expect(task.status.status).toBe(TaskStatus.COMPLETED);
      // chat called exactly MAX_TURNS=3 times.
      expect(chatMock).toHaveBeenCalledTimes(3);
    });
  });
});
