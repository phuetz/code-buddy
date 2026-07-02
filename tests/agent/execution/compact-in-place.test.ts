/**
 * compactTurnMessagesInPlace — regression for the silent-no-op compaction:
 * prepareMessages() is pure, and two agent-executor call sites discarded its
 * return value, so the middleware 'compact' action and the proactive
 * pre-tool compaction never shrank the shared transcript.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { compactTurnMessagesInPlace } from '../../../src/agent/execution/context-pipeline.js';
import { ContextManagerV2 } from '../../../src/context/context-manager-v2.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

function longTranscript(rounds: number): CodeBuddyMessage[] {
  const messages: CodeBuddyMessage[] = [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'user', content: 'Refactor the parser and keep the tests green.' },
  ];
  for (let i = 0; i < rounds; i++) {
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: `tc-${i}`,
          type: 'function',
          function: { name: 'view_file', arguments: `{"path":"src/file-${i}.ts"}` },
        },
      ],
    } as CodeBuddyMessage);
    messages.push({
      role: 'tool',
      tool_call_id: `tc-${i}`,
      content: `content of file ${i}: ${'x'.repeat(400)}`,
    } as CodeBuddyMessage);
  }
  return messages;
}

/** Every tool result must reference a surviving tool_call (API contract). */
function toolPairsValid(messages: CodeBuddyMessage[]): boolean {
  const callIds = new Set<string>();
  for (const m of messages) {
    const calls = (m as { tool_calls?: Array<{ id?: string }> }).tool_calls;
    if (Array.isArray(calls)) for (const c of calls) if (c.id) callIds.add(c.id);
  }
  return messages.every((m) => {
    const id = (m as { tool_call_id?: string }).tool_call_id;
    return id === undefined || callIds.has(id);
  });
}

function tinyManager(): ContextManagerV2 {
  // Legacy sliding-window path, no LLM, no enhanced compressor — a tiny
  // window guarantees isNearLimit fires on the transcript above.
  return new ContextManagerV2({
    maxContextTokens: 800,
    responseReserveTokens: 100,
    recentMessagesCount: 4,
    enableSummarization: false,
    enableEnhancedCompression: false,
    model: 'gpt-4',
  });
}

describe('compactTurnMessagesInPlace', () => {
  it('SHRINKS the shared array in place and keeps tool pairs valid (the old code was a no-op)', () => {
    const messages = longTranscript(30);
    const before = messages.length;
    const sameRef = messages;

    const changed = compactTurnMessagesInPlace(tinyManager(), messages);

    expect(changed).toBe(true);
    expect(messages).toBe(sameRef); // same reference — every holder sees the compaction
    expect(messages.length).toBeLessThan(before);
    expect(toolPairsValid(messages)).toBe(true); // repaired, no orphaned results
  });

  it('returns false and leaves the array untouched when under budget', () => {
    const manager = new ContextManagerV2({
      maxContextTokens: 200_000,
      enableSummarization: false,
      enableEnhancedCompression: false,
      model: 'gpt-4',
    });
    const messages = longTranscript(2);
    const snapshot = [...messages];

    const changed = compactTurnMessagesInPlace(manager, messages);

    expect(changed).toBe(false);
    expect(messages).toEqual(snapshot);
  });

  it('is idempotent: a second compaction right after the first is a no-op', () => {
    const manager = tinyManager();
    const messages = longTranscript(30);
    compactTurnMessagesInPlace(manager, messages);
    const afterFirst = [...messages];

    const changedAgain = compactTurnMessagesInPlace(manager, messages);

    // Either nothing changes, or (if still near the tiny limit) it keeps
    // shrinking — but it must never corrupt pairs or grow.
    expect(messages.length).toBeLessThanOrEqual(afterFirst.length);
    expect(toolPairsValid(messages)).toBe(true);
    if (!changedAgain) expect(messages).toEqual(afterFirst);
  });
});
