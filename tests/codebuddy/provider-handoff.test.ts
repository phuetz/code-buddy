import { describe, expect, it } from 'vitest';
import {
  buildResumeNote,
  estimateHandoffTokens,
  failoverPromptBudgetTokens,
  formatSkippedFailoverTargetLog,
  HANDOFF_TOOL_CAP,
  isFailoverTargetTooSmall,
  prepareFailoverHandoff,
  prepareFailoverMessages,
  resolveFailoverContextWindow,
  systemPromptBudgetChars,
} from '../../src/codebuddy/provider-handoff.js';
import type { CodeBuddyMessage, CodeBuddyTool } from '../../src/codebuddy/client.js';

function bulkyTool(name: string, hint = ''): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: `${hint} ${'D'.repeat(2_000)}`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'target path' },
        },
        required: ['path'],
      },
    },
  };
}

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

  it('caps a ctx32k tag below the qwen3.8 family window', () => {
    expect(resolveFailoverContextWindow('qwen3.8-ctx32k:latest')).toBe(32768);
    expect(resolveFailoverContextWindow('qwen3:4b-instruct')).toBe(32768);
  });

  it('prunes 110 bulky tools for a 32k backup and keeps or closes an in-flight tool call', async () => {
    const tools: CodeBuddyTool[] = [
      bulkyTool('list_directory', 'list files in a directory'),
      bulkyTool('tool_search', 'search for more tools by name'),
      ...Array.from({ length: 108 }, (_, i) => bulkyTool(`tool_${String(i).padStart(3, '0')}`)),
    ];
    expect(tools).toHaveLength(110);

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'user', content: 'liste les fichiers du dossier courant' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_list',
          type: 'function',
          function: { name: 'list_directory', arguments: '{"path":"."}' },
        }],
      },
    ];

    const handoff = await prepareFailoverHandoff(messages, tools, {
      fromProvider: 'chatgpt',
      toProvider: 'ollama',
      toModel: 'qwen3:4b-instruct',
    });

    expect(handoff.tools).toBeDefined();
    expect(handoff.tools!.length).toBeGreaterThan(0);
    expect(handoff.tools!.length).toBeLessThanOrEqual(HANDOFF_TOOL_CAP);
    expect(handoff.tools!.some((tool) => tool.function.name === 'list_directory')).toBe(true);
    expect(handoff.tools!.some((tool) => tool.function.name === 'tool_search')).toBe(true);
    expect(handoff.estimatedTokens).toBeLessThanOrEqual(handoff.budgetTokens);
    expect(handoff.estimatedTokens).toBe(estimateHandoffTokens(handoff.messages, handoff.tools));
    expect(handoff.budgetTokens).toBe(failoverPromptBudgetTokens('qwen3:4b-instruct'));

    const toolResults = handoff.messages.filter((m) => m.role === 'tool');
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as { tool_call_id?: string }).tool_call_id).toBe('call_list');
  });

  it('flags a pruned prompt that still exceeds the backup window', async () => {
    const huge = 'H'.repeat(41_000 * 4);
    const handoff = await prepareFailoverHandoff(
      [{ role: 'user', content: huge }],
      [],
      { fromProvider: 'chatgpt', toProvider: 'ollama', toModel: 'qwen3:4b-instruct' },
    );
    expect(isFailoverTargetTooSmall(handoff.estimatedTokens, handoff.contextWindow)).toBe(true);
    expect(formatSkippedFailoverTargetLog(
      'ollama:qwen3:4b-instruct',
      32_000,
      41_000,
    )).toBe('[fallback] ollama:qwen3:4b-instruct ignorée (contexte 32 k < 41 k)');
  });
});
