import { describe, it, expect } from 'vitest';
import { AgentExecutor } from '../../../src/agent/execution/agent-executor.js';
import type { CodeBuddyToolCall } from '../../../src/codebuddy/client.js';
import type { ToolResult } from '../../../src/types/index.js';

describe('agent batch output retention', () => {
  it('bounds replayed streaming chunks and retains the last diagnostic', async () => {
    const executor = Object.create(AgentExecutor.prototype) as {
      deps: unknown;
      executeToolForBatch(call: CodeBuddyToolCall): Promise<{ result: ToolResult; streamChunks: string[] }>;
    };
    executor.deps = { toolHandler: { async *executeToolStreaming() {
      yield 'START\n';
      for (let i = 0; i < 2000; i++) yield 'progress'.repeat(40);
      yield 'FINAL_ERROR';
      return { success: false, error: 'build failed' };
    } } };
    const result = await executor.executeToolForBatch({ id: 'buffer-test', type: 'function', function: { name: 'bash', arguments: '{}' } });
    expect(result.result).toEqual({ success: false, error: 'build failed' });
    expect(result.streamChunks.length).toBeLessThanOrEqual(1024);
    const output = result.streamChunks.join('');
    expect(Buffer.byteLength(output)).toBeLessThan(256 * 1024 + 100);
    expect(output).toMatch(/^START/);
    expect(output).toMatch(/FINAL_ERROR$/);
  });
});
