import { expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, requestsRepositoryAction, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';

const answer: TaskEvidenceEntry = { type: 'assistant', content: 'Observed answer.' };
const edit = (path: string): TaskEvidenceEntry => ({ type: 'tool_result', content: 'Updated.',
  toolCall: { id: path, function: { name: 'str_replace_editor', arguments: JSON.stringify({ path, old_str: '1', new_str: '2' }) } },
  toolResult: { success: true, output: 'Updated.' } });
const read: TaskEvidenceEntry = { type: 'tool_result', content: '1: export const value = 1;',
  toolCall: { id: 'read', function: { name: 'view_file', arguments: '{"path":"source.js"}' } },
  toolResult: { success: true, output: '1: export const value = 1;' } };

it.each(["N'oublie pas d'expliquer source.js", "N'oublie pas de lire source.js", 'You must not forget to explain source.js.',
  "Don't forget to explain source.js.", 'N’hésite pas à lire source.js', "N'oublie pas de lire le code", 'Do not forget to read the code'])('keeps the reading inside a reminder: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(false);
  expect(evaluateHeadlessTaskOutcome(prompt, [answer]).reasons).toContain('source_evidence_missing');
  expect(evaluateHeadlessTaskOutcome(prompt, [read, { ...answer, content: 'source.js exports value, equal to 1.' }]).exitCode).toBe(0);
});
it.each(["N'oublie pas de modifier package.json", "N'hésite pas à modifier package.json", 'You must not forget to edit package.json',
  'You should not forget to edit package.json', "Don't hesitate to edit package.json"])(
  'requires the edit inside a reminder: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(true);
    expect(evaluateHeadlessTaskOutcome(prompt, [answer]).exitCode).not.toBe(0);
    expect(evaluateHeadlessTaskOutcome(prompt, [edit('package.json'), answer]).exitCode).toBe(0);
  },
);
it('keeps both obligations in a coordinated reminder', () => {
  const prompt = "N'oublie pas de modifier package.json et explique source.js.";
  expect(evaluateHeadlessTaskOutcome(prompt, [read, answer]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('package.json'), answer]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('package.json'), read, answer]).exitCode).toBe(0);
});
it.each(['Explain closures. The change occurs in source.js by editing it.',
  'Explique les closures. Le correctif existe dans package.json en modifiant la version.'])(
  'does not discard an explicit means of change as incidental: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(true);
    expect(evaluateHeadlessTaskOutcome(prompt, [answer]).exitCode).not.toBe(0);
  },
);
it.each(['Explique les closures. Un exemple existe dans source.js.',
  'Explain closures. An example exists in Source.JS.'])(
  'accepts a genuine incidental presence statement: %s', prompt => {
    expect(evaluateHeadlessTaskOutcome(prompt, [answer]).exitCode).toBe(0);
  },
);
it.each(["N'oublie pas de ne pas modifier package.json", 'Do not forget to never edit package.json'])(
  'retains a prohibition nested inside a reminder: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(false);
    expect(evaluateHeadlessTaskOutcome(prompt, [answer]).exitCode).toBe(0);
    expect(evaluateHeadlessTaskOutcome(prompt, [edit('package.json'), answer]).exitCode).not.toBe(0);
  },
);
it('checks each named edit independently from the prohibition', () => {
  const prompt = 'Do not edit package.json; update source.js.';
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('package.json'), answer]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('package.json'), edit('source.js'), answer]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('source.js'), answer]).exitCode).toBe(0);
});
it('does not let an unrelated file satisfy a named edit', () => {
  const prompt = 'Update source.js.';
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('other.js'), answer]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('./source.js'), answer]).exitCode).toBe(0);
});
it('preserves case and checks all named edit targets', () => {
  const prompt = 'Update Source.JS and modify other.js.';
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('source.js'), edit('other.js'), answer]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [edit('Source.JS'), edit('other.js'), answer]).exitCode).toBe(0);
});
it.each(['.config/value.json', "'my module.js'", '"my module.js"'])('retains the literal identity of a named path: %s', target => {
  const actual = target.replace(/^['"]|['"]$/g, '');
  expect(evaluateHeadlessTaskOutcome(`Update ${target}.`, [edit(actual), answer]).exitCode).toBe(0);
  expect(evaluateHeadlessTaskOutcome(`Update ${target}.`, [edit('other.js'), answer]).exitCode).not.toBe(0);
});

it.each([true, false])('uses the host directory for shell edit evidence (same root: %s)', sameRoot => {
  const cwd = sameRoot ? process.cwd() : '/another-project';
  const command = "sed -i 's/1/2/' source.js";
  const result: TaskEvidenceEntry = { type: 'tool_result', content: '',
    toolCall: { id: 'shell', function: { name: 'bash', arguments: JSON.stringify({ command }) } },
    toolResult: { success: true, metadata: { shellExecution: { command, cwd, changedFiles: ['source.js'] } } } };
  expect(evaluateHeadlessTaskOutcome('Update source.js.', [result, answer]).exitCode === 0).toBe(sameRoot);
});
