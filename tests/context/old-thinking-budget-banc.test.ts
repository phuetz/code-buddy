import { expect, it } from 'vitest';
import { budgetFinalPayload } from '../../src/context/final-payload-budget.js';
import type { OpenAiChatPayload } from '../../src/codebuddy/providers/ollama-native-transport.js';

it('préfère les constats des outils aux pensées anciennes au dernier contrôle de budget', () => {
  const payload: OpenAiChatPayload = {
    model: 'qwen3.8:27b', max_tokens: 1024,
    messages: [
      { role: 'system', content: 'Follow the task.' },
      { role: 'user', content: 'Fix dependencies and verify the audit.' },
      { role: 'assistant', content: 'The affected version and correction are now identified.', ollama_thinking: 'Old investigation. '.repeat(2500), tool_calls: [{ id: 'audit', type: 'function', function: { name: 'bash', arguments: '{"command":"npm audit --json"}' } }] },
      { role: 'tool', tool_call_id: 'audit', content: 'AUDIT_VERIFIED: vulnerable 1.0.0; fixed 1.0.1; gate exit 1.' },
      { role: 'assistant', content: '', ollama_thinking: 'Current reasoning stays exact.', tool_calls: [{ id: 'recent', type: 'function', function: { name: 'view_file', arguments: '{"path":"package.json"}' } }] },
      { role: 'tool', tool_call_id: 'recent', content: '{"dependencies":{"example":"1.0.0"}}' },
    ],
  };
  const result = budgetFinalPayload(payload, 8192, { workDir: process.cwd(), sessionId: 'thinking-budget-regression' });
  expect(result.payload.messages.find(message => message.tool_call_id === 'audit')?.content).toBe(payload.messages[3]?.content);
  expect(result.payload.messages.find(message => message.content === payload.messages[2]?.content)?.ollama_thinking).toBeUndefined();
  expect(result.payload.messages.find(message => message.tool_calls?.[0]?.id === 'recent')?.ollama_thinking).toBe('Current reasoning stays exact.');
  expect(result.inputTokens + result.outputTokens + result.safetyTokens).toBeLessThanOrEqual(8192);
  expect(payload.messages[2]?.ollama_thinking).toBeTruthy();
});
