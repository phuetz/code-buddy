/**
 * Property-based tests for transcript repair + Anthropic conversion.
 * Seed fixed: 20261005. CI runs: 200 (prop discovery used ≥1000).
 *
 * P1–P3,P5,P6: OpenAI Chat Completions tool pairing (docs + isCanonical
 *   in transcript-repair-hardening.test.ts + repair rebuild contract).
 * P4: Anthropic Messages API (docs) + toAnthropicMessages
 *   (src/providers/_shared/anthropic-messages.ts); previously broken by
 *   ClaudeProvider.formatMessages emitting one user msg per tool_result.
 */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { repairToolCallPairs } from '../../src/context/transcript-repair.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { hasToolCalls } from '../../src/codebuddy/client.js';
import {
  toAnthropicMessages,
  isValidAnthropicMessageOrder,
} from '../../src/providers/_shared/anthropic-messages.js';

export const PROP_SEED = 20261005;
const CI_RUNS = 200;

function user(content: string): CodeBuddyMessage {
  return { role: 'user', content };
}
function system(content: string): CodeBuddyMessage {
  return { role: 'system', content };
}
function assistant(content: string | null, tool_calls?: CodeBuddyMessage extends never ? never : Array<{ id?: string; type: 'function'; function: { name: string; arguments: string } }>): CodeBuddyMessage {
  const m: Record<string, unknown> = { role: 'assistant', content };
  if (tool_calls) m.tool_calls = tool_calls;
  return m as CodeBuddyMessage;
}
function tool(id: string, content: string): CodeBuddyMessage {
  return { role: 'tool', tool_call_id: id, content } as CodeBuddyMessage;
}
function tc(id: string | undefined, name = 'bash') {
  const o: { id?: string; type: 'function'; function: { name: string; arguments: string } } = {
    type: 'function',
    function: { name, arguments: '{}' },
  };
  if (id) o.id = id;
  return o;
}

const arbId = fc.constantFrom('a', 'b', 'c', 'd', 'dup', 'tc-1', 'tc-2', '');
const arbContent = fc.constantFrom('', 'hi', 'x', 'q', 'hello');
const arbTc = fc.oneof(
  arbId.map((id) => tc(id || undefined)),
  fc.constant(tc(undefined)),
);
const arbMsg: fc.Arbitrary<CodeBuddyMessage> = fc.oneof(
  arbContent.map(user),
  arbContent.map(system),
  arbContent.map((c) => assistant(c)),
  fc
    .tuple(arbContent, fc.array(arbTc, { minLength: 1, maxLength: 3 }))
    .map(([c, tool_calls]) => assistant(c || null, tool_calls)),
  fc.tuple(arbId, arbContent).map(([id, c]) => tool(id || 'orphan', c)),
);
const arbSuite = fc.array(arbMsg, { minLength: 0, maxLength: 10 });

function callIds(messages: CodeBuddyMessage[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    if (hasToolCalls(m)) {
      for (const c of m.tool_calls) if (c.id) ids.push(c.id);
    }
  }
  return ids;
}

