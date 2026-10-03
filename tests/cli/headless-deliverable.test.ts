import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';

const answer = (content: string): TaskEvidenceEntry => ({ type: 'assistant', content });
const read = (path: string, text: string): TaskEvidenceEntry => ({
  type: 'tool_result', content: text,
  toolCall: { id: path, function: { name: 'view_file', arguments: JSON.stringify({ path }) } },
  toolResult: { success: true, output: text },
});
const files = [read('AGENTS.md', '1: For repository reading, begin your reply with CHECK_NOTE on its own line.'),
  read('package.json', '1: {"name":"sample-module","version":"7.2.1"}')];
const prompt = 'What is the package name? Answer in the reading format from AGENTS.md, with that name as the sole second line.';

describe('a classified reading task still owes a deliverable', () => {
  it.each(['I would need to read package.json to answer.', 'I cannot provide the requested name.',
    'Observed answer.', 'Done.', 'CHECK_NOTE\nwrong-module', 'sample-module',
    'CHECK_NOTE\nsample-module\nI have nothing else to add.'])(
    'refuses an absent, false or nonconforming deliverable: %s', content => {
      expect(evaluateHeadlessTaskOutcome(prompt, [...files, answer(content)]).exitCode).not.toBe(0);
    },
  );
  it('accepts the observed value with the required format', () => {
    expect(evaluateHeadlessTaskOutcome(prompt, [...files, answer('CHECK_NOTE\nsample-module')]).exitCode).toBe(0);
  });
  it('does not accept a lucky guess without a successful read', () => {
    expect(evaluateHeadlessTaskOutcome(prompt, [answer('CHECK_NOTE\nsample-module')]).exitCode).not.toBe(0);
  });
  it('does not treat an unread target as absent merely because another file was read', () => {
    expect(evaluateHeadlessTaskOutcome('Read package.json and report the package name.',
      [files[0]!, answer('The provided file contains no package name.')]).exitCode).not.toBe(0);
  });
  it.each(['license', 'description', 'version'])('checks other requested manifest fields: %s', field => {
    const observed = read('package.json', `1: ${JSON.stringify({ [field]: 'actual-value' })}`);
    const query = `Read the ${field} field in package.json. Return only its value.`;
    expect(evaluateHeadlessTaskOutcome(query, [observed, answer('invented-value')]).exitCode).not.toBe(0);
    expect(evaluateHeadlessTaskOutcome(query, [observed, answer('actual-value')]).exitCode).toBe(0);
  });
  it('preserves an ordinary conceptual answer', () => {
    expect(evaluateHeadlessTaskOutcome('What is a closure?', [answer('A closure captures lexical bindings.')]).exitCode).toBe(0);
  });
  it('does not turn a prefix into evidence of factual correctness', () => {
    expect(evaluateHeadlessTaskOutcome(prompt, [...files, answer('CHECK_NOTE\nThe name cannot be determined.')]).exitCode).not.toBe(0);
  });
  it('rejects a result invalidated by a later write', () => {
    const write = { ...read('package.json', 'Changed'), toolCall: { id: 'edit', function: { name: 'str_replace_editor', arguments: '{"command":"str_replace","path":"package.json"}' } } };
    expect(evaluateHeadlessTaskOutcome(prompt, [...files, write, answer('CHECK_NOTE\nsample-module')]).exitCode).not.toBe(0);
  });
  it('does not treat numbered partial JSON as the entire file', () => {
    expect(evaluateHeadlessTaskOutcome('Read package.json and report the package name.',
      [read('package.json', '12: {"name":"fragment"}'), answer('fragment')]).exitCode).not.toBe(0);
  });
});

it('validates a first-line project rule for explanations as well as names', () => {
  const query = 'Explain the calculation in the entry file.';
  expect(evaluateHeadlessTaskOutcome(query, [filesForPrefix(), answer('It returns 7.')]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(query, [filesForPrefix(), answer('REVIEW_TAG\nIt returns 7.')]).reasons).not.toContain('required_prefix_missing');
});
function filesForPrefix(): TaskEvidenceEntry {
  return read('AGENTS.md', '1: Begin repository answers with REVIEW_TAG on a separate line.');
}
it.each(['The package name is not sample-module.', 'For example, a package could be called sample-module.',
  'The package name is sample-module. Actually it is different.'])('does not mistake a value mention for its restitution: %s', content => {
  expect(evaluateHeadlessTaskOutcome('Read package.json and report the package name.',
    [read('package.json', '1: {"name":"sample-module"}'), answer(content)]).exitCode).not.toBe(0);
});
it('accepts a concise affirmative restitution when the user did not demand a literal line', () => {
  expect(evaluateHeadlessTaskOutcome('Read package.json and report the package name.',
    [read('package.json', '1: {"name":"sample-module"}'), answer('The package name is sample-module.')]).exitCode).toBe(0);
});
it.each(['Read the name and return it.', 'Read the function parameters and return them below the header.',
  'Read source.js and describe it.'])('a read obligation requires a real source observation: %s', query => {
  expect(evaluateHeadlessTaskOutcome(query, [answer('Observed answer.')]).exitCode).not.toBe(0);
});
it('checks the whole quoted prefix rather than its first word', () => {
  const observations = [read('AGENTS.md', '1: Begin every answer with `BEGIN HERE` on a separate line.'),
    read('package.json', '1: {"name":"sample-module"}')];
  expect(evaluateHeadlessTaskOutcome(prompt, [...observations, answer('BEGIN\nsample-module')]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [...observations, answer('BEGIN HERE\nsample-module')]).exitCode).toBe(0);
});

it('does not invent a separate-line requirement for an inline prefix', () => {
  const query = 'Read package.json and report the package name.';
  const observations = [read('AGENTS.md', '1: Begin every answer with `NOTE:`.'),
    read('package.json', '1: {"name":"sample-module"}')];
  expect(evaluateHeadlessTaskOutcome(query, [...observations, answer('NOTE: sample-module')]).exitCode).toBe(0);
  expect(evaluateHeadlessTaskOutcome(query, [...observations, answer('NOTE: wrong-module')]).exitCode).not.toBe(0);
});

it('does not confuse outputting a JSON field with explaining program stdout', () => {
  const query = 'Read package.json and output only the package name.';
  expect(evaluateHeadlessTaskOutcome(query, [read('package.json', '1: {"name":"sample-module"}'), answer('sample-module')]).exitCode).toBe(0);
});
