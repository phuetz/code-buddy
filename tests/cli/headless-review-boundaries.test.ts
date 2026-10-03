import { expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, requestsRepositoryAction, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';
import { parseTestOutput, isLikelyTestOutput } from '../../src/utils/test-output-parser.js';
import { mapProviderError } from '../../src/errors/index.js';

const answer: TaskEvidenceEntry = { type: 'assistant', content: 'Observed answer.' };
const edit: TaskEvidenceEntry = {
  type: 'tool_result', content: 'File edited.',
  toolCall: { id: 'edit', function: { name: 'str_replace_editor', arguments: JSON.stringify({ command: 'str_replace', path: 'package.json', old_str: '1.0.0', new_str: '2.0.0' }) } },
  toolResult: { success: true, output: 'File edited.' },
};

it.each([
  'Do not show the version by editing package.json',
  "Don't show the version by editing package.json",
  'Never show the version by editing package.json',
  'Ne montre pas la version en modifiant package.json',
  'Do not edit package.json by changing the version',
  'Ne montre jamais la version en modifiant package.json',
  'Please do not show the version by editing package.json',
  'Don’t show the version by editing package.json',
  'Do not show the implementation by editing Source.JS',
])('obeying a prohibition succeeds, violating it fails: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(false);
  expect(evaluateHeadlessTaskOutcome(prompt, [answer]).exitCode).toBe(0);
  const violated = evaluateHeadlessTaskOutcome(prompt, [edit, answer]);
  expect(violated.exitCode).not.toBe(0);
  expect(violated.reasons).toContain('unexpected_edit_executed');
});

it('keeps an independent positive obligation after a prohibition', () => {
  expect(requestsRepositoryAction('Do not edit package.json; update source.js.')).toBe(true);
});

it.each(['Source.JS', 'source.Js', 'module.PY', 'library.TsX'])('requires observation of a source regardless of extension case: %s', file => {
  const prompt = `Explain ${file}.`;
  expect(evaluateHeadlessTaskOutcome(prompt, [answer]).reasons).toContain('source_evidence_missing');
  const read: TaskEvidenceEntry = { type: 'tool_result', content: '1: const value = 1;',
    toolCall: { id: 'read', function: { name: 'view_file', arguments: JSON.stringify({ path: file }) } },
    toolResult: { success: true, output: '1: const value = 1;' } };
  expect(evaluateHeadlessTaskOutcome(prompt, [read, answer]).exitCode).toBe(0);
  read.toolCall!.function.arguments = JSON.stringify({ path: file.toLowerCase() });
  expect(evaluateHeadlessTaskOutcome(prompt, [read, answer]).exitCode).not.toBe(0);
});

it.each([
  'What is a closure? The idea also appears in source.js.',
  'Explain closures. An example exists in Source.JS.',
])('does not require reading an incidental source mention: %s', prompt => {
  expect(evaluateHeadlessTaskOutcome(prompt, [answer]).reasons).not.toContain('source_evidence_missing');
});

it.each(['2 errors in 0.4s', '1 error in 0.4s', '1 failed, 2 errors in 0.4s'])('preserves pytest collection errors: %s', output => {
  expect(isLikelyTestOutput(output)).toBe(true);
  expect(parseTestOutput(output).data?.summary.failed).toBe(output.startsWith('1 failed') ? 3 : output.startsWith('1 error') ? 1 : 2);
  const result = evaluateHeadlessTaskOutcome('Run the tests', [{ type: 'tool_result', content: output,
    toolCall: { id: 'check', function: { name: 'bash', arguments: '{"command":"pytest"}' } },
    toolResult: { success: true, output } }, answer]);
  expect(result.exitCode).not.toBe(0);
  expect(result.reasons).toContain('verification_failed');
});

it.each(['HTTP500', 'upstream HTTP503', 'HTTP 502'])('recognizes an explicit HTTP status attached to its label: %s', message => {
  expect(mapProviderError(message)).toMatch(/service is currently unavailable/);
});

it.each(['Can you explain Source.JS?', 'Please explain Source.JS.', 'Peux-tu expliquer Source.JS ?'])(
  'keeps polite source-reading requests: %s', prompt => {
    expect(evaluateHeadlessTaskOutcome(prompt, [answer]).reasons).toContain('source_evidence_missing');
  },
);

it.each(['Give me the inputs of Source.JS.', 'Return the parameter names from source.js.'])(
  'does not restrict source-reading evidence to a verb whitelist: %s', prompt => {
    expect(evaluateHeadlessTaskOutcome(prompt, [answer]).reasons).toContain('source_evidence_missing');
  },
);
it('does not approve an unsolicited edit during an explanation', () => {
  expect(evaluateHeadlessTaskOutcome('Explain', [edit, answer]).reasons).toContain('unexpected_edit_executed');
});
