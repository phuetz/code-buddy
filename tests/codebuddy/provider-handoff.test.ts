import { describe, expect, it } from 'vitest';
import {
  buildResumeNote,
  prepareFailoverMessages,
  systemPromptBudgetChars,
} from '../../src/codebuddy/provider-handoff.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

describe('provider handoff', () => {
  it('injects a resume note and repairs a dangling tool call', async () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'user', content: 'list files' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_directory', arguments: '{}' } }],
      },
    ];
    const next = await prepareFailoverMessages(messages, {
      fromProvider: 'chatgpt',
      toProvider: 'ollama',
      toModel: 'qwen3.8-ctx32k:latest',
    });
    expect(next.some((m) => typeof m.content === 'string' && m.content.includes('conversation reprise par ollama:qwen3.8-ctx32k:latest'))).toBe(true);
    const toolResults = next.filter((m) => m.role === 'tool');
    expect(toolResults).toHaveLength(1);
    expect(buildResumeNote({
      fromProvider: 'chatgpt',
      toProvider: 'ollama',
      toModel: 'qwen3.8-ctx32k:latest',
    })).toContain('après indisponibilité de chatgpt');
  });

  it('retruncates an oversized system prompt to the backup model budget', async () => {
    const huge = 'S'.repeat(200_000);
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: huge },
      { role: 'user', content: 'hello' },
    ];
    const next = await prepareFailoverMessages(messages, {
      fromProvider: 'chatgpt',
      toProvider: 'ollama',
      toModel: 'qwen3:4b',
    });
    const system = next.find((m) => m.role === 'system' && typeof m.content === 'string' && !m.content.includes('provider_resume'));
    expect(system).toBeDefined();
    expect(String(system?.content).length).toBeLessThan(huge.length);
    expect(String(system?.content).length).toBeLessThanOrEqual(systemPromptBudgetChars('qwen3:4b') + 32);
  });
});
