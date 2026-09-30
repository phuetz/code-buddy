import { describe, expect, it } from 'vitest';
import { normalizeReplacementArguments } from '../../src/tools/registry/replacement-arguments.js';
const old = 'const greeting = "hello";;';
const next = "const greeting = 'hello';";
describe('literal editor argument forms captured on Colab', () => {
  it.each([
    { operations: `[replace_text, old_text=${JSON.stringify(old)}, new_text=${JSON.stringify(next)}]` },
    { operations: `[replace, new_text=${JSON.stringify(next)}, old_text='${old}']` },
    { changes: `${old} -> ${next}` },
    { changes: `old: ${old}\nnew: ${next}` },
    { changes: `---\nold: |\n${old}\nconsole.log(greeting);\n\nnew: |\n${next}\nconsole.log(greeting);` },
    { changes: `---\nindex.js\n+++ index.js\n@@ -1,3 +1,3 @@\n-${old}\n+${next}\n console.log(greeting);\n ` },
  ])('extracts one literal before/after pair from %j', args => {
    const normalized = normalizeReplacementArguments(args);
    expect(normalized.edits).toHaveLength(1);
    expect(normalized.edits[0]?.old_string).toContain(old);
    expect(normalized.edits[0]?.new_string).toContain(next);
  });
  it('rejects a regex flag instead of silently interpreting it as literal', () => {
    expect(() => normalizeReplacementArguments({ pattern: '.*', replacement: 'lost', regex: true })).toThrow('regex');
  });
  it('requires an old text for a proposed whole-file overwrite', () => {
    expect(() => normalizeReplacementArguments({ operations: '[replace, new_content="replacement only"]' })).toThrow(/old_str|before/);
  });
  it('never evaluates expressions in a textual operation', () => {
    expect(() => normalizeReplacementArguments({ operations: '[replace, old_text=process.env.SECRET, new_text="x"]' })).toThrow();
  });
});
