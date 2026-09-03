/**
 * Tests for src/context/tool-pair-preserver.ts (post-audit fix derived
 * from Claude Code source comparison 2026-05-04, see
 * private-handover-repo/propositions/AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md).
 *
 * These tests exercise the pure function `preserveToolPairs(kept, original)`
 * directly — NOT through SmartCompactionEngine.compact() — so we don't
 * have to calibrate token sizes to force specific budget cuts. Each
 * test crafts a "kept" subset that exhibits a specific orphan pattern
 * and asserts the rescue logic re-injects the missing parent in
 * chronological order.
 */

import { describe, it, expect } from 'vitest';
import { preserveToolPairs } from '../../src/context/tool-pair-preserver.js';
import type { Message } from '../../src/context/smart-compaction.js';

// ---- helpers ---------------------------------------------------------

function userMsg(content: string): Message {
  return { role: 'user', content };
}
function asstMsg(content: string | null, toolCalls?: Array<{ id: string; name?: string; args?: string }>): Message {
  return {
    role: 'assistant',
    content,
    tool_calls: toolCalls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name ?? 'noop', arguments: tc.args ?? '{}' },
    })),
  };
}
function toolMsg(toolCallId: string, content: string): Message {
  return { role: 'tool', content, tool_call_id: toolCallId };
}

// ---- tests -----------------------------------------------------------

