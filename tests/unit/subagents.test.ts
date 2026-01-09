import { 
  Subagent, 
  SubagentManager, 
  ParallelSubagentRunner, 
  SubagentConfig,
  SubagentResult
} from '../../src/agent/subagents';
import { CodeBuddyClient, CodeBuddyToolCall } from '../../src/codebuddy/client';
import { ToolResult } from '../../src/types/index';

// Mock CodeBuddyClient
jest.mock('../../src/codebuddy/client', () => {
  return {
    CodeBuddyClient: jest.fn().mockImplementation(() => {
      return {
        chat: jest.fn(),
      };
    }),
  };
});

interface MockedSubagent {
  client: {
    chat: jest.Mock;
  };
}

describe('Subagents Module', () => {
  const apiKey = 'test-api-key';
  const baseURL = 'https://api.test.com';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Subagent Class', () => {
    const config: SubagentConfig = {
      name: 'test-agent',
      description: 'Test Description',
      systemPrompt: 'You are a test agent',
      maxRounds: 5,
      timeout: 1000,
    };

    it('should initialize correctly', () => {
      const agent = new Subagent(apiKey, config, baseURL);
      expect(agent).toBeDefined();
      expect(agent.getConfig().name).toBe(config.name);
      expect(CodeBuddyClient).toHaveBeenCalledWith(apiKey, 'grok-code-fast-1', baseURL);
    });

    it('should run a task successfully without tool calls', async () => {
      const agent = new Subagent(apiKey, config, baseURL);
      const mockClient = (agent as unknown as MockedSubagent).client;
      
      mockClient.chat.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Task completed successfully',
          }
        }]
      });

      const result = await agent.run('test task');

      expect(result.success).toBe(true);
      expect(result.output).toBe('Task completed successfully');
      expect(result.rounds).toBe(1);
      expect(mockClient.chat).toHaveBeenCalledTimes(1);
    });

    it('should handle tool calls', async () => {
      const agent = new Subagent(apiKey, config, baseURL);
      const mockClient = (agent as unknown as MockedSubagent).client;
      
      // First round: agent calls a tool
      mockClient.chat.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Calling tool...',
            tool_calls: [{
              id: 'call_123',
              function: {
                name: 'test_tool',
                arguments: '{"arg": "value"}',
              }
            }]
          }
        }]
      });

      // Second round: agent finishes
      mockClient.chat.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Tool result processed',
          }
        }]
      });

      const executeTool = jest.fn().mockResolvedValue({
        success: true,
        output: 'Tool output',
      } as ToolResult);

      const result = await agent.run('test task', undefined, [], executeTool);

      expect(result.success).toBe(true);
      expect(result.toolsUsed).toContain('test_tool');
      expect(result.rounds).toBe(2);
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(mockClient.chat).toHaveBeenCalledTimes(2);
    });

    it('should respect max rounds', async () => {
      const agent = new Subagent(apiKey, { ...config, maxRounds: 2 }, baseURL);
      const mockClient = (agent as unknown as MockedSubagent).client;
      
      mockClient.chat.mockResolvedValue({
        choices: [{
          message: {
            content: 'Still working...',
            tool_calls: [{
              id: 'call_1',
              function: { name: 'test_tool', arguments: '{}' }
            }]
          }
        }]
      });

      const executeTool = jest.fn().mockResolvedValue({ success: true, output: 'ok' } as ToolResult);
      const result = await agent.run('test task', undefined, [], executeTool);

      expect(result.success).toBe(false);
      expect(result.rounds).toBe(2);
      expect(result.output).toBe('Still working...');
    });

    it('should handle timeout', async () => {
      const agent = new Subagent(apiKey, { ...config, timeout: 50 }, baseURL);
      const mockClient = (agent as unknown as MockedSubagent).client;
      
      mockClient.chat.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => resolve({
          choices: [{ message: { content: 'done' } }]
        }), 100));
      });

      const result = await agent.run('test task');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Subagent timed out');
    });

    it('should handle errors in chat', async () => {
      const agent = new Subagent(apiKey, config, baseURL);
      const mockClient = (agent as unknown as MockedSubagent).client;
      
      mockClient.chat.mockRejectedValue(new Error('API error'));

      const result = await agent.run('test task');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Error: API error');
    });

    it('should filter tools based on config', async () => {
      const restrictedConfig: SubagentConfig = {
        ...config,
        tools: ['allowed_tool'],
      };
      const agent = new Subagent(apiKey, restrictedConfig, baseURL);
      const mockClient = (agent as unknown as MockedSubagent).client;
      
      mockClient.chat.mockResolvedValue({
        choices: [{ message: { content: 'done' } }]
      });

      const allTools: any[] = [
        { function: { name: 'allowed_tool' } },
        { function: { name: 'forbidden_tool' } },
      ];

      await agent.run('test task', undefined, allTools);

      expect(mockClient.chat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.arrayContaining([expect.objectContaining({ function: { name: 'allowed_tool' } })])
      );
      const callTools = mockClient.chat.mock.calls[0][1];
      expect(callTools).toHaveLength(1);
      expect(callTools[0].function.name).toBe('allowed_tool');
    });

    it('should be able to stop', async () => {
      const agent = new Subagent(apiKey, config, baseURL);
      const mockClient = (agent as unknown as MockedSubagent).client;
      
      mockClient.chat.mockImplementation(() => {
        agent.stop();
        return Promise.resolve({
          choices: [{
            message: {
              content: 'Calling tool...',
              tool_calls: [{ id: '1', function: { name: 't', arguments: '{}' } }]
            }
          }]
        });
      });

      const result = await agent.run('test task');
      // Should stop after the first round because isRunning became false
      expect(result.rounds).toBe(1);
    });
  });

  describe('SubagentManager Class', () => {
    let manager: SubagentManager;

    beforeEach(() => {
      manager = new SubagentManager(apiKey, baseURL);
    });

    it('should register and retrieve custom subagents', () => {
      const customConfig: SubagentConfig = {
        name: 'custom-agent',
        description: 'Custom',
        systemPrompt: 'Prompt',
      };
      manager.registerSubagent(customConfig);
      
      expect(manager.getAvailableSubagents()).toContain('custom-agent');
      expect(manager.getSubagentConfig('custom-agent')).toEqual(customConfig);
    });

    it('should create subagents by name', () => {
      const agent = manager.createSubagent('code-reviewer');
      expect(agent).toBeDefined();
      expect(agent!.getConfig().name).toBe('code-reviewer');
    });

    it('should return null for unknown subagents', () => {
      expect(manager.createSubagent('unknown')).toBeNull();
    });

    it('should spawn and run an agent', async () => {
      const mockRun = jest.spyOn(Subagent.prototype, 'run').mockResolvedValue({
        success: true,
        output: 'spawn result',
        toolsUsed: [],
        rounds: 1,
        duration: 100,
      } as SubagentResult);

      const result = await manager.spawn('code-reviewer', 'task');

      expect(result.success).toBe(true);
      expect(result.output).toBe('spawn result');
      expect(mockRun).toHaveBeenCalled();
      
      mockRun.mockRestore();
    });

    it('should format available subagents', () => {
      const output = manager.formatAvailableSubagents();
      expect(output).toContain('Available Subagents:');
      expect(output).toContain('code-reviewer');
      expect(output).toContain('debugger');
    });
  });

  describe('ParallelSubagentRunner Class', () => {
    let manager: SubagentManager;
    let runner: ParallelSubagentRunner;

    beforeEach(() => {
      manager = new SubagentManager(apiKey, baseURL);
      runner = new ParallelSubagentRunner(manager, 2);
    });

    it('should run tasks in parallel', async () => {
      const mockSpawn = jest.spyOn(manager, 'spawn').mockImplementation(async (name: string) => {
        return {
          success: true,
          output: `Result for ${name}`,
          toolsUsed: [],
          rounds: 1,
          duration: 50,
        } as SubagentResult;
      });

      const tasks = [
        { id: '1', agentType: 'explorer', task: 'task 1' },
        { id: '2', agentType: 'debugger', task: 'task 2' },
      ];

      const result = await runner.runParallel(tasks);

      expect(result.success).toBe(true);
      expect(result.completedCount).toBe(2);
      expect(result.results.size).toBe(2);
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      mockSpawn.mockRestore();
    });

    it('should handle failures in parallel tasks', async () => {
      jest.spyOn(manager, 'spawn').mockImplementation(async (name: string) => {
        if (name === 'debugger') {
          return { success: false, output: 'fail', toolsUsed: [], rounds: 1, duration: 10 } as SubagentResult;
        }
        return { success: true, output: 'ok', toolsUsed: [], rounds: 1, duration: 10 } as SubagentResult;
      });

      const tasks = [
        { id: '1', agentType: 'explorer', task: 'task 1' },
        { id: '2', agentType: 'debugger', task: 'task 2' },
      ];

      const result = await runner.runParallel(tasks);

      expect(result.success).toBe(false);
      expect(result.completedCount).toBe(1);
      expect(result.failedCount).toBe(1);
    });

    it('should stop on first error if configured', async () => {
      const mockSpawn = jest.spyOn(manager, 'spawn').mockImplementation(async (name: string) => {
        if (name === 'explorer') {
          return { success: false, output: 'fail', toolsUsed: [], rounds: 1, duration: 10 } as SubagentResult;
        }
        return { success: true, output: 'ok', toolsUsed: [], rounds: 1, duration: 10 } as SubagentResult;
      });

      const tasks = [
        { id: '1', agentType: 'explorer', task: 'task 1', priority: 10 },
        { id: '2', agentType: 'debugger', task: 'task 2', priority: 1 },
      ];

      const result = await runner.runParallel(tasks, { stopOnFirstError: true, batchSize: 1 });

      expect(result.failedCount).toBe(1);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('should format results correctly', () => {
      const executionResult = {
        success: true,
        results: new Map([
          ['1', { success: true, output: 'out 1', toolsUsed: ['t1'], rounds: 1, duration: 100 }]
        ]),
        totalDuration: 100,
        completedCount: 1,
        failedCount: 0,
        errors: [],
      };

      const output = runner.formatResults(executionResult as any);
      expect(output).toContain('Parallel Execution Results');
      expect(output).toContain('Completed: 1');
      expect(output).toContain('out 1');
    });
  });
});