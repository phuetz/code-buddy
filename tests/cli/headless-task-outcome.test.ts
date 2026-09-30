import { describe, expect, it } from 'vitest';
import { resolveHeadlessTurnExitCode } from '../../src/cli/headless-options.js';

const result = (name: string, command: string, success: boolean) => ({
  type: 'tool_result', content: success ? 'OK' : 'Tests failed',
  toolCall: { id: 'call', function: { name, arguments: JSON.stringify({ command }) } },
  toolResult: { success },
});

describe('headless task evidence', () => {
  const exit = (prompt: string, entries: ReturnType<typeof result>[], text = 'All fixed.') =>
    resolveHeadlessTurnExitCode(text, ['bash', 'str_replace_editor'], entries.map(e => e.toolCall.function.name), { prompt, entries });

  it.each(Array.from({ length: 5 }, (_, i) => i))('rejects an unexecuted modification, replay %i', () => {
    expect(exit('run tests and fix failures', [])).toBe(1);
  });
  it('does not count repository reads as a modification', () => {
    expect(exit('corrige les erreurs ESLint', [result('view_file', '', true)])).toBe(1);
  });
  it.each(['make the failing tests pass', 'ensure the tests pass', 'fais passer les tests', 'rends ce code fonctionnel'])('requires execution for %s', prompt => {
    expect(exit(prompt, [])).toBe(1);
  });
  it('rejects a verification still red despite the claimed fix', () => {
    expect(exit('run tests and fix failures', [result('bash', 'npm test', false), result('str_replace_editor', 'str_replace', true)])).toBe(1);
  });
  it('accepts red then green for the same verification', () => {
    expect(exit('run tests and fix failures', [result('bash', 'npm test', false), result('str_replace_editor', 'str_replace', true), result('bash', 'npm test', true)])).toBe(0);
  });
  it('does not let a green test erase red lint', () => {
    expect(exit('fix lint errors', [result('bash', 'npm run lint', false), result('bash', 'npm test', true)])).toBe(1);
  });
  it('rejects failed verification even for a reading task', () => {
    expect(exit('explain the code', [result('bash', 'node --test', false)])).toBe(1);
  });
  it('accepts an ordinary answer without tools', () => {
    expect(exit('What is a closure?', [], 'A closure captures lexical bindings.')).toBe(0);
  });
  it('allows an already passing test suite without an edit', () => {
    expect(exit('run tests and fix failures', [result('bash', 'npm test', true)], 'Tests already pass.')).toBe(0);
  });
  it('does not count a denied tool as executed', () => {
    expect(exit('Create hello.txt', [result('str_replace_editor', '', false)])).toBe(1);
  });
});
