import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';

const green = '# tests 1\n# pass 1\n# fail 0';
const red = '# tests 1\n# pass 0\n# fail 1';
function shell(command: string, success: boolean, output: string, cwd?: string): TaskEvidenceEntry {
  return { type: 'tool_result', content: output,
    toolCall: { id: 'call', function: { name: 'bash', arguments: JSON.stringify({ command }) } },
    toolResult: { success, output, ...(cwd ? { metadata: { shellExecution: { command, cwd, ...(command.includes("sed -i") ? { changedFiles: ["/workspace/greet.js"] } : {}) } } } : {}) },
  };
}
const edit: TaskEvidenceEntry = { type: 'tool_result', content: 'Changed greet.js',
  toolCall: { id: 'edit', function: { name: 'str_replace_editor', arguments: '{"path":"greet.js","command":"str_replace"}' } },
  toolResult: { success: true, output: 'Changed greet.js' },
};
const exit = (entries: TaskEvidenceEntry[], prompt = 'run tests and fix failures') => evaluateHeadlessTaskOutcome(prompt, entries).exitCode;

describe('headless recovery with execution evidence', () => {
  it('does not make a missing optional read invalidate a later real edit (C edit-5)', () => {
    expect(exit([
      shell('cat greet.js && echo "---" && cat .codebuddy/state.json', false, 'Bonjour\nNo such file', '/workspace'),
      shell("cd /workspace && sed -i 's/Bonjour/Salut/' greet.js && cat greet.js", true, 'Salut', '/workspace'),
    ], 'Replace Bonjour by Salut in greet.js')).toBe(0);
  });
  it('keeps the optional read failed when sed succeeded without changing bytes', () => {
    const noChange = shell("sed -i 's/ABSENT/Salut/' greet.js", true, '', '/workspace');
    noChange.toolResult!.metadata = { shellExecution: { command: "sed -i 's/ABSENT/Salut/' greet.js", cwd: '/workspace', changedFiles: [] } };
    expect(exit([shell('cat greet.js && cat .codebuddy/state.json', false, 'No such file', '/workspace'), noChange], 'Replace Bonjour by Salut in greet.js')).toBe(1);
  });
  it('matches cd-scoped and unscoped tests only with the runtime cwd (C fix-2)', () => {
    expect(exit([shell('cd /workspace && npm test 2>&1', false, red, '/workspace'), edit,
      shell('npm test 2>&1 | tail -30', true, green, '/workspace')])).toBe(0);
  });
  it('recovers each literal test fallback when its own member later completes green (C fix-3)', () => {
    const original = shell('npm test 2>&1 || yarn test 2>&1', false, red, '/workspace');
    original.toolResult!.metadata = { shellExecution: { command: 'npm test 2>&1 || yarn test 2>&1', cwd: '/workspace', testScript: 'node --test math.test.js' } };
    expect(exit([original,
      shell('npm run test -- math.test.js 2>&1 || node --test math.test.js 2>&1', false, red, '/workspace'), edit,
      shell('node --test math.test.js 2>&1', true, green, '/workspace')])).toBe(0);
  });
  it('recovers a literal npm/yarn/just fallback from that same npm check (C fix-5)', () => {
    expect(exit([shell('npm test 2>&1 || yarn test 2>&1 || just test 2>&1 | head -100', false, red, '/workspace'), edit,
      shell('npm test 2>&1', true, green, '/workspace')])).toBe(0);
  });
  it.each(['npm test; true', 'npm test || echo passed', 'npm run lint || npm test', 'npm test || npm test; rm -rf fixture'])('keeps a red or unproven compound check closed: %s', command => {
    expect(exit([shell(command, false, red, '/workspace'), edit, shell('npm test', true, green, '/workspace')])).toBe(1);
  });
  it('recovers a literal npm/yarn/bare-jest fallback from its completed npm member', () => {
    expect(exit([shell('npm test 2>&1 || yarn test 2>&1 || jest 2>&1 | head -100', false, red, '/workspace'), edit,
      shell('npm test 2>&1', true, green, '/workspace')])).toBe(0);
  });
  it('does not count a missing read and subsequent echo as a repaired file', () => {
    expect(exit([shell('cat greet.js', false, 'No such file', '/workspace'), shell('echo fixed', true, 'fixed', '/workspace')], 'Replace Bonjour by Salut in greet.js')).toBe(1);
  });
  it('still refuses the explicitly requested missing read despite another edit', () => {
    expect(exit([shell('cat missing.txt', false, 'No such file', '/workspace'), edit], 'run cat missing.txt')).toBe(1);
  });
  it('does not rehabilitate tests with a different cwd or different selector', () => {
    for (const command of ['npm test', 'npm test -- other.test.js']) {
      expect(exit([shell('npm test || yarn test', false, red, '/first'), edit,
        shell(command, true, green, command === 'npm test' ? '/second' : '/first')])).toBe(1);
    }
  });
  it('does not rehabilitate tests from an echo or a truncated green header', () => {
    for (const command of ['echo "# tests 1 # fail 0"', 'npm test | head -1']) {
      expect(exit([shell('npm test || yarn test', false, red, '/workspace'), edit,
        shell(command, true, command.startsWith('echo') ? green : '> npm test', '/workspace')])).toBe(1);
    }
  });
  it('keeps unknown-directory history closed instead of trusting model cwd arguments', () => {
    const unknown = shell('npm test', true, green);
    unknown.toolCall!.function.arguments = '{"command":"npm test","cwd":"/workspace"}';
    expect(exit([shell('cd /workspace && npm test', false, red), edit, unknown])).toBe(1);
  });
  it('does not equate a direct node test with an unobserved project test script', () => {
    expect(exit([shell('npm test || yarn test', false, red, '/workspace'), edit,
      shell('node --test math.test.js', true, green, '/workspace')])).toBe(1);
  });
  it('does not clear an outstanding unrelated verification with a green fallback', () => {
    expect(exit([shell('npm run lint', false, 'Lint failed', '/workspace'),
      shell('npm test || yarn test', false, red, '/workspace'), edit, shell('npm test', true, green, '/workspace')])).toBe(1);
  });
  it('does not clear a failing fallback with output red masked by shell success', () => {
    expect(exit([shell('npm test || yarn test', false, red, '/workspace'), edit,
      shell('npm test', true, red, '/workspace')])).toBe(1);
  });
});
