/**
 * Tests for SWE Agent (OpenManus-compatible)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SWEAgent, createSWEAgent, type SWELLMResponse, type SWEToolResult } from '../../src/agent/specialized/swe-agent.js';
import { AgentStatus } from '../../src/agent/state-machine.js';
import { TERMINATE_SIGNAL } from '../../src/tools/terminate-tool.js';

describe('SWEAgent', () => {
  let mockLLM: ReturnType<typeof vi.fn>;
  let mockExecuteTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLLM = vi.fn();
    mockExecuteTool = vi.fn();
  });

  function createAgent(maxSteps = 10) {
    return createSWEAgent({
      maxSteps,
      maxObserve: 5000,
      llmCall: mockLLM,
      executeTool: mockExecuteTool,
    });
  }

  it('runs a simple task with terminate', async () => {
    // Step 1: LLM calls bash
    mockLLM.mockResolvedValueOnce({
      content: 'Let me check the files',
      tool_calls: [
        { id: 'tc1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } },
      ],
    } as SWELLMResponse);

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: 'file1.ts\nfile2.ts',
    } as SWEToolResult);

    // Step 2: LLM calls terminate
    mockLLM.mockResolvedValueOnce({
      content: 'Found the files',
      tool_calls: [
        { id: 'tc2', type: 'function', function: { name: 'terminate', arguments: '{"status":"Listed files"}' } },
      ],
    } as SWELLMResponse);

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: `${TERMINATE_SIGNAL}\nListed files`,
    } as SWEToolResult);

    const agent = createAgent();
    const result = await agent.run('List all TypeScript files');

    expect(result).toBe('Listed files');
    expect(agent.status).toBe(AgentStatus.FINISHED);
    expect(mockLLM).toHaveBeenCalledTimes(2);
  });

  it('stops at max steps', async () => {
    // LLM always returns a tool call (never terminates)
    mockLLM.mockResolvedValue({
      content: 'Working...',
      tool_calls: [
        { id: 'tc', type: 'function', function: { name: 'bash', arguments: '{"command":"echo hi"}' } },
      ],
    } as SWELLMResponse);

    mockExecuteTool.mockResolvedValue({ success: true, output: 'hi' } as SWEToolResult);

    const agent = createAgent(3);
    const result = await agent.run('Infinite task');

    expect(result).toContain('Max steps');
    expect(agent.status).toBe(AgentStatus.FINISHED);
  });

  it('handles terminal response without tool calls', async () => {
    mockLLM.mockResolvedValueOnce({
      content: 'The answer is 42',
      tool_calls: [],
    } as SWELLMResponse);

    const agent = createAgent();
    const result = await agent.run('What is the answer?');

    expect(result).toBe('The answer is 42');
    expect(agent.status).toBe(AgentStatus.FINISHED);
  });

  it('detects stuck state and recovers', async () => {
    const stuckHandler = vi.fn();

    // Return same tool call 3 times to trigger stuck detection
    const sameResponse: SWELLMResponse = {
      content: 'Trying...',
      tool_calls: [
        { id: 'tc', type: 'function', function: { name: 'bash', arguments: '{"command":"echo stuck"}' } },
      ],
    };

    mockLLM
      .mockResolvedValueOnce(sameResponse)
      .mockResolvedValueOnce(sameResponse)
      .mockResolvedValueOnce(sameResponse)
      // After perturbation, respond with terminate
      .mockResolvedValueOnce({
        content: 'Got unstuck',
        tool_calls: [
          { id: 'tc2', type: 'function', function: { name: 'terminate', arguments: '{"status":"Recovered"}' } },
        ],
      } as SWELLMResponse);

    mockExecuteTool.mockResolvedValue({ success: true, output: 'stuck' } as SWEToolResult);
    // Last call is terminate
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: 'stuck' });
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: 'stuck' });
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: `${TERMINATE_SIGNAL}\nRecovered` });

    const agent = createAgent(10);
    agent.on('state:stuck', stuckHandler);
    const result = await agent.run('Do something');

    expect(stuckHandler).toHaveBeenCalled();
  });

  it('handles tool execution errors gracefully', async () => {
    mockLLM.mockResolvedValueOnce({
      content: 'Running command',
      tool_calls: [
        { id: 'tc', type: 'function', function: { name: 'bash', arguments: '{"command":"fail"}' } },
      ],
    } as SWELLMResponse);

    mockExecuteTool.mockResolvedValueOnce({
      success: false,
      error: 'Command not found',
    } as SWEToolResult);

    // Then terminate
    mockLLM.mockResolvedValueOnce({
      content: 'Task done',
      tool_calls: [],
    } as SWELLMResponse);

    const agent = createAgent();
    const result = await agent.run('Run something');

    expect(result).toBe('Task done');
    // Error should be in memory
    const memory = agent.getMemory();
    const errorMsg = memory.find((m) => m.role === 'tool' && m.content?.includes('Error'));
    expect(errorMsg).toBeDefined();
  });

  it('truncates large tool outputs', async () => {
    mockLLM.mockResolvedValueOnce({
      content: '',
      tool_calls: [
        { id: 'tc', type: 'function', function: { name: 'bash', arguments: '{"command":"cat big"}' } },
      ],
    } as SWELLMResponse);

    const largeOutput = 'x'.repeat(10000);
    mockExecuteTool.mockResolvedValueOnce({ success: true, output: largeOutput } as SWEToolResult);

    mockLLM.mockResolvedValueOnce({ content: 'Done', tool_calls: [] } as SWELLMResponse);

    const agent = createAgent();
    await agent.run('Read big file');

    const memory = agent.getMemory();
    const toolResult = memory.find((m) => m.role === 'tool');
    expect(toolResult?.content?.length).toBeLessThan(largeOutput.length);
    expect(toolResult?.content).toContain('truncated');
  });

  it('emits lifecycle events', async () => {
    const events: string[] = [];

    mockLLM.mockResolvedValueOnce({ content: 'Done', tool_calls: [] } as SWELLMResponse);

    const agent = createAgent();
    agent.on('run:start', () => events.push('start'));
    agent.on('step:think', () => events.push('think'));
    agent.on('run:complete', () => events.push('complete'));

    await agent.run('test');

    expect(events).toContain('start');
    expect(events).toContain('think');
    expect(events).toContain('complete');
  });
});
