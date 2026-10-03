import { expect, it } from 'vitest';
import path from 'node:path';
import { evaluateHeadlessTaskOutcome } from '../../src/cli/headless-task-outcome.js';

it.each(['source.js', './source.js', path.resolve('source.js')])('accepts the observed source identity: %s', target => {
  const result = evaluateHeadlessTaskOutcome(`Explain ${target}.`, [
    { type: 'tool_result', content: '1: export const count = 2;', toolCall: { id: 'r', function: { name: 'view_file', arguments: JSON.stringify({ path: target }) } }, toolResult: { success: true, output: '1: export const count = 2;' } },
    { type: 'assistant', content: 'The module exports the constant count, equal to 2.' },
  ]);
  expect(result.exitCode).toBe(0);
});
