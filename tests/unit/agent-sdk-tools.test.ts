import { describe, expect, it } from 'vitest';
import { AgentSDK } from '../../src/sdk/agent-sdk.js';

describe('AgentSDK tool execution', () => {
  it('executes registered tools referenced in the prompt', async () => {
    const sdk = new AgentSDK();
    sdk.addTool({
      name: 'echo',
      description: 'Echoes an input value',
      parameters: {
        value: { type: 'string' },
      },
      execute: async (input) => `echo:${String(input.value)}`,
    });

    const result = await sdk.run('Use the tool\n@tool echo {"value":"hello"}');

    expect(result.success).toBe(true);
    expect(result.toolCalls).toBe(1);
    expect(result.output).toContain('[echo] echo:hello');
  });

  it('streams tool usage and final output events', async () => {
    const sdk = new AgentSDK();
    sdk.addTool({
      name: 'sum',
      description: 'Adds two numbers',
      parameters: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      execute: async (input) => String(Number(input.a) + Number(input.b)),
    });

    const events: string[] = [];
    for await (const event of sdk.runStreaming('@tool sum {"a":2,"b":3}')) {
      events.push(event.type);
    }

    expect(events).toEqual(['tool_use', 'tool_result', 'text', 'done']);
  });
});
