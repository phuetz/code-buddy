import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import type { ContextManagerV2 } from '../../../src/context/context-manager-v2.js';

vi.mock('../../../src/context/transcript-repair.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/context/transcript-repair.js')>();
  return {
    ...actual,
    repairToolCallPairs: vi.fn(actual.repairToolCallPairs),
  };
});

import {
  prepareTurnMessages,
  TRUNCATED_TOOL_OUTPUT_STUB,
} from '../../../src/agent/execution/context-pipeline.js';
import { repairToolCallPairs } from '../../../src/context/transcript-repair.js';

function call(id: string): CodeBuddyMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id,
      type: 'function',
      function: { name: 'view_file', arguments: '{}' },
    }],
  } as CodeBuddyMessage;
}

function result(id: string, content: string): CodeBuddyMessage {
  return { role: 'tool', tool_call_id: id, content } as CodeBuddyMessage;
}

function thresholdManager(limit: number): ContextManagerV2 & {
  prepareMessages: ReturnType<typeof vi.fn>;
} {
  const contentChars = (messages: CodeBuddyMessage[]): number => messages.reduce(
    (total, message) => total + (typeof message.content === 'string' ? message.content.length : 0),
    0,
  );
  const prepareMessages = vi.fn((messages: CodeBuddyMessage[]) => messages);
  return {
    getContextEngine: () => null,
    getStats: (messages: CodeBuddyMessage[]) => ({
      totalTokens: contentChars(messages),
      maxTokens: limit,
      usagePercent: (contentChars(messages) / limit) * 100,
      messageCount: messages.length,
      summarizedSessions: 0,
      isNearLimit: contentChars(messages) > limit,
      isCritical: false,
    }),
    shouldAutoCompact: (messages: CodeBuddyMessage[]) => contentChars(messages) > limit,
    prepareMessages,
    prepareMessagesRaw: prepareMessages,
  } as unknown as ContextManagerV2 & { prepareMessages: ReturnType<typeof vi.fn> };
}

describe('prepareTurnMessages tool-output slimming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('compresse la pensée ancienne avant les observations et conserve la pensée du tour courant', () => {
    const manager = thresholdManager(2500);
    // Count native thinking as the real ContextManager does.
    manager.shouldAutoCompact = messages => messages.reduce((total, message) =>
      total + String(message.content ?? '').length + (message.ollama_thinking?.length ?? 0), 0) > 2500;
    const observation = 'Verified dependency finding. '.repeat(30);
    const messages = [
      { ...call('old'), ollama_thinking: 'Old deliberation. '.repeat(1000) }, result('old', observation),
      { ...call('recent'), ollama_thinking: 'Current reasoning must reach Ollama unchanged.' }, result('recent', 'next read'),
    ];
    const prepared = prepareTurnMessages(manager, messages);
    expect(prepared.find(message => message.tool_call_id === 'old')?.content).toBe(observation);
    expect(prepared.find(message => message.role === 'assistant')?.ollama_thinking).toBeUndefined();
    expect(prepared.at(-2)?.ollama_thinking).toBe(messages.at(-2)?.ollama_thinking);
    expect(messages[0]?.ollama_thinking).toContain('Old deliberation.');
  });

  it('slims oldest large results until under threshold without changing pair ids', () => {
    const manager = thresholdManager(250);
    const messages = [
      call('old-1'),
      result('old-1', 'a'.repeat(2_000)),
      call('old-2'),
      result('old-2', 'b'.repeat(2_000)),
      call('recent'),
      result('recent', 'recent output'),
      { role: 'user', content: 'continue' } as CodeBuddyMessage,
    ];

    const prepared = prepareTurnMessages(manager, messages);
    const toolResults = prepared.filter((message) => message.role === 'tool');

    expect(toolResults.map((message) => message.content)).toEqual([
      TRUNCATED_TOOL_OUTPUT_STUB,
      TRUNCATED_TOOL_OUTPUT_STUB,
      'recent output',
    ]);
    expect(toolResults.map((message) => message.tool_call_id)).toEqual([
      'old-1',
      'old-2',
      'recent',
    ]);
    expect(manager.prepareMessages).not.toHaveBeenCalled();
    expect(repairToolCallPairs).not.toHaveBeenCalled();
  });

  it('returns the original canonical transcript when it is clean and under threshold', () => {
    const manager = thresholdManager(10_000);
    const messages = [call('clean'), result('clean', 'small')];

    const prepared = prepareTurnMessages(manager, messages);

    expect(prepared).not.toBe(messages);
    expect(prepared).toEqual(messages);
    expect(manager.prepareMessages).not.toHaveBeenCalled();
    expect(repairToolCallPairs).not.toHaveBeenCalled();
  });

  it('repairs a dirty transcript even when it is under threshold', () => {
    const manager = thresholdManager(10_000);
    const messages = [call('missing')];

    const prepared = prepareTurnMessages(manager, messages);

    expect(repairToolCallPairs).toHaveBeenCalledTimes(1);
    expect(prepared).toEqual([
      call('missing'),
      expect.objectContaining({ role: 'tool', tool_call_id: 'missing' }),
    ]);
  });

  it('ne remplace pas la dernière lecture de C par un stub quand les anciens messages saturent le contexte', () => {
    const manager = thresholdManager(1000);
    const observation = 'export class LicenseGate { /* recent source needed for the edit */ }\n'.repeat(20);
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'Large project context. '.repeat(100) },
      { role: 'user', content: 'Implement and verify signed licenses.' },
      call('old'), result('old', 'Old diagnostic. '.repeat(100)),
      call('recent'), result('recent', observation),
    ];
    const prepared = prepareTurnMessages(manager, messages);
    expect(prepared.find(message => message.role === 'tool' && message.tool_call_id === 'recent')?.content).toBe(observation);
    expect(manager.prepareMessages).toHaveBeenCalled();
    expect(messages.at(-1)?.content).toBe(observation);
  });
});
