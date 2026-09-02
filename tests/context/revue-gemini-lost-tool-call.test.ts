import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import { EnhancedContextCompressor } from '../../src/context/enhanced-compression.js';
import { createTokenCounter } from '../../src/context/token-counter.js';

describe('Mission G1 — Trou 2 : compaction qui perd un tool_call sans son résultat', () => {
  it('EnhancedContextCompressor.hardTruncate ne doit jamais conserver un assistant tool_calls dont le tool_result a été tronqué', () => {
    const tokenCounter = createTokenCounter('gpt-4');
    const compressor = new EnhancedContextCompressor(tokenCounter, {
      enableArchiving: false,
      slidingWindow: {
        windowSize: 5,
        overlapSize: 0,
        summarizeOldMessages: false,
      },
    });

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'Base system prompt.' },
      { role: 'user', content: 'Run command.' },
      {
        role: 'assistant',
        content: 'I call the tool now.',
        tool_calls: [
          {
            id: 'call_deploy_42',
            type: 'function',
            function: { name: 'deploy', arguments: '{"env":"staging"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_deploy_42',
        content: `Very large deployment logs ${'LOG_LINE '.repeat(800)}`,
      } as CodeBuddyMessage,
      {
        role: 'user',
        content: 'LATEST_REQUEST is deployment done?',
      },
    ];

    // Budget : permet à l'assistant (court) de rentrer, mais pas au tool_result (très lourd).
    const result = compressor.compress(messages, 95);

    const survivingCalls = result.messages.filter(
      m => m.role === 'assistant' && 'tool_calls' in m && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );

    expect(survivingCalls.length).toBeGreaterThan(0);
    for (const assistantMsg of survivingCalls) {
      const calls = (assistantMsg as { tool_calls: Array<{ id: string }> }).tool_calls;
      for (const call of calls) {
        const hasResult = result.messages.some(
          m => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === call.id,
        );
        expect(
          hasResult,
          `Compaction preserved tool_call "${call.id}" but dropped its corresponding tool_result, creating an invalid LLM transcript`,
        ).toBe(true);
      }
    }
  });

  it('EnhancedContextCompressor avec multi-tool ne doit pas conserver un tool_call partiel sans son résultat', () => {
    const tokenCounter = createTokenCounter('gpt-4');
    const compressor = new EnhancedContextCompressor(tokenCounter, {
      enableArchiving: false,
      slidingWindow: {
        windowSize: 10,
        overlapSize: 0,
        summarizeOldMessages: false,
      },
    });

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'Base system prompt.' },
      { role: 'user', content: 'Execute operations.' },
      {
        role: 'assistant',
        content: 'I call two tools.',
        tool_calls: [
          {
            id: 'call_alpha_1',
            type: 'function',
            function: { name: 'op_alpha', arguments: '{}' },
          },
          {
            id: 'call_beta_2',
            type: 'function',
            function: { name: 'op_beta', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_alpha_1',
        content: 'Small alpha output',
      } as CodeBuddyMessage,
      {
        role: 'tool',
        tool_call_id: 'call_beta_2',
        content: `Very large beta output ${'DATA_ROW '.repeat(600)}`,
      } as CodeBuddyMessage,
      {
        role: 'user',
        content: 'LATEST_REQUEST give me the final answer',
      },
    ];

    const result = compressor.compress(messages, 95);

    // Si call_beta_2 est présent dans l'assistant conservé, son résultat tool doit obligatoirement être présent
    const assistant = result.messages.find(
      m => m.role === 'assistant' && 'tool_calls' in m && Array.isArray(m.tool_calls),
    );
    expect(assistant, 'Assistant message with tool_calls should be preserved').toBeDefined();

    const betaResult = result.messages.find(
      m => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === 'call_beta_2',
    );
    expect(betaResult, 'Tool result for call_beta_2 must not be dropped while assistant tool_call is kept').toBeDefined();
  });
});
