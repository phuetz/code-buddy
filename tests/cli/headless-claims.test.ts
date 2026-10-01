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
    expect(evaluateHeadlessTaskOutcome('Explain', [result('str_replace_editor', true, '{"command":"str_replace","path":"greet.js"}'), result('bash', true, '{"command":"npm test"}', '# tests 3\n# fail 0'), { type: 'assistant', content: "J'ai modifié greet.js. Les tests passent." }]).exitCode).toBe(0);
  });
  it.each(['Run npm test to verify.', "Je n'ai pas modifié les fichiers.", 'The documentation says: "I created the file."', 'If tests pass, commit.', 'I will create the file.'])('does not mistake advice, quotes or a blocker for completion: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [{ type: 'assistant', content }]).exitCode).toBe(0);
  });
  it.each(['Session cost limit reached ($10).', 'Operation cancelled by user', 'Maximum tool execution rounds reached.'])('fails on abnormal termination even after a successful action: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Run echo', [result('bash', true, '{"command":"echo ok"}'), { type: 'assistant', content }]).exitCode).not.toBe(0);
  });
});


describe('honest wording and concrete action targets', () => {
  it.each([
    'I ran into an error while trying to read the file.',
    "J'ai lancé une analyse du code…", 'I created a mental model…',
    'I modified my understanding…', 'I ran the risk…',
    "J'ai exécuté les instructions mentalement…", 'I ran a quick scan…',
    "J'ai lancé la lecture de index.js…",
  ])('accepts an honest informational answer: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [{ type: 'assistant', content }]).exitCode).toBe(0);
  });
  it('does not use an edit of another file as proof', () => {
    expect(evaluateHeadlessTaskOutcome('Explain', [result('str_replace_editor', true, '{"command":"str_replace","path":"other.js"}'), { type: 'assistant', content: "J’ai modifié greet.js." }]).exitCode).toBe(4);
  });
  it('does not use an unrelated command as proof', () => {
    expect(evaluateHeadlessTaskOutcome('Explain', [result('bash', true, '{"command":"ls ."}'), { type: 'assistant', content: 'I executed `npm test`.' }]).exitCode).toBe(4);
  });
  it.each(['Quel est le nom du projet ?', 'Where is greet defined?', 'Count the functions in index.js.', 'Combien de fonctions contient index.js ?'])('allows an informational query without a mutation: %s', prompt => {
    expect(evaluateHeadlessTaskOutcome(prompt, [{ type: 'assistant', content: 'Observed answer' }]).exitCode).toBe(0);
  });
  it('keeps the action requirement on compound interrogative requests', () => {
    expect(evaluateHeadlessTaskOutcome('Where is greet defined? Then fix it.', [{ type: 'assistant', content: 'Done' }]).exitCode).not.toBe(0);
  });
});


it('does not let an honest cognitive clause hide a false edit claim', () => {
  expect(evaluateHeadlessTaskOutcome('Explain', [{ type: 'assistant', content: "I created a mental model and I modified greet.js." }]).exitCode).toBe(4);
});
it('checks double-quoted file targets and preserves case', () => {
  const content = 'I edited "Greet.js".';
  expect(evaluateHeadlessTaskOutcome('Explain', [result('str_replace_editor', true, '{"path":"Greet.js"}'), { type: 'assistant', content }]).exitCode).toBe(0);
  expect(evaluateHeadlessTaskOutcome('Explain', [result('str_replace_editor', true, '{"path":"other.js"}'), { type: 'assistant', content }]).exitCode).toBe(4);
});

it('does not let a successful inspection stand in for a requested edit', () => {
  expect(evaluateHeadlessTaskOutcome('Dans greet.js, remplace Bonjour par Salut.', [result('bash', true, '{"command":"ls ."}'), { type: 'assistant', content: 'Done.' }]).exitCode).not.toBe(0);
});
it('requires a real completed check after an edit for a test-repair request', () => {
  expect(evaluateHeadlessTaskOutcome('run tests and fix failures', [result('str_replace_editor', true, '{"path":"math.js"}'), { type: 'assistant', content: 'Fixed.' }]).exitCode).not.toBe(0);
});
it('does not use a successful ls as evidence for an unquoted build command', () => {
  expect(evaluateHeadlessTaskOutcome('Explain', [result('bash', true, '{"command":"ls ."}'), { type: 'assistant', content: 'I executed npm run build.' }]).exitCode).toBe(4);
});

// A denial about another fact must never waive an asserted real action.
it.each([
  'I created a mental model, I modified greet.js.',
  'I edited greet.js which is not documented.',
  'I ran npm test, but not lint.',
  'All tests passed although they are not documented.',
])('keeps evidence mandatory after unrelated cognitive or negative wording: %s', content => {
  expect(evaluateHeadlessTaskOutcome('Explain', [{ type: 'assistant', content }]).exitCode).toBe(4);
});
