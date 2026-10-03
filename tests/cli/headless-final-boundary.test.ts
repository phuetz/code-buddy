import { expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';
const edit: TaskEvidenceEntry = { type: 'tool_result', content: 'updated',
  toolCall: { id: 'edit', function: { name: 'str_replace_editor', arguments: '{"command":"str_replace","path":"value.js"}' } }, toolResult: { success: true } };
it('does not reuse a pre-tool progress message as the final deliverable', () => {
  const before: TaskEvidenceEntry = { type: 'assistant', content: 'I will change the value.' };
  expect(evaluateHeadlessTaskOutcome('Change value.js from 0 to 1.', [before, edit]).exitCode).not.toBe(0);
});
it('preserves the final answer following the completed tool result', () => {
  expect(evaluateHeadlessTaskOutcome('Change value.js from 0 to 1.', [edit, { type: 'assistant', content: 'Changed value.js from 0 to 1.' }]).exitCode).toBe(0);
});
