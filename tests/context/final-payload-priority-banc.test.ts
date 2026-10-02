import { describe, expect, it } from 'vitest';
import observation from '../fixtures/b-recent-tool-observation.json';
import { budgetFinalPayload } from '../../src/context/final-payload-budget.js';
import type { OpenAiChatPayload } from '../../src/codebuddy/providers/ollama-native-transport.js';

function recordedShape(): OpenAiChatPayload {
  // B-27b-2 request 73: 142 messages, 32K window / 8K output;
  // request 3 has a 20354-character system prompt. No personal trace data.
  const system = 'Follow the mission and preserve the security guards.\n'
    + 'Project context. '.repeat(1260)
    + '\n<runtime_settings>git-local: add/commit only; npm-registry: fixed registry; tests: networkless</runtime_settings>';
  const messages: OpenAiChatPayload['messages'] = [
    { role: 'system', content: system },
    { role: 'user', content: 'Fix the audit and isolate the scan test. Add regressions, run tests, commit locally. '.repeat(50) },
  ];
  for (let index = 0; index < 69; index++) {
    messages.push({ role: 'assistant', content: null, tool_calls: [{ id: `old-${index}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'read old diagnostic' }) } }] });
    messages.push({ role: 'tool', tool_call_id: `old-${index}`, content: 'Old diagnostic. '.repeat(250) });
  }
  messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'recent', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'sed -n 150,240p src/tools/comment-watcher.ts' }) } }] });
  messages.push({ role: 'tool', tool_call_id: 'recent', content: observation.output });
  return { model: 'qwen3.8:27b', messages, max_tokens: 8192 };
}

describe('B: priorité du payload final aux instructions et au dernier résultat', () => {
  it('conserve les capacités opérateur plutôt que les anciens diagnostics', () => {
    const input = recordedShape();
    const result = budgetFinalPayload(input, 32768, { workDir: '/workspace', sessionId: 'priority' });
    expect(result.payload.messages.find(message => message.role === 'system')?.content).toContain('<runtime_settings>git-local: add/commit only');
    expect(result.payload.messages.filter(message => message.role === 'tool').length).toBeLessThan(70);
    expect(result.inputTokens + result.outputTokens + result.safetyTokens).toBeLessThanOrEqual(32768);
    expect(result.payload.messages.findLast(message => message.role === 'user')?.content).toBe(input.messages[1]?.content);
  });

  it('transmet intégralement la lecture récente qui tient dans le budget', () => {
    const result = budgetFinalPayload(recordedShape(), 32768, { workDir: '/workspace', sessionId: 'recent' });
    expect(result.payload.messages.find(message => message.tool_call_id === 'recent')?.content).toBe(observation.output);
    const ids = new Set(result.payload.messages.flatMap(message => message.tool_calls?.map(call => call.id) ?? []));
    for (const message of result.payload.messages.filter(message => message.role === 'tool')) {
      expect(ids.has(message.tool_call_id!)).toBe(true);
    }
  });
});
