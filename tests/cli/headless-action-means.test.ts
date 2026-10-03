import { expect, it } from 'vitest';
import { requestsRepositoryAction } from '../../src/cli/headless-task-outcome.js';

it.each([
  'Does this script update the version by editing package.json?',
  'Will this command change the version by editing package.json?',
  'Est-ce que ce script change la version en modifiant package.json ?',
])('observing the means of an existing operation does not request it: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(false);
});
it.each([
  'Can you show the version by editing package.json?',
  'Peux-tu montrer la version en modifiant package.json ?',
])('a polite imperative still requires its requested means: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(true);
});
