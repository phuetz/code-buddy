import { describe, expect, it } from 'vitest';
import { streamAgentDeltas, type ServerAgent } from '../../src/server/agent-adapter.js';

describe('SERV1 OpenAI stream hides agent chrome', () => {
  it('does not yield Context Notice chunks as completion deltas', async () => {
    const agent = {
      getCurrentModel: () => 'qa-serv1-model',
      setModel: () => undefined,
      systemPromptReady: Promise.resolve(),
      getChatHistory: () => [],
      processUserMessageStream: async function* () {
        yield {
          type: 'content' as const,
          content:
            '\n🟢 Context Notice: You have used 53.0% of your total context (14,438/27,238 tokens)\n',
        };
        yield { type: 'content' as const, content: 'SERV1-STREAM-OK' };
      },
      abortCurrentOperation: () => undefined,
      executeToolByName: async () => ({ success: true }),
    } as unknown as ServerAgent;

    const chunks: string[] = [];
    for await (const delta of streamAgentDeltas(agent, 'hi')) {
      chunks.push(delta);
    }

    expect(chunks.join('')).toBe('SERV1-STREAM-OK');
    expect(chunks.join('')).not.toMatch(/Context Notice/);
  });
});
