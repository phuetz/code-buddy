import { expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, requestsRepositoryAction } from '../../src/cli/headless-task-outcome.js';
import { parseTestOutput, isLikelyTestOutput } from '../../src/utils/test-output-parser.js';
import { mapProviderError } from '../../src/errors/index.js';

it.each([
  'Show me the version by editing package.json to 9.9.9',
  'Montre la version en modifiant package.json',
  'Describe the change by replacing the value in config.json',
  'Peux-tu montrer le résultat en modifiant source.js ?',
])('requires the subordinate physical action: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(true);
  const outcome = evaluateHeadlessTaskOutcome(prompt, [{ type: 'assistant', content: 'The version is 1.0.0.' }]);
  expect(outcome.exitCode).not.toBe(0);
  expect(outcome.reasons).toContain('requested_edit_not_executed');
});
it.each([
  'Show the version without editing package.json',
  'Montre la version sans modifier package.json',
  'Explain why editing package.json changes the version',
  'Show the version by reading package.json',
])('keeps an observation informational: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(false);
});
it.each([
  ['Tests  1 passed | 2 failed', 'vitest'],
  ['Tests  2 failed | 1 passed (3)', 'vitest'],
  ['Tests:       2 failed, 1 passed, 3 total', 'jest'],
  ['Tests:       1 passed, 2 failed, 3 total', 'jest'],
  ['Tests:       2 failed, 2 total', 'jest'],
  ['2 failed, 1 passed in 0.12s', 'pytest'],
])('preserves failures in any summary order: %s', (output, framework) => {
  const parsed = parseTestOutput(output);
  expect(parsed.data?.framework).toBe(framework);
  expect(parsed.data?.summary.failed).toBe(2);
});
it.each([0, 2])('uses structured verification evidence (failed=%i)', failed => {
  const output = JSON.stringify({ type: 'test-results', framework: 'vitest', summary: { total: 3, passed: 3 - failed, failed, skipped: 0 }, tests: [] });
  const outcome = evaluateHeadlessTaskOutcome('Run the tests and fix any failures', [
    { type: 'tool_result', content: output, toolCall: { id: 't', function: { name: 'bash', arguments: '{"command":"npm test"}' } }, toolResult: { success: true, output } },
    { type: 'assistant', content: 'The suite is green.' },
  ]);
  expect(outcome.exitCode === 0).toBe(failed === 0);
  if (failed) expect(outcome.reasons).toContain('verification_failed');
});
it.each(['1500', '1503', '1401', '1429'])('does not invent an HTTP diagnosis from a token count %s', count => {
  const message = `${count} native prompt tokens exceed 1500 before generation`;
  expect(mapProviderError(message)).not.toMatch(/unavailable|API key invalid|rate limit hit/);
});
it('keeps a real HTTP failure diagnosis', () => {
  expect(mapProviderError('HTTP 503 Service Unavailable')).toMatch(/service is currently unavailable/);
});

it.each(['Tests 2 failed (2)', '2 failed in 0.12s'])('recognizes all-red output before enrichment: %s', output => {
  expect(isLikelyTestOutput(output)).toBe(true);
  expect(parseTestOutput(output).data?.summary.failed).toBe(2);
});
