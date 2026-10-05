import { describe, expect, it } from 'vitest';
import { ClaudeProvider } from '../../src/providers/claude-provider.js';

type Formatted = { system: string; messages: Array<{ role: string; content: unknown }> };
const format = (messages: unknown[], systemPrompt?: string): Formatted =>
  (new ClaudeProvider() as unknown as { formatMessages(o: unknown): Formatted }).formatMessages({
    messages,
    systemPrompt,
  });

describe('ClaudeProvider.formatMessages — alternance des rôles exigée par Anthropic', () => {
  it('fusionne les résultats de plusieurs outils en un seul message user', () => {
    const { messages } = format([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } },
          { id: 'b', type: 'function', function: { name: 'y', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: 'ra' },
      { role: 'tool', tool_call_id: 'b', content: 'rb' },
    ]);
    // ÉCHOUE sur l'ancienne logique : un message user par résultat d'outil.
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('commence toujours par un message user', () => {
    const { messages } = format([{ role: 'assistant', content: 'hello' }, { role: 'user', content: 'hi' }]);
    expect(messages[0]?.role).toBe('user');
  });

  it('garde le prompt système fourni', () => {
    const { system } = format([{ role: 'user', content: 'hi' }], 'SYS');
    expect(system).toContain('SYS');
  });
});
