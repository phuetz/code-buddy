import { expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';
const query = 'Explain the actual imports and printed output of main.cjs, using only facts from these files.';
const sources = [{ path: 'main.cjs', content: "const {reverse} = require('./reverse.cjs');\nconsole.log(reverse(' Ab '));\n" },
  { path: 'reverse.cjs', content: "exports.reverse = text => [...text].reverse().join('');\n" }];
const read = (source: typeof sources[number]): TaskEvidenceEntry => {
  const content = source.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
  return { type: 'tool_result', content, toolCall: { id: source.path, function: { name: 'view_file', arguments: JSON.stringify({ path: source.path }) } }, toolResult: { success: true, output: content } };
};
const execution = (command = 'node main.cjs', success = true): TaskEvidenceEntry => ({ type: 'tool_result', content: ' bA \n',
  toolCall: { id: 'run', function: { name: 'bash', arguments: JSON.stringify({ command }) } },
  toolResult: { success, output: ' bA \n', metadata: { shellExecution: { command, cwd: process.cwd() } } } });
const answer = (content: string): TaskEvidenceEntry => ({ type: 'assistant', content });
const good = JSON.stringify({ sources, stdout: ' bA \n' });
it.each(['The input has three characters and prints " bA ".', 'I cannot explain that output.',
  'The code prints bA without spaces.'])('does not certify unverified prose merely because the source was read: %s', text => {
  expect(evaluateHeadlessTaskOutcome(query, [...sources.map(read), answer(text)]).exitCode).not.toBe(0);
});
it('accepts a report whose complete source and actual stdout are independently observed', () => {
  const outcome = evaluateHeadlessTaskOutcome(query, [execution(), ...sources.map(read), answer(good)]);
  expect(outcome.reasons).toEqual([]);
  expect(outcome.exitCode).toBe(0);
});
it.each([
  JSON.stringify({ sources, stdout: 'bA\n' }),
  JSON.stringify({ sources: [sources[0]], stdout: ' bA \n' }),
  JSON.stringify({ sources, stdout: ' bA \n', explanation: 'The input has three characters.' }),
])('rejects a false or incomplete observed report: %s', text => {
  expect(evaluateHeadlessTaskOutcome(query, [execution(), ...sources.map(read), answer(text)]).exitCode).not.toBe(0);
});
it.each(['node -e "console.log(123)"', 'echo 123', 'node main.cjs || true'])('does not substitute another command for entry execution: %s', command => {
  expect(evaluateHeadlessTaskOutcome(query, [execution(command), ...sources.map(read), answer(good)]).exitCode).not.toBe(0);
});
it('does not accept unsuccessful execution or an unread dependency', () => {
  expect(evaluateHeadlessTaskOutcome(query, [execution('node main.cjs', false), ...sources.map(read), answer(good)]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(query, [execution(), read(sources[0]!), answer(good)]).exitCode).not.toBe(0);
});
it('keeps conceptual explanations outside this repository output contract', () => {
  expect(evaluateHeadlessTaskOutcome('Explain how console.log works.', [answer('It writes a formatted value to standard output.')]).exitCode).toBe(0);
});

it.each(['What does main.cjs print?', 'Read main.cjs and report its stdout.',
  'Quel texte est imprimé par main.cjs ?'])('requires output evidence across informational forms: %s', prompt => {
  expect(evaluateHeadlessTaskOutcome(prompt, [...sources.map(read), answer('Observed answer.')]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [execution(), ...sources.map(read), answer(good)]).exitCode).toBe(0);
});

it('keeps execution evidence while subsequent literal cat reads observe the sources', () => {
  const cat = (source: typeof sources[number]): TaskEvidenceEntry => ({ type: 'tool_result', content: source.content,
    toolCall: { id: source.path, function: { name: 'bash', arguments: JSON.stringify({ command: `cat ${source.path}` }) } },
    toolResult: { success: true, output: source.content, metadata: { shellExecution: { command: `cat ${source.path}`, cwd: process.cwd() } } } });
  expect(evaluateHeadlessTaskOutcome(query, [execution(), ...sources.map(cat), answer(good)]).exitCode).toBe(0);
});
