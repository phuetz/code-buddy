import { describe, it, expect } from 'vitest';
import {
  findPrecedingUserIndex,
  normaliseContent,
  computeRegenerationPlan,
} from '../src/renderer/utils/regenerate-helpers';
import type { Message } from '../src/renderer/types';

function userMsg(id: string, text: string): Message {
  return {
    id,
    sessionId: 'session-1',
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 0,
  } as Message;
}

function assistantMsg(id: string, text: string): Message {
  return {
    id,
    sessionId: 'session-1',
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0,
  } as Message;
}

describe('regenerate-helpers', () => {
  describe('findPrecedingUserIndex', () => {
    it('returns -1 when assistant message id not found', () => {
      const msgs = [userMsg('u1', 'hi')];
      expect(findPrecedingUserIndex(msgs, 'unknown')).toBe(-1);
    });

    it('finds the immediately-preceding user message', () => {
      const msgs = [userMsg('u1', 'hi'), assistantMsg('a1', 'hello')];
      expect(findPrecedingUserIndex(msgs, 'a1')).toBe(0);
    });

    it('walks back past intervening assistant/tool messages', () => {
      const msgs = [
        userMsg('u1', 'hi'),
        assistantMsg('a1', 'hello'),
        assistantMsg('a2', 'follow-up'),
      ];
      // a2's preceding user message is u1 (a1 is assistant, walk past it)
      expect(findPrecedingUserIndex(msgs, 'a2')).toBe(0);
    });

    it('finds the latest user when several precede', () => {
      const msgs = [
        userMsg('u1', 'q1'),
        assistantMsg('a1', 'r1'),
        userMsg('u2', 'q2'),
        assistantMsg('a2', 'r2'),
      ];
      expect(findPrecedingUserIndex(msgs, 'a2')).toBe(2);
    });

    it('returns -1 when assistant is the first message (no user before)', () => {
      const msgs = [assistantMsg('a1', 'orphan')];
      expect(findPrecedingUserIndex(msgs, 'a1')).toBe(-1);
    });
  });

  describe('normaliseContent', () => {
    it('passes through ContentBlock arrays', () => {
      const blocks = [{ type: 'text' as const, text: 'hi' }];
      expect(normaliseContent(blocks)).toEqual(blocks);
    });

    it('wraps a string into a single text block', () => {
      expect(normaliseContent('hello' as unknown as Message['content'])).toEqual([
        { type: 'text', text: 'hello' },
      ]);
    });

    it('handles null/undefined as empty text', () => {
      expect(normaliseContent(null as unknown as Message['content'])).toEqual([
        { type: 'text', text: '' },
      ]);
      expect(normaliseContent(undefined as unknown as Message['content'])).toEqual([
        { type: 'text', text: '' },
      ]);
    });
  });

  describe('computeRegenerationPlan', () => {
    it('returns null for user message (only assistant is regeneratable)', () => {
      const msgs = [userMsg('u1', 'hi'), assistantMsg('a1', 'hello')];
      expect(computeRegenerationPlan(msgs, msgs[0])).toBeNull();
    });

    it('returns null when assistant has no preceding user message', () => {
      const orphan = assistantMsg('a1', 'orphan');
      expect(computeRegenerationPlan([orphan], orphan)).toBeNull();
    });

    it('returns sliced messages (drops user + everything after) for last assistant turn', () => {
      const msgs = [userMsg('u1', 'hi'), assistantMsg('a1', 'hello')];
      const plan = computeRegenerationPlan(msgs, msgs[1]);
      expect(plan).not.toBeNull();
      expect(plan!.slicedMessages).toEqual([]);
      expect(plan!.replayContent).toEqual([{ type: 'text', text: 'hi' }]);
    });

    it('preserves earlier conversation history when regenerating mid-thread', () => {
      const msgs = [
        userMsg('u1', 'q1'),
        assistantMsg('a1', 'r1'),
        userMsg('u2', 'q2'),
        assistantMsg('a2', 'r2'),
      ];
      const plan = computeRegenerationPlan(msgs, msgs[3]);
      expect(plan).not.toBeNull();
      expect(plan!.slicedMessages).toHaveLength(2);
      expect(plan!.slicedMessages.map((m) => m.id)).toEqual(['u1', 'a1']);
      expect(plan!.replayContent).toEqual([{ type: 'text', text: 'q2' }]);
    });
  });
});
