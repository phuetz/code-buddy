/**
 * Tests for Transcript Repair — Post-compaction validation
 * (Native Engine v2026.3.11 alignment)
 */

import { describe, it, expect, vi } from 'vitest';
import { repairToolCallPairs } from '../../src/context/transcript-repair.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('repairToolCallPairs', () => {
  it('should pass through valid messages unchanged', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
      } as unknown as CodeBuddyMessage,
      {
        role: 'tool',
        tool_call_id: 'tc-1',
        content: 'file contents',
      } as unknown as CodeBuddyMessage,
      { role: 'assistant', content: 'Here are the contents.' },
    ];

    const result = repairToolCallPairs(messages);
    expect(result.length).toBe(5);
    expect(result).toEqual(messages);
  });

  it('should remove orphaned tool results (tool_call_id with no matching tool_call)', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Hello' },
      {
        role: 'tool',
        tool_call_id: 'orphan-1',
        content: 'orphaned result',
      } as unknown as CodeBuddyMessage,
      { role: 'assistant', content: 'Hi' },
    ];

    const result = repairToolCallPairs(messages);
    expect(result.length).toBe(2);
    expect(result.every(m => m.role !== 'tool')).toBe(true);
  });

  it('should inject synthetic results for tool_calls without matching results', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Run a tool' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tc-1', type: 'function', function: { name: 'bash', arguments: '{}' } },
          { id: 'tc-2', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      } as unknown as CodeBuddyMessage,
      {
        role: 'tool',
        tool_call_id: 'tc-1',
        content: 'bash result',
      } as unknown as CodeBuddyMessage,
      // tc-2 result is missing (lost during compaction)
      { role: 'assistant', content: 'Done.' },
    ];

    const result = repairToolCallPairs(messages);
    // Should inject synthetic result for tc-2
    expect(result.length).toBe(5);

    const syntheticResult = result.find(
      m => m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === 'tc-2'
    );
    expect(syntheticResult).toBeDefined();
    expect(syntheticResult!.content).toBe('[result lost during compaction]');
  });

  it('should handle both orphaned results and missing results simultaneously', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Test' },
      {
        role: 'tool',
        tool_call_id: 'orphan-1',
        content: 'orphaned',
      } as unknown as CodeBuddyMessage,
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'grep', arguments: '{}' } }],
      } as unknown as CodeBuddyMessage,
      // tc-1 result missing
    ];

    const result = repairToolCallPairs(messages);
    // Should remove orphan + inject synthetic for tc-1
    expect(result.length).toBe(3); // user + assistant + synthetic
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[2].role).toBe('tool');
    expect(result[2].content).toBe('[result lost during compaction]');
  });

  it('should handle empty messages array', () => {
    const result = repairToolCallPairs([]);
    expect(result).toEqual([]);
  });

  it('should handle messages with no tool interactions', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];

    const result = repairToolCallPairs(messages);
    expect(result).toEqual(messages);
  });

  it('should not mutate the original messages array', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Test' },
      {
        role: 'tool',
        tool_call_id: 'orphan-1',
        content: 'orphaned',
      } as unknown as CodeBuddyMessage,
    ];

    const originalLength = messages.length;
    repairToolCallPairs(messages);
    expect(messages.length).toBe(originalLength);
  });

  // ─── V1.0 audit follow-ups (M2 — multi-turn scenarios) ──────────────────

  describe('multi-turn scenarios (V1.0 audit)', () => {
    it('handles empty input', () => {
      const result = repairToolCallPairs([]);
      expect(result).toEqual([]);
    });

    it('handles a transcript with no tool calls at all', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: 'a2' },
      ];
      const result = repairToolCallPairs(messages);
      expect(result).toEqual(messages);
    });

    it('repairs orphaned tool result interleaved between two valid pairs', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'multi-step task' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'a', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
        } as unknown as CodeBuddyMessage,
        { role: 'tool', tool_call_id: 'a', content: 'ok-a' } as unknown as CodeBuddyMessage,
        // ORPHAN INTERLEAVED — no matching assistant tool_call.
        { role: 'tool', tool_call_id: 'orphan', content: 'lost' } as unknown as CodeBuddyMessage,
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'b', type: 'function', function: { name: 'view_file', arguments: '{}' } }],
        } as unknown as CodeBuddyMessage,
        { role: 'tool', tool_call_id: 'b', content: 'ok-b' } as unknown as CodeBuddyMessage,
      ];
      const result = repairToolCallPairs(messages);
      // Orphan should be removed; the two valid pairs preserved.
      expect(result.find((m) => 'tool_call_id' in m && (m as { tool_call_id?: string }).tool_call_id === 'orphan')).toBeUndefined();
      expect(result.find((m) => 'tool_call_id' in m && (m as { tool_call_id?: string }).tool_call_id === 'a')).toBeDefined();
      expect(result.find((m) => 'tool_call_id' in m && (m as { tool_call_id?: string }).tool_call_id === 'b')).toBeDefined();
    });

    it('synthesizes missing tool results for assistant tool_calls without matching tool messages', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'tc-x', type: 'function', function: { name: 'view_file', arguments: '{"p":"x"}' } },
          ],
        } as unknown as CodeBuddyMessage,
        // No tool result for tc-x — next message is another user turn (compaction stripped the result).
        { role: 'user', content: 'next question' },
      ];
      const result = repairToolCallPairs(messages);
      // After repair, tc-x must have a synthetic tool result before the next user.
      const idxAssistant = result.findIndex(
        (m) => m.role === 'assistant' && Array.isArray((m as { tool_calls?: unknown[] }).tool_calls),
      );
      const idxNextUser = result.findIndex(
        (m, i) => i > idxAssistant && m.role === 'user' && m.content === 'next question',
      );
      const synthetic = result.slice(idxAssistant + 1, idxNextUser);
      expect(synthetic.length).toBeGreaterThan(0);
      expect(synthetic[0].role).toBe('tool');
      expect((synthetic[0] as { tool_call_id?: string }).tool_call_id).toBe('tc-x');
    });

    it('handles multiple assistant turns each with their own tool_call cluster', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'task A' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'a1', type: 'function', function: { name: 't', arguments: '{}' } }],
        } as unknown as CodeBuddyMessage,
        { role: 'tool', tool_call_id: 'a1', content: 'r-a1' } as unknown as CodeBuddyMessage,
        { role: 'assistant', content: 'done A' },
        { role: 'user', content: 'task B' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'b1', type: 'function', function: { name: 't', arguments: '{}' } }],
        } as unknown as CodeBuddyMessage,
        { role: 'tool', tool_call_id: 'b1', content: 'r-b1' } as unknown as CodeBuddyMessage,
        { role: 'assistant', content: 'done B' },
      ];
      const result = repairToolCallPairs(messages);
      expect(result.length).toBe(messages.length);
      expect(result).toEqual(messages);
    });

    it('preserves order: orphan removal does not reorder remaining messages', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' },
        { role: 'tool', tool_call_id: 'orphan', content: 'lost' } as unknown as CodeBuddyMessage,
        { role: 'assistant', content: 'a' },
      ];
      const result = repairToolCallPairs(messages);
      const roles = result.map((m) => m.role);
      expect(roles).toEqual(['system', 'user', 'assistant']);
    });
  });

  describe('rebuild edge cases (V6 audit — finding 5)', () => {
    const call = (id: string): CodeBuddyMessage =>
      ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 't', arguments: '{}' } }] } as unknown as CodeBuddyMessage);
    const res = (id: string, body = 'r'): CodeBuddyMessage =>
      ({ role: 'tool', tool_call_id: id, content: body } as unknown as CodeBuddyMessage);

    it('is idempotent — repairing a repaired transcript is a no-op', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'q' },
        call('a1'), // no result → synthetic injected
        res('orphan'), // orphan → removed
      ];
      const once = repairToolCallPairs(messages);
      const twice = repairToolCallPairs(once);
      expect(twice).toEqual(once);
      // Every tool result references a surviving call.
      const callIds = new Set(once.flatMap((m) => ((m as { tool_calls?: Array<{ id: string }> }).tool_calls ?? []).map((c) => c.id)));
      expect(once.every((m) => m.role !== 'tool' || callIds.has((m as { tool_call_id: string }).tool_call_id))).toBe(true);
    });

    it('strips an id-less tool_call (unpairable) and demotes an assistant left with none', () => {
      const idless = { role: 'assistant', content: 'x', tool_calls: [{ type: 'function', function: { name: 't', arguments: '{}' } }] } as unknown as CodeBuddyMessage;
      const result = repairToolCallPairs([{ role: 'user', content: 'q' }, idless]);
      expect(result).toHaveLength(2);
      expect((result[1] as { tool_calls?: unknown }).tool_calls).toBeUndefined();
      expect(result.some((m) => m.role === 'tool')).toBe(false);
    });

    it('keeps only the FIRST of two calls sharing an id (protocol corruption)', () => {
      const messages: CodeBuddyMessage[] = [call('dup'), res('dup', 'first'), call('dup'), res('dup', 'second')];
      const result = repairToolCallPairs(messages);
      const toolMsgs = result.filter((m) => m.role === 'tool');
      expect(toolMsgs).toHaveLength(1);
      expect((toolMsgs[0] as { content: string }).content).toBe('first');
      // The second assistant lost its duplicate call and carries no tool_calls.
      const assistants = result.filter((m) => m.role === 'assistant');
      expect(assistants).toHaveLength(2);
    });

    it('relocates a result that appeared BEFORE its call to the canonical slot', () => {
      const messages: CodeBuddyMessage[] = [res('a1', 'early'), call('a1')];
      const result = repairToolCallPairs(messages);
      const idx = { assistant: result.findIndex((m) => m.role === 'assistant'), tool: result.findIndex((m) => m.role === 'tool') };
      expect(idx.tool).toBe(idx.assistant + 1); // result now follows its call
      expect((result[idx.tool] as { content: string }).content).toBe('early'); // real result kept, not synthetic
    });

    it('drops a duplicate result for one id, keeping the first', () => {
      const messages: CodeBuddyMessage[] = [call('a1'), res('a1', 'keep'), res('a1', 'drop')];
      const result = repairToolCallPairs(messages);
      const toolMsgs = result.filter((m) => m.role === 'tool');
      expect(toolMsgs).toHaveLength(1);
      expect((toolMsgs[0] as { content: string }).content).toBe('keep');
    });
  });
});
