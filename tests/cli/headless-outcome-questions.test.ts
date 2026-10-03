import { expect, it } from 'vitest';
import { requestsRepositoryAction } from '../../src/cli/headless-task-outcome.js';

it.each([
  'Does this module export a default function?', 'Is the package configured as an ES module?',
  'Are the tests independent of the main entry?', 'Was the value initialized before the call?',
  'Has the loader already imported this dependency?', 'Will this expression allocate an array?',
  'Peux-tu expliquer le rôle de package.json ?', 'Pourrais-tu décrire les paramètres ?',
  'Est-ce que ce fichier importe un module local ?',
])('does not turn an interrogative reading into an edit obligation: %s', query => {
  expect(requestsRepositoryAction(query)).toBe(false);
  expect(requestsRepositoryAction(query + ' Add a missing export.')).toBe(true);
});
it.each(['R', 'PowerShell', 'NewLanguage2040'])('source conversion is independent of destination vocabulary: %s', target => {
  expect(requestsRepositoryAction(`Read source.js and translate it to ${target}.`)).toBe(true);
});
it.each(['Translate this sentence to French.', 'Read README.md and translate it to Spanish.'])('keeps prose translation informational: %s', query => {
  expect(requestsRepositoryAction(query)).toBe(false);
});
it.each(['Do the refactor.', 'Have the tests rerun.'])('does not exempt an imperative auxiliary: %s', query => {
  expect(requestsRepositoryAction(query)).toBe(true);
});
it.each(['Would you update config.json?', 'Will you rename the export?', 'Est-ce que tu peux modifier le fichier ?'])(
  'keeps a polite action request distinct from a question about existing state: %s', query => {
    expect(requestsRepositoryAction(query)).toBe(true);
  },
);
it('keeps translation of an explanation informational even when it mentions source code', () => {
  expect(requestsRepositoryAction('Translate the explanation of this code to French.')).toBe(false);
});

it.each(['printed output of main.cjs', 'observed values', 'computed results from source.js'])(
  'keeps a coordinated observation noun phrase informational: %s', object => {
    expect(requestsRepositoryAction(`Explain the imports and ${object}.`)).toBe(false);
    expect(requestsRepositoryAction(`Explain the imports and ${object}, then rewrite source.js.`)).toBe(true);
  },
);
