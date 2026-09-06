import { describe, it, expect } from 'vitest';
import { runCompanionChannelTurn } from '../../src/channels/companion-channel-turn.js';

describe('runCompanionChannelTurn', () => {
  it('calls chat with no tools and returns the assistant text', async () => {
    const calls: unknown[] = [];
    const result = await runCompanionChannelTurn({
      apiKey: 'ollama',
      baseUrl: 'http://127.0.0.1:11435/v1',
      model: 'qwen3:4b-instruct',
      messages: [
        { role: 'system', content: 'Tu es Lisa.' },
        { role: 'user', content: 'salut' },
      ],
      chat: async (messages, tools, opts) => {
        calls.push({ messages, tools, opts });
        return {
          model: 'qwen3:4b-instruct',
          choices: [{ message: { role: 'assistant', content: 'Hey. Je suis là.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 },
        };
      },
    });
    expect(result.text).toBe('Hey. Je suis là.');
    expect(result.promptTokens).toBe(120);
    expect(calls).toHaveLength(1);
    const call = calls[0] as { tools: unknown[]; opts: { tool_choice: string } };
    expect(call.tools).toEqual([]);
    expect(call.opts.tool_choice).toBe('none');
  });
});
