import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextCompressor } from '../../src/context/compression.js';
import { ContextManagerV3 } from '../../src/context/context-manager-v3.js';
import { createTokenCounter } from '../../src/context/token-counter.js';

describe('Mission G1 — Trou 1 : requête courante refusée ou compactée laissant un tool_result orphelin', () => {
  it('ContextCompressor ne doit jamais conserver un tool_result si son appel assistant tool_calls a été supprimé', () => {
    const tokenCounter = createTokenCounter('gpt-4');
    const compressor = new ContextCompressor(tokenCounter);

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'You are an assistant.' },
      { role: 'user', content: 'Please read the configuration file.' },
      {
        role: 'assistant',
        content: `I am going to inspect the file now. ${'word '.repeat(300)}`,
        tool_calls: [
          {
            id: 'call_read_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"config.json"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_read_1',
        content: '{"port": 8080}',
      } as CodeBuddyMessage,
      {
        role: 'user',
        content: 'Now restart the service.',
      },
    ];

    // Limite stricte : force hardTruncate à trancher entre le tool_result et son assistant tool_calls
    const compressed = compressor.compress(messages, 80, {
      preserveSystemPrompt: true,
      preserveRecentMessages: 1,
    });

    // Invariant fondamental : aucun message de rôle 'tool' ne doit subsister sans son assistant appelant
    const survivingToolResults = compressed.messages.filter(m => m.role === 'tool');
    for (const toolResult of survivingToolResults) {
      const callId = (toolResult as { tool_call_id?: string }).tool_call_id;
      const hasParentCall = compressed.messages.some(
        m => m.role === 'assistant' && 'tool_calls' in m && Array.isArray(m.tool_calls) && m.tool_calls.some(tc => tc.id === callId),
      );
      expect(hasParentCall, `Orphan tool_result found for callId "${callId}" without calling assistant tool_calls`).toBe(true);
    }
  });

  it('ContextManagerV3.prepareMessages ne doit pas émettre un transcript contenant un tool_result orphelin', () => {
    const manager = new ContextManagerV3({
      maxContextTokens: 120,
      responseReserveTokens: 20,
      recentMessagesCount: 1,
      model: 'gpt-4',
    });

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'base prompt' },
      { role: 'user', content: 'query' },
      {
        role: 'assistant',
        content: `Calling tool with explanation ${'verbose '.repeat(200)}`,
        tool_calls: [
          {
            id: 'call_exec_42',
            type: 'function',
            function: { name: 'bash', arguments: '{"cmd":"uptime"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_exec_42',
        content: 'up 10 days',
      } as CodeBuddyMessage,
      { role: 'user', content: 'next short query' },
    ];

    const prepared = manager.prepareMessages(messages);
    const toolMsgs = prepared.filter(m => m.role === 'tool');
    for (const tm of toolMsgs) {
      const callId = (tm as { tool_call_id?: string }).tool_call_id;
      const hasCall = prepared.some(
        m => m.role === 'assistant' && 'tool_calls' in m && Array.isArray(m.tool_calls) && m.tool_calls.some(tc => tc.id === callId),
      );
      expect(hasCall, `ContextManagerV3 emitted orphan tool_result ${callId}`).toBe(true);
    }
    manager.dispose();
  });
});
