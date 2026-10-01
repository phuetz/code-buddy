import { describe, expect, it } from 'vitest';
import {
  evaluateHeadlessTaskOutcome,
  type TaskEvidenceEntry,
} from '../../src/cli/headless-task-outcome.js';
const result = (
  command: string,
  success: boolean,
  cwd = '/fixture',
  testScript = 'node --test math.test.js'
): TaskEvidenceEntry => ({
  type: 'tool_result',
  content: success ? '# tests 3\n# fail 0' : 'runner failed',
  toolCall: { id: command, function: { name: 'bash', arguments: JSON.stringify({ command }) } },
  toolResult: {
    success,
    output: success ? '# tests 3\n# fail 0' : 'runner failed',
    metadata: { shellExecution: { command, cwd, testScript } },
  },
});
describe('recovered project check with an unnecessary runner fallback', () => {
  const failed = result('npx vitest run 2>&1 || npm test -- --run 2>&1 | head -50', false);
  it('accepts the later complete default project check in the same observed directory', () => {
    expect(
      evaluateHeadlessTaskOutcome('run tests and fix failures', [
        failed,
        result('npm test 2>&1', true),
      ]).exitCode
    ).toBe(0);
  });
  it('does not erase a check explicitly requested with --run', () => {
    expect(
      evaluateHeadlessTaskOutcome('Run npm test -- --run and fix failures', [
        failed,
        result('npm test', true),
      ]).exitCode
    ).not.toBe(0);
  });
  it.each([
    result('npm test', true, '/other'),
    result('npm test', true, '/fixture', 'node --test unrelated.test.js'),
  ])('keeps failures from another directory or project script', (green) => {
    expect(
      evaluateHeadlessTaskOutcome('run tests and fix failures', [failed, green]).exitCode
    ).not.toBe(0);
  });
});
