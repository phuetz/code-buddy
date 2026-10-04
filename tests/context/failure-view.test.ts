import { describe, expect, it } from 'vitest';
import { annotateSuccessLines, ensureFailureVisible, exitCodeFromText, failureHeaderFor } from '../../src/context/failure-view.js';

describe('failure view', () => {
  it('reads the last real exit status, host or sandbox wording', () => {
    expect(exitCodeFromText('x\n[sandbox:landlock; exit code 2]')).toBe(2);
    expect(exitCodeFromText('Exit code 127')).toBe(127);
    expect(exitCodeFromText('no status here', 1)).toBe(1);
    expect(exitCodeFromText('exit code 0 then exit code 3')).toBe(3);
  });

  it('annotates success summaries but not ordinary lines', () => {
    const { text, marked } = annotateSuccessLines('make: completed\n0 failed, 3 passed\nok\nbuilding ok.o\ndone', 2);
    expect(marked).toBe(4);
    expect(text).toContain('make: completed  (despite exit 2: the command FAILED)');
    expect(text).toContain('building ok.o\n');
  });

  it('prefers keyword lines over file:line decoys and ignores success lines', () => {
    const raw = [...Array.from({ length: 60 }, (_, i) => `ok src/p${i}.ts:${i}`), 'x', 'FAIL real cause', 'tail'].join('\n');
    const header = failureHeaderFor(raw, 'reduced', 1);
    expect(header).toContain('FAIL real cause');
    expect(header).not.toContain('ok src/p0.ts');
  });

  it('keeps the cause of a very long line and recognises crashes', () => {
    const raw = `${'z'.repeat(900)} boom (src/a.ts:9) ${'z'.repeat(900)}\n1 test, 0 passed, 1 crashed`;
    const header = failureHeaderFor(raw, '', 3);
    expect(header).toContain('src/a.ts:9');
    expect(header).toContain('1 crashed');
  });

  it('ensureFailureVisible: header only when reduced or contradicted; small plain failure untouched', () => {
    expect(ensureFailureVisible('Error: nope', 'Error: nope', 1, false)).toBe('Error: nope');
    expect(ensureFailureVisible('make: completed', 'FAIL cause\nmake: completed', 2, true)).toMatch(/^\[command failed: exit 2\][\s\S]*FAIL cause[\s\S]*make: completed {2}\(despite exit 2/);
    expect(ensureFailureVisible('all fine\nok', 'all fine\nok', 1, false)).toMatch(/^\[command failed: exit 1\]/);
  });
});
