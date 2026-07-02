/**
 * P3 — JIT context truncation must not leave broken markdown. A blind substring
 * can cut mid-code-fence so following context reads as if still inside a ```
 * block. truncateJitContent cuts on a boundary and closes any open fence.
 */
import { describe, it, expect } from 'vitest';
import { truncateJitContent } from '../../src/context/jit-context.js';

describe('truncateJitContent (P3)', () => {
  it('returns text unchanged when within budget', () => {
    expect(truncateJitContent('short', 100)).toBe('short');
  });

  it('closes an unterminated code fence left open by the cut', () => {
    // A long doc that opens a fence just before the cap.
    const text = 'x'.repeat(40) + '\n```ts\n' + 'const a = 1;\n'.repeat(50);
    const out = truncateJitContent(text, 80);
    const fences = (out.match(/```/g) || []).length;
    expect(fences % 2).toBe(0); // balanced — the open fence was closed
    expect(out.endsWith('```')).toBe(true);
  });

  it('prefers a structural boundary near the cut', () => {
    const text = 'para one line\n\npara two which is much longer '.padEnd(200, 'z');
    const out = truncateJitContent(text, 40);
    // Cut at the blank line, not mid-word.
    expect(out.startsWith('para one line')).toBe(true);
    expect(out).toContain('...');
  });
});
