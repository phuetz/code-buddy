import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';

const result = (name: string, success: boolean, args = '{}', output = ''): TaskEvidenceEntry => ({
  type: 'tool_result', content: output, toolCall: { id: name, function: { name, arguments: args } }, toolResult: { success, output },
});
describe('headless action claims require successful evidence', () => {
  it.each(["J'ai modifié greet.js.", 'I created the file.', 'Les tests passent.', 'I ran npm test.'])('refuses %s even for an informational question', content => {
    const outcome = evaluateHeadlessTaskOutcome('Explain the repository', [{ type: 'assistant', content }]);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.reasons).toContain('unsupported_action_claim');
  });
  it('does not count a failed edit or an unrelated successful read as an edit', () => {
    expect(evaluateHeadlessTaskOutcome('Explain', [result('str_replace_editor', false), result('view_file', true), { type: 'assistant', content: "J'ai modifié greet.js." }]).exitCode).toBe(4);
  });
  it('does not accept an echo as successful tests', () => {
    expect(evaluateHeadlessTaskOutcome('Explain', [result('bash', true, '{"command":"echo OK"}', 'OK'), { type: 'assistant', content: 'All tests passed.' }]).exitCode).toBe(4);
  });
  it('accepts an observed edit and a completed green test runner', () => {
    expect(evaluateHeadlessTaskOutcome('Explain', [result('str_replace_editor', true, '{"command":"str_replace"}'), result('bash', true, '{"command":"npm test"}', '# tests 3\n# fail 0'), { type: 'assistant', content: "J'ai modifié greet.js. Les tests passent." }]).exitCode).toBe(0);
  });
  it.each(['Run npm test to verify.', "Je n'ai pas modifié les fichiers.", 'The documentation says: "I created the file."', 'If tests pass, commit.', 'I will create the file.'])('does not mistake advice, quotes or a blocker for completion: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [{ type: 'assistant', content }]).exitCode).toBe(0);
  });
  it.each(['Session cost limit reached ($10).', 'Operation cancelled by user', 'Maximum tool execution rounds reached.'])('fails on abnormal termination even after a successful action: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Run echo', [result('bash', true, '{"command":"echo ok"}'), { type: 'assistant', content }]).exitCode).not.toBe(0);
  });
});
