/**
 * Pending tool calls survive pre-execution compaction.
 *
 * Bug (reproduced 2026-09-16 on the 2.1.0 release dist and on Windows with
 * qwen3.8:27b at a 4096-token context): the proactive compaction that runs
 * BEFORE a tool executes repaired the transcript while the assistant tool call
 * had no result yet. Transcript repair injected `[result lost during
 * compaction]`; the real result pushed after execution was then a duplicate,
 * and first-wins repair kept the placeholder and dropped the real output. The
 * model re-read the file until max rounds, without an answer.
 *
 * Guarantee under test: calls that are still executing are not "lost"; the
 * provider frontier (`prepareTurnMessages`) still repairs every genuinely
 * orphaned call, so each call reaches the provider with exactly one result,
 * the real one when it exists.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  compactTurnMessagesInPlace,
  prepareTurnMessages,
} from '../../../src/agent/execution/context-pipeline.js';
import { ContextManagerV2 } from '../../../src/context/context-manager-v2.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import type { ContextManagerV2 as ContextManagerType } from '../../../src/context/context-manager-v2.js';

const LOST = '[result lost during compaction]';

/** Same double as /tmp/cb-pending-tool-repro.mjs: under budget, no engine — repair only. */
const repairOnlyManager = {
  getStats: () => ({ isNearLimit: false }),
  shouldAutoCompact: () => false,
  getContextEngine: () => null,
} as unknown as ContextManagerType;

function call(id: string, path: string) {
  return { id, type: 'function' as const, function: { name: 'view_file', arguments: JSON.stringify({ path }) } };
}

function toolResult(id: string, content: string): CodeBuddyMessage {
  return { role: 'tool', tool_call_id: id, name: 'view_file', content } as CodeBuddyMessage;
}

function toolMessages(messages: CodeBuddyMessage[], id: string): CodeBuddyMessage[] {
  return messages.filter((m) => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === id);
}

