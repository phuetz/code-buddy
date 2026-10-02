import { describe, expect, it } from 'vitest';
import { resolveHeadlessTurnExitCode } from '../../src/cli/headless-options.js';
import { evaluateHeadlessTaskOutcome } from '../../src/cli/headless-task-outcome.js';

const result = (name: string, command: string, success: boolean) => ({
  type: 'tool_result', content: success ? 'OK' : 'Tests failed',
  toolCall: { id: 'call', function: { name, arguments: JSON.stringify({ command }) } },
  toolResult: { success },
});

it('un refus terminal après une édition reste non validé avec sa cause', () => {
  const entries = [result('str_replace_editor', 'str_replace', true), {
    ...result('str_replace_editor', 'str_replace', false),
    content: 'Approval requires an interactive terminal or configured remote approval channel',
    toolResult: { success: false, metadata: { failure: { code: 'APPROVAL_UNAVAILABLE', terminal: true } } },
  }];
  expect(evaluateHeadlessTaskOutcome('Fix the requested files', entries)).toMatchObject({
    status: 'unverified', success: false, exitCode: 1, reasons: ['approval_unavailable'],
  });
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
  it.each(['explain the code, then fix lint errors', 'explain the code, then prepare the requested change', 'mets en place le serveur', 'cambia el archivo', 'prepare the requested change'])('fails closed for an unexecuted compound or ambiguous task: %s', prompt => {
    expect(exit(prompt, [])).toBe(1);
  });
  it.each(['make the failing tests pass', 'ensure the tests pass', 'fais passer les tests', 'rends ce code fonctionnel', 'Modify value.mjs', 'crée une API REST', 'switch the theme to dark', 'Please add pagination'])('requires execution for %s', prompt => {
    expect(exit(prompt, [])).toBe(1);
  });
  it('rejects a verification still red despite the claimed fix', () => {
    expect(exit('run tests and fix failures', [result('bash', 'npm test', false), result('str_replace_editor', 'str_replace', true)])).toBe(1);
  });
  it.each([
    ['npm test; true', '# tests 1\n# pass 0\n# fail 1'],
    ['npx vitest run; echo done', 'Test Files 1 failed (1)\nTests 2 failed (2)'],
    ['npm run lint; echo done', '✖ 2 problems (2 errors, 0 warnings)'],
    ['npx tsc --noEmit; true', 'index.ts(2,1): error TS2322: Type mismatch'],
  ])('rejects visible red verification masked by shell success: %s', (command, output) => {
    const entry = { ...result('bash', command, true), content: output, toolResult: { success: true, output } };
    expect(exit('run tests and fix failures', [entry])).toBe(1);
  });
  it('accepts ESLint warnings with zero errors', () => {
    const output = '✖ 2 problems (0 errors, 2 warnings)';
    const entry = { ...result('bash', 'npm run lint', true), content: output, toolResult: { success: true, output } };
    expect(exit('fix lint errors', [entry])).toBe(0);
  });
  it('accepts red then green for the same verification', () => {
    expect(exit('run tests and fix failures', [result('bash', 'npm test', false), result('str_replace_editor', 'str_replace', true), result('bash', 'npm test', true)])).toBe(0);
  });
  it.each(['tail -8', 'tail -n 8', 'head -30', 'tail', 'head -n30'])('recognizes a completed red then green suite despite output formatting: %s', formatter => {
    const red = { ...result('bash', 'cd /workspace && npm test 2>&1 | tail -20', true), toolResult: { success: true, output: '# tests 1\n# fail 1' } };
    const green = { ...result('bash', `cd /workspace && npm test 2>&1 | ${formatter}`, true), toolResult: { success: true, output: '# tests 1\n# pass 1\n# fail 0' } };
    expect(exit('run tests and fix failures', [red, result('str_replace_editor', 'str_replace', true), green])).toBe(0);
  });
  it('does not clear a red suite using a formatter which hides its summary', () => {
    const red = { ...result('bash', 'cd /workspace && npm test 2>&1 | tail -20', true), toolResult: { success: true, output: '# tests 1\n# fail 1' } };
    const hidden = { ...result('bash', 'cd /workspace && npm test 2>&1 | head -1', true), toolResult: { success: true, output: '> npm test' } };
    expect(exit('fix the tests', [red, hidden])).toBe(1);
  });
  it('does not clear red tests with passing tests in another explicit shell directory', () => {
    const red = { ...result('bash', 'cd /first && npm test 2>&1 | tail -20', true), toolResult: { success: true, output: '# tests 1\n# fail 1' } };
    const green = { ...result('bash', 'cd /second && npm test 2>&1 | tail -8', true), toolResult: { success: true, output: '# tests 1\n# pass 1\n# fail 0' } };
    expect(exit('fix the tests', [red, green])).toBe(1);
  });
  it.each(['echo "exit: $?"', 'echo "status=$?"', 'echo exit: $?', 'echo "code: $?"', 'echo "EXIT: $?"'])('accepts the observed zero checker status printed immediately after it: %s', echo => {
    const red = { ...result('bash', 'cd /workspace && npx eslint . 2>&1 | head -50', true), toolResult: { success: true, output: '✖ 2 problems (2 errors, 0 warnings)' } };
    const label = echo.match(/exit|status|code/i)![0]!;
    const green = { ...result('bash', `cd /workspace && npx eslint . 2>&1; ${echo}`, true), toolResult: { success: true, output: `${label}: 0\n[sandbox:landlock; exit code 0]` } };
    expect(exit('fix lint errors', [red, green])).toBe(0);
  });
  it('rejects a nonzero checker status even when the following echo exits zero', () => {
    const red = { ...result('bash', 'npm run lint; echo "exit: $?"', true), toolResult: { success: true, output: 'exit: 2\n[sandbox:landlock; exit code 0]' } };
    expect(exit('fix lint errors', [red])).toBe(1);
  });
  it('does not trust an echoed constant or the exit code of an output pipeline', () => {
    const red = { ...result('bash', 'cd /workspace && npx eslint .', false), toolResult: { success: false, output: 'Lint failed' } };
    for (const command of ['cd /workspace && npx eslint .; echo "exit: 0"', 'cd /workspace && npx eslint . | head -1; echo "exit: $?"']) {
      const hidden = { ...result('bash', command, true), toolResult: { success: true, output: 'exit: 0' } };
      expect(exit('fix lint errors', [red, hidden])).toBe(1);
    }
  });
  it('does not let a green test erase red lint', () => {
    expect(exit('fix lint errors', [result('bash', 'npm run lint', false), result('bash', 'npm test', true)])).toBe(1);
  });
  it('does not clear red tests with the same command after a shell directory change', () => {
    expect(exit('fix failures', [result('bash', 'npm test', false), result('bash', 'cd other-project', true), result('bash', 'npm test', true)])).toBe(1);
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
