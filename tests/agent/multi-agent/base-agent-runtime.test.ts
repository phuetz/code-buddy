import { BaseAgent } from '../../../src/agent/multi-agent/base-agent.js';
import type {
  AgentConfig,
  AgentTask,
  SharedContext,
  ToolExecutor,
} from '../../../src/agent/multi-agent/types.js';

const chat = jest.fn();

jest.mock('../../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(function() {
    return { chat };
  }),
}));

class TestAgent extends BaseAgent {
  getSpecializedPrompt(): string {
    return 'Test agent specialized prompt';
  }
}

function createAgent(): TestAgent {
  const config: AgentConfig = {
    role: 'coder',
    name: 'Test Agent',
    description: 'Test multi-agent runtime',
    systemPrompt: 'Run the task.',
    capabilities: ['code_generation'],
    maxRounds: 3,
  };
  return new TestAgent(config, 'test-key');
}

function createTask(): AgentTask {
  return {
    id: 'task-1',
    title: 'Test task',
    description: 'Run a test task',
    status: 'pending',
    priority: 'medium',
    assignedTo: 'coder',
    dependencies: [],
    subtasks: [],
    artifacts: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createContext(): SharedContext {
  return {
    goal: 'Test goal',
    relevantFiles: [],
    conversationHistory: [],
    artifacts: new Map(),
    decisions: [],
    constraints: [],
  };
}

describe('BaseAgent runtime result handling', () => {
  beforeEach(() => {
    chat.mockReset();
  });

  it('passes explicit silent tool success back to the agent', async () => {
    chat
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Calling tool',
            tool_calls: [{
              id: 'call_silent',
              function: { name: 'silent_tool', arguments: '{}' },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Finished' } }],
      });

    const executeTool: ToolExecutor = jest.fn().mockResolvedValue({
      success: true,
      output: '   ',
    });

    const result = await createAgent().execute(createTask(), createContext(), [], executeTool);

    expect(result.success).toBe(true);
    const secondRoundMessages = chat.mock.calls[1][0] as Array<{ role: string; content?: string }>;
    const toolMessage = [...secondRoundMessages].reverse().find((message) => message.role === 'tool');
    expect(toolMessage).toMatchObject({
      role: 'tool',
      content: 'Tool completed successfully with no output.',
    });
  });

  it('fails when the agent returns no content or tool calls', async () => {
    chat.mockResolvedValueOnce({
      choices: [{ message: { content: '   ' } }],
    });

    const executeTool: ToolExecutor = jest.fn();

    const result = await createAgent().execute(createTask(), createContext(), [], executeTool);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Agent returned no content or tool calls');
  });
});