describe('compactTurnMessagesInPlace with pending tool calls', () => {
  it('sequential: the real result of a call compacted while pending reaches the provider', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Read invoice.json' },
      { role: 'assistant', content: null, tool_calls: [call('call1', 'invoice.json')] } as CodeBuddyMessage,
    ];

    compactTurnMessagesInPlace(repairOnlyManager, messages, { pendingToolCallIds: ['call1'] });
    expect(toolMessages(messages, 'call1')).toEqual([]);

    messages.push(toolResult('call1', '{"invoice":"DS-8F32","total":21.75}'));
    const outgoing = prepareTurnMessages(repairOnlyManager, messages);

    const results = toolMessages(outgoing, 'call1');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('DS-8F32');
    expect(JSON.stringify(outgoing)).not.toContain(LOST);
  });

  it('parallel batch: several pending calls of one assistant message keep their real results', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Compare a and b' },
      { role: 'assistant', content: null, tool_calls: [call('a', 'a.json'), call('b', 'b.json')] } as CodeBuddyMessage,
    ];

    compactTurnMessagesInPlace(repairOnlyManager, messages, { pendingToolCallIds: ['a', 'b'] });
    compactTurnMessagesInPlace(repairOnlyManager, messages, { pendingToolCallIds: ['a', 'b'] });
    messages.push(toolResult('b', 'B-REAL'), toolResult('a', 'A-REAL'));
    const outgoing = prepareTurnMessages(repairOnlyManager, messages);

    expect(outgoing.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    expect(toolMessages(outgoing, 'a').map((m) => m.content)).toEqual(['A-REAL']);
    expect(toolMessages(outgoing, 'b').map((m) => m.content)).toEqual(['B-REAL']);
  });

  it('ordered batches: an executed result stays real and only the still-pending call is protected', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Read both' },
      { role: 'assistant', content: null, tool_calls: [call('first', 'a.json'), call('second', 'b.json')] } as CodeBuddyMessage,
      toolResult('first', 'FIRST-REAL'),
    ];

    compactTurnMessagesInPlace(repairOnlyManager, messages, { pendingToolCallIds: ['second'] });
    expect(toolMessages(messages, 'first').map((m) => m.content)).toEqual(['FIRST-REAL']);
    expect(toolMessages(messages, 'second')).toEqual([]);

    messages.push(toolResult('second', 'SECOND-REAL'));
    const outgoing = prepareTurnMessages(repairOnlyManager, messages);
    expect(toolMessages(outgoing, 'second').map((m) => m.content)).toEqual(['SECOND-REAL']);
    expect(JSON.stringify(outgoing)).not.toContain(LOST);
  });

  it('genuine historical orphans are still repaired, during compaction and at the provider frontier', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'old turn' },
      { role: 'assistant', content: null, tool_calls: [call('old-orphan', 'x.json')] } as CodeBuddyMessage,
      toolResult('ghost', 'result without a call'),
      { role: 'user', content: 'Read invoice.json' },
      { role: 'assistant', content: null, tool_calls: [call('call1', 'invoice.json')] } as CodeBuddyMessage,
    ];

    compactTurnMessagesInPlace(repairOnlyManager, messages, { pendingToolCallIds: ['call1'] });
    expect(toolMessages(messages, 'old-orphan').map((m) => m.content)).toEqual([LOST]);
    expect(toolMessages(messages, 'ghost')).toEqual([]);
    expect(toolMessages(messages, 'call1')).toEqual([]);

    // A call that never gets its result (for example an aborted batch) is
    // still closed before the provider sees the transcript.
    const outgoing = prepareTurnMessages(repairOnlyManager, messages);
    expect(toolMessages(outgoing, 'call1').map((m) => m.content)).toEqual([LOST]);
  });

  it('a pending id that is not the current call does not protect a stale placeholder', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'old turn' },
      { role: 'assistant', content: null, tool_calls: [call('reused', 'x.json')] } as CodeBuddyMessage,
      toolResult('reused', 'OLD-REAL'),
    ];
    compactTurnMessagesInPlace(repairOnlyManager, messages, { pendingToolCallIds: ['reused'] });
    // Already answered: nothing is pending, the existing real result is untouched.
    expect(toolMessages(messages, 'reused').map((m) => m.content)).toEqual(['OLD-REAL']);
  });

  it('real compaction mid-turn keeps the pending assistant call and then its real result', () => {
    const manager = new ContextManagerV2({
      maxContextTokens: 800,
      responseReserveTokens: 100,
      recentMessagesCount: 4,
      enableSummarization: false,
      enableEnhancedCompression: false,
      model: 'gpt-4',
    });
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'user', content: 'Refactor the parser.' },
    ];
    for (let i = 0; i < 30; i++) {
      messages.push({ role: 'assistant', content: '', tool_calls: [call(`tc-${i}`, `src/f${i}.ts`)] } as CodeBuddyMessage);
      messages.push(toolResult(`tc-${i}`, `file ${i}: ${'x'.repeat(400)}`));
    }
    messages.push({ role: 'user', content: 'Now read invoice.json' });
    messages.push({ role: 'assistant', content: null, tool_calls: [call('call1', 'invoice.json')] } as CodeBuddyMessage);
    const before = messages.length;

    const changed = compactTurnMessagesInPlace(manager, messages, { pendingToolCallIds: ['call1'] });
    expect(changed).toBe(true);
    expect(messages.length).toBeLessThan(before);
    expect(messages.some((m) => (m as { tool_calls?: Array<{ id: string }> }).tool_calls?.some((c) => c.id === 'call1'))).toBe(true);
    expect(toolMessages(messages, 'call1')).toEqual([]);

    messages.push(toolResult('call1', '{"invoice":"DS-8F32"}'));
    const outgoing = prepareTurnMessages(manager, messages);
    expect(toolMessages(outgoing, 'call1').map((m) => m.content)).toEqual(['{"invoice":"DS-8F32"}']);
  });

  it('without pending ids the historical behaviour is unchanged (repair closes the open call)', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Read invoice.json' },
      { role: 'assistant', content: null, tool_calls: [call('call1', 'invoice.json')] } as CodeBuddyMessage,
    ];
    compactTurnMessagesInPlace(repairOnlyManager, messages);
    expect(toolMessages(messages, 'call1').map((m) => m.content)).toEqual([LOST]);
  });
});
