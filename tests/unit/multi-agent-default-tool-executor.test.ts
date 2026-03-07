import { EventEmitter } from 'events';

import { MultiAgentSystem } from '../../src/agent/multi-agent/multi-agent-system.js';
import type { AgentRole } from '../../src/agent/multi-agent/types.js';
import type { CodeBuddyToolCall } from '../../src/codebuddy/client.js';

const mockRegistry = {
  has: vi.fn(),
  register: vi.fn(),
  execute: vi.fn(),
};

const mockCreateAllToolsAsync = vi.fn();

function createMockAgent(role: AgentRole) {
  const emitter = new EventEmitter();
  return {
    ...emitter,
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeAllListeners: emitter.removeAllListeners.bind(emitter),
    getRole: vi.fn().mockReturnValue(role),
    receiveMessage: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    createPlan: vi.fn(),
    synthesizeResults: vi.fn(),
  };
}

vi.mock('../../src/agent/multi-agent/agents/orchestrator-agent.js', () => ({
  createOrchestratorAgent: vi.fn(() => createMockAgent('orchestrator')),
  OrchestratorAgent: vi.fn(),
}));

vi.mock('../../src/agent/multi-agent/agents/coder-agent.js', () => ({
  createCoderAgent: vi.fn(() => createMockAgent('coder')),
  CoderAgent: vi.fn(),
}));

vi.mock('../../src/agent/multi-agent/agents/reviewer-agent.js', () => ({
  createReviewerAgent: vi.fn(() => createMockAgent('reviewer')),
  ReviewerAgent: vi.fn(),
}));

vi.mock('../../src/agent/multi-agent/agents/tester-agent.js', () => ({
  createTesterAgent: vi.fn(() => createMockAgent('tester')),
  TesterAgent: vi.fn(),
}));

vi.mock('../../src/tools/registry/index.js', () => ({
  getFormalToolRegistry: vi.fn(() => mockRegistry),
  createAllToolsAsync: mockCreateAllToolsAsync,
}));

describe('MultiAgentSystem default tool executor', () => {
  let system: MultiAgentSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.has.mockReturnValue(false);
    mockRegistry.execute.mockResolvedValue({
      success: true,
      output: 'tool ok',
    });
    mockCreateAllToolsAsync.mockResolvedValue([
      {
        name: 'view_file',
        description: 'View a file',
      },
    ]);
    system = new MultiAgentSystem('test-api-key');
  });

  afterEach(() => {
    system.dispose();
  });

  it('executes tool calls through the formal registry', async () => {
    const toolCall: CodeBuddyToolCall = {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'view_file',
        arguments: '{"path":"README.md"}',
      },
    };

    const result = await (system as unknown as {
      defaultToolExecutor: (call: CodeBuddyToolCall) => Promise<{ success: boolean; output?: string }>;
    }).defaultToolExecutor(toolCall);

    expect(mockCreateAllToolsAsync).toHaveBeenCalledTimes(1);
    expect(mockRegistry.register).toHaveBeenCalledTimes(1);
    expect(mockRegistry.execute).toHaveBeenCalledWith(
      'view_file',
      { path: 'README.md' },
      expect.objectContaining({
        cwd: process.cwd(),
        extra: expect.objectContaining({
          source: 'multi-agent-system',
          toolCallId: 'call-1',
        }),
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        output: 'tool ok',
      })
    );
  });

  it('initializes the registry only once', async () => {
    const toolCall: CodeBuddyToolCall = {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'view_file',
        arguments: '{"path":"README.md"}',
      },
    };

    await (system as unknown as {
      defaultToolExecutor: (call: CodeBuddyToolCall) => Promise<unknown>;
    }).defaultToolExecutor(toolCall);
    await (system as unknown as {
      defaultToolExecutor: (call: CodeBuddyToolCall) => Promise<unknown>;
    }).defaultToolExecutor({
      ...toolCall,
      id: 'call-2',
      function: {
        ...toolCall.function,
        arguments: '{"path":"package.json"}',
      },
    });

    expect(mockCreateAllToolsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns a structured error for invalid tool arguments', async () => {
    const result = await (system as unknown as {
      defaultToolExecutor: (call: CodeBuddyToolCall) => Promise<{ success: boolean; error?: string }>;
    }).defaultToolExecutor({
      id: 'call-bad',
      type: 'function',
      function: {
        name: 'view_file',
        arguments: '{invalid json',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid tool arguments');
    expect(mockRegistry.execute).not.toHaveBeenCalled();
  });
});