/** P1 */
function checkP1(msgs: CodeBuddyMessage[]): boolean {
  const calls = callIds(msgs);
  if (new Set(calls).size !== calls.length) return false;
  const counts = new Map<string, number>();
  for (const m of msgs) {
    if (m.role !== 'tool') continue;
    const id = (m as { tool_call_id?: string }).tool_call_id;
    if (!id) return false;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return calls.every((id) => counts.get(id) === 1);
}

/** P2 */
function checkP2(msgs: CodeBuddyMessage[]): boolean {
  const set = new Set(callIds(msgs));
  return msgs.every((m) => {
    if (m.role !== 'tool') return true;
    const id = (m as { tool_call_id?: string }).tool_call_id;
    return !!id && set.has(id);
  });
}

/** P3 OpenAI order */
function checkP3(msgs: CodeBuddyMessage[]): boolean {
  const pending: string[] = [];
  for (const m of msgs) {
    if (m.role === 'tool') {
      const id = (m as { tool_call_id?: string }).tool_call_id;
      if (!pending.length || pending[0] !== id) return false;
      pending.shift();
      continue;
    }
    if (pending.length) return false;
    if (hasToolCalls(m)) {
      if (!m.tool_calls.length) return false;
      for (const c of m.tool_calls) {
        if (!c.id) return false;
        pending.push(c.id);
      }
    }
  }
  return pending.length === 0;
}

/** P4 Anthropic after conversion */
function checkP4(msgs: CodeBuddyMessage[]): boolean {
  const { messages } = toAnthropicMessages(msgs);
  return isValidAnthropicMessageOrder(messages);
}

/** P5 */
function checkP5(msgs: CodeBuddyMessage[]): boolean {
  const once = repairToolCallPairs(msgs);
  return JSON.stringify(repairToolCallPairs(once)) === JSON.stringify(once);
}

/** P6 */
function checkP6(original: CodeBuddyMessage[], repaired: CodeBuddyMessage[]): boolean {
  const users = (m: CodeBuddyMessage[]) => m.filter((x) => x.role === 'user').map((x) => x.content);
  const a = users(original);
  const b = users(repaired);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function simulateCompaction(msgs: CodeBuddyMessage[], dropCount: number): CodeBuddyMessage[] {
  const systems = msgs.filter((m) => m.role === 'system');
  const rest = msgs.filter((m) => m.role !== 'system');
  const compacted = rest.slice();
  for (let i = 0; i < dropCount && compacted.length > 2; i++) {
    const idx = 1 + (i % Math.max(1, compacted.length - 2));
    compacted.splice(idx, 1);
  }
  return [...systems, ...compacted];
}

describe('repairToolCallPairs properties (fast-check)', () => {
  it('P1: each tool_call has exactly one result', () => {
    fc.assert(
      fc.property(arbSuite, (msgs) => checkP1(repairToolCallPairs(msgs))),
      { seed: PROP_SEED, numRuns: CI_RUNS },
    );
  });

  it('P2: no orphan tool results', () => {
    fc.assert(
      fc.property(arbSuite, (msgs) => checkP2(repairToolCallPairs(msgs))),
      { seed: PROP_SEED, numRuns: CI_RUNS },
    );
  });

  it('P3: OpenAI tool order (results immediately after calling assistant)', () => {
    fc.assert(
      fc.property(arbSuite, (msgs) => checkP3(repairToolCallPairs(msgs))),
      { seed: PROP_SEED, numRuns: CI_RUNS },
    );
  });

  it('P4: Anthropic order after toAnthropicMessages(repair(x))', () => {
    fc.assert(
      fc.property(arbSuite, (msgs) => checkP4(repairToolCallPairs(msgs))),
      { seed: PROP_SEED, numRuns: CI_RUNS },
    );
  });

  it('P5: idempotence repair(repair(x)) == repair(x)', () => {
    fc.assert(
      fc.property(arbSuite, (msgs) => checkP5(msgs)),
      { seed: PROP_SEED, numRuns: CI_RUNS },
    );
  });

  it('P6: no loss of user messages', () => {
    fc.assert(
      fc.property(arbSuite, (msgs) => {
        const repaired = repairToolCallPairs(msgs);
        return checkP6(msgs, repaired);
      }),
      { seed: PROP_SEED, numRuns: CI_RUNS },
    );
  });

  it('P1+P3+P5+P6 after simulated compaction+repair', () => {
    fc.assert(
      fc.property(arbSuite, fc.integer({ min: 0, max: 5 }), (msgs, drop) => {
        const input = simulateCompaction(msgs, drop);
        const repaired = repairToolCallPairs(input);
        return (
          checkP1(repaired) &&
          checkP3(repaired) &&
          checkP5(input) &&
          checkP6(input, repaired) &&
          checkP4(repaired)
        );
      }),
      { seed: PROP_SEED, numRuns: CI_RUNS },
    );
  });
});

describe('minimal counterexamples (P4 / old Claude conversion)', () => {
  /** Shrunk cases that failed Anthropic checks under the old per-tool user emission. */
  it('multi-tool assistant: tool_results merge into one following user message', () => {
    const input: CodeBuddyMessage[] = [
      user('q'),
      assistant(null, [tc('a', 'bash'), tc('b', 'grep')]),
    ];
    const repaired = repairToolCallPairs(input);
    expect(checkP1(repaired) && checkP3(repaired)).toBe(true);
    const { messages } = toAnthropicMessages(repaired);
    expect(isValidAnthropicMessageOrder(messages)).toBe(true);
    const toolUser = messages.find(
      (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
    );
    expect(toolUser).toBeDefined();
    expect(Array.isArray(toolUser!.content) && toolUser!.content.filter((b) => b.type === 'tool_result')).toHaveLength(2);
  });

  it('transcript starting with assistant: conversion prepends a user turn', () => {
    const repaired = repairToolCallPairs([
      assistant(null, [tc('a')]),
    ]);
    const { messages } = toAnthropicMessages(repaired);
    expect(messages[0]?.role).toBe('user');
    expect(isValidAnthropicMessageOrder(messages)).toBe(true);
  });

  it('consecutive assistants after repair: conversion merges same-role turns', () => {
    const repaired = repairToolCallPairs([
      user('q'),
      assistant('thinking'),
      assistant(null, [tc('a')]),
    ]);
    const { messages } = toAnthropicMessages(repaired);
    expect(isValidAnthropicMessageOrder(messages)).toBe(true);
  });

  it('legacy per-tool user emission would violate Anthropic alternation (documentation)', () => {
    // Old ClaudeProvider.formatMessages behavior (pre-fix): one user msg per tool.
    const repaired = repairToolCallPairs([
      user('q'),
      assistant(null, [tc('a'), tc('b')]),
    ]);
    const legacy: Array<{ role: string }> = [];
    for (const msg of repaired) {
      if (msg.role === 'system') continue;
      if (msg.role === 'tool') {
        legacy.push({ role: 'user' });
      } else if (msg.role === 'assistant' && hasToolCalls(msg)) {
        legacy.push({ role: 'assistant' });
      } else {
        legacy.push({ role: msg.role === 'user' ? 'user' : 'assistant' });
      }
    }
    let consec = false;
    for (let i = 1; i < legacy.length; i++) {
      if (legacy[i]!.role === legacy[i - 1]!.role) consec = true;
    }
    expect(consec).toBe(true); // documents the old bug
    expect(checkP4(repaired)).toBe(true); // fixed converter
  });
});