describe('preserveToolPairs', () => {
  describe('no-op cases', () => {
    it('returns kept unchanged when no tool_result is present', () => {
      const original = [userMsg('a'), asstMsg('b'), userMsg('c')];
      const kept = [asstMsg('b'), userMsg('c')];
      const out = preserveToolPairs(kept, original);
      expect(out).toBe(kept); // same reference — no-op fast path
    });

    it('returns kept unchanged when every tool_result has its parent in kept', () => {
      const a = userMsg('a');
      const b = asstMsg('b', [{ id: 'call_1' }]);
      const c = toolMsg('call_1', 'r1');
      const d = asstMsg('d');
      const original = [a, b, c, d];
      const kept = [b, c, d]; // both halves of the pair are kept
      const out = preserveToolPairs(kept, original);
      // Same content, no rescue needed (we may get the same reference or not)
      expect(out).toEqual(kept);
    });

    it('returns kept unchanged when all kept tool_results pair with kept parents (multi pairs)', () => {
      const u1 = userMsg('u1');
      const a1 = asstMsg('a1', [{ id: 'call_1' }]);
      const t1 = toolMsg('call_1', 'r1');
      const a2 = asstMsg('a2', [{ id: 'call_2' }]);
      const t2 = toolMsg('call_2', 'r2');
      const original = [u1, a1, t1, a2, t2];
      const kept = [a1, t1, a2, t2];
      const out = preserveToolPairs(kept, original);
      expect(out).toEqual(kept);
    });
  });

  describe('parent rescue cases', () => {
    it('re-inserts a missing tool_call parent at its original-order position', () => {
      const u1 = userMsg('u1');
      const a1 = asstMsg('thinking', [{ id: 'call_1', name: 'view_file' }]);
      const t1 = toolMsg('call_1', 'file contents');
      const u2 = userMsg('u2');
      const a2 = asstMsg('done');
      const original = [u1, a1, t1, u2, a2];
      // Simulate truncate: kept the tool_result + later messages but
      // dropped a1 (the parent). Without the fix, t1 is orphaned.
      const kept = [t1, u2, a2];

      const out = preserveToolPairs(kept, original);

      // Parent must be re-injected
      expect(out).toContain(a1);
      // ...AND placed BEFORE its tool_result (chronological order
      // preserved from `original`).
      expect(out.indexOf(a1)).toBeLessThan(out.indexOf(t1));
      // u2 and a2 still present, in their original order
      expect(out.indexOf(t1)).toBeLessThan(out.indexOf(u2));
      expect(out.indexOf(u2)).toBeLessThan(out.indexOf(a2));
      // Original `kept` not mutated
      expect(kept).toEqual([t1, u2, a2]);
    });

    it('handles a parent that emits MULTIPLE tool_calls (rescues whole parent, not just one)', () => {
      const u1 = userMsg('u1');
      const a1 = asstMsg('parallel', [
        { id: 'call_1', name: 'view_file' },
        { id: 'call_2', name: 'search' },
      ]);
      const t1 = toolMsg('call_1', 'r1');
      // call_2's result was already cut (not in kept)
      const u2 = userMsg('u2');
      const original = [u1, a1, t1, u2];
      const kept = [t1, u2];

      const out = preserveToolPairs(kept, original);

      const rescued = out.find((m) => m.tool_calls?.some((tc) => tc.id === 'call_1'));
      expect(rescued).toBe(a1); // exact reference — we don't mutate
      // The parent retains BOTH tool_calls (we don't strip the unmatched call_2)
      expect(rescued!.tool_calls).toHaveLength(2);
      expect(rescued!.tool_calls?.map((tc) => tc.id)).toEqual(['call_1', 'call_2']);
    });

    it('rescues a parent ONCE even when MULTIPLE tool_results from it are kept', () => {
      const u1 = userMsg('u1');
      const a1 = asstMsg('parallel', [{ id: 'call_1' }, { id: 'call_2' }]);
      const t1 = toolMsg('call_1', 'r1');
      const t2 = toolMsg('call_2', 'r2');
      const u2 = userMsg('u2');
      const original = [u1, a1, t1, t2, u2];
      const kept = [t1, t2, u2];

      const out = preserveToolPairs(kept, original);

      const parents = out.filter((m) => m.tool_calls?.some((tc) => tc.id === 'call_1' || tc.id === 'call_2'));
      // Parent appears EXACTLY once even though 2 results need it
      expect(parents).toHaveLength(1);
      expect(parents[0]).toBe(a1);
    });

    it('rescues MULTIPLE parents when their respective results are orphaned', () => {
      const u1 = userMsg('u1');
      const a1 = asstMsg('first', [{ id: 'call_a' }]);
      const t1 = toolMsg('call_a', 'ra');
      const u2 = userMsg('between');
      const a2 = asstMsg('second', [{ id: 'call_b' }]);
      const t2 = toolMsg('call_b', 'rb');
      const u3 = userMsg('u3');
      const original = [u1, a1, t1, u2, a2, t2, u3];
      // Keep both tool_results + last user, drop both parents + middle user.
      const kept = [t1, t2, u3];

      const out = preserveToolPairs(kept, original);

      expect(out).toContain(a1);
      expect(out).toContain(a2);
      // Both parents in chronological order
      expect(out.indexOf(a1)).toBeLessThan(out.indexOf(a2));
      expect(out.indexOf(a1)).toBeLessThan(out.indexOf(t1));
      expect(out.indexOf(a2)).toBeLessThan(out.indexOf(t2));
    });

    it('only re-injects parents needed by orphan results — leaves unrelated assistant messages out', () => {
      const u1 = userMsg('u1');
      const irrelevant = asstMsg('chitchat'); // no tool_calls — not a parent of anything
      const a1 = asstMsg('actual parent', [{ id: 'call_1' }]);
      const t1 = toolMsg('call_1', 'r1');
      const u2 = userMsg('u2');
      const original = [u1, irrelevant, a1, t1, u2];
      const kept = [t1, u2]; // a1 is orphaned, irrelevant is not needed

      const out = preserveToolPairs(kept, original);

      expect(out).toContain(a1); // rescued
      expect(out).not.toContain(irrelevant); // NOT rescued (not a needed parent)
      expect(out).not.toContain(u1); // NOT rescued (not in kept and not a parent)
    });

    it('handles partial coverage: some pairs kept, some need rescue', () => {
      const a1 = asstMsg('a1', [{ id: 'call_1' }]);
      const t1 = toolMsg('call_1', 'r1');
      const u = userMsg('u');
      const a2 = asstMsg('a2', [{ id: 'call_2' }]);
      const t2 = toolMsg('call_2', 'r2');
      const original = [a1, t1, u, a2, t2];
      // a1 + t1 stayed together; t2 lost its parent a2
      const kept = [a1, t1, u, t2];

      const out = preserveToolPairs(kept, original);

      // a2 rescued
      expect(out).toContain(a2);
      // a1 + t1 still as a kept pair, no duplication
      expect(out.filter((m) => m === a1)).toHaveLength(1);
      // Order preserved end-to-end
      expect(out.map((m) => original.indexOf(m))).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('input safety', () => {
    it('never mutates the inputs', () => {
      const a1 = asstMsg('parent', [{ id: 'call_1' }]);
      const t1 = toolMsg('call_1', 'r1');
      const original = [userMsg('u'), a1, t1];
      const kept = [t1];
      const originalCopy = [...original];
      const keptCopy = [...kept];

      preserveToolPairs(kept, original);

      expect(original).toEqual(originalCopy);
      expect(kept).toEqual(keptCopy);
    });

    it('handles empty arrays gracefully', () => {
      expect(preserveToolPairs([], [])).toEqual([]);
      expect(preserveToolPairs([], [userMsg('a')])).toEqual([]);
    });

    it('returns kept reference when nothing needs rescuing (allows fast equality checks)', () => {
      const kept = [userMsg('a'), asstMsg('b')];
      const out = preserveToolPairs(kept, kept);
      expect(out).toBe(kept);
    });
  });
});
