import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';
const shell = (command: string, success: boolean): TaskEvidenceEntry => ({ type: 'tool_result', content: success ? 'ok' : 'exit code 1', toolCall: { id: command, function: { name: 'bash', arguments: JSON.stringify({ command }) } }, toolResult: { success } });
const edit: TaskEvidenceEntry = { type: 'tool_result', content: 'updated', toolCall: { id: 'edit', function: { name: 'str_replace_editor', arguments: '{"path":"app.js"}' } }, toolResult: { success: true } };
const answer: TaskEvidenceEntry = { type: 'assistant', content: 'Updated app.js.' };
describe('exploratory searches versus required checks', () => {
  it.each(['grep -n missing app.js', 'rg missing .'])(
    'does not reject a completed edit because an earlier exploratory read failed: %s', command => {
      const outcome = evaluateHeadlessTaskOutcome('Change the value in app.js.', [shell(command, false), edit, answer]);
      expect(outcome.exitCode).toBe(0);
      expect(outcome.checks[0]?.required).toBe(false);
    },
  );
  it.each(['grep missing app.js', 'rg missing .'])(
    'retains an explicitly requested search as a required check: %s', command => {
      expect(evaluateHeadlessTaskOutcome(`Change app.js and run ${command}.`, [shell(command, false), edit, answer]).exitCode).not.toBe(0);
    },
  );
  it.each(['npm test', 'rg --pre dangerous missing .', 'grep missing app.js && npm test', 'grep missing app.js > result.txt'])(
    'cannot waive failed execution or writes: %s', command => {
      expect(evaluateHeadlessTaskOutcome('Change app.js.', [shell(command, false), edit, answer]).exitCode).not.toBe(0);
    },
  );
  it('cannot count a successful search as a requested mutation', () => {
    expect(evaluateHeadlessTaskOutcome('Change app.js.', [shell('rg TODO .', true), { ...answer, content: 'Done.' }]).exitCode).not.toBe(0);
  });
});
