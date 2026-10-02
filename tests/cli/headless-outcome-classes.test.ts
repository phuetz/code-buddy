import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, requestsRepositoryAction, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';
const reply = (content: string): TaskEvidenceEntry => ({ type: 'assistant', content });
const inspected: TaskEvidenceEntry = { type: 'tool_result', content: 'files', toolCall: { id: 'read', function: { name: 'bash', arguments: '{"command":"ls ."}' } }, toolResult: { success: true } };

describe('informational restitution and independent unknown operations', () => {
  const subjects = ['the name', 'the imports in source.js', 'the function parameters', 'the call site'];
  const restitution = ['return it', 'return its current value', 'return the answer as JSON', 'return them below the header'];
  it.each(subjects.flatMap(subject => restitution.map(output => `Read ${subject} and ${output}. No extra text.`)))('accepts a restitution without requiring an edit: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(false);
    expect(evaluateHeadlessTaskOutcome(prompt, [reply('Observed answer.')]).exitCode).toBe(0);
  });
  it.each(['modernize it', 'convert it to TypeScript', 'rename the function', 'inline the helper', 'enable strict mode', 'increase coverage', 'recalibrate it', 'transpose the implementation'])(
    'keeps an unfamiliar operation after an informative clause: %s', operation => {
      for (const connector of [' and ', ' et ', '; ', '. ']) {
        const prompt = `Explain the code${connector}${operation}.`;
        expect(requestsRepositoryAction(prompt)).toBe(true);
        expect(evaluateHeadlessTaskOutcome(prompt, [inspected, reply('Done.')]).exitCode).not.toBe(0);
      }
    },
  );
  it.each(['Read the function and return its parameters.', 'Read the file. Return the default value.', 'Show the name. No extra text.', 'List the exports and return them.', 'Explain files and folders.', 'Read the value and return it, no commentary.', 'Read the value. Return it alone, with no extra text.', 'Read the constant and give me its value, no explanation.', 'Read the constant and give me its value.', 'Read the name property in package.json and present it using the reading rule imposed by AGENTS.md. Return just the name below the required header. No extra text, no chatter.'])('preserves information and output constraints: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(false);
  });
  it.each(['Explain code and return early from the function.', 'Read the value and return it to result.json.', 'Explain code and return it, modernize the module.'])('does not hide a mutation inside restitution: %s', prompt => {
    expect(evaluateHeadlessTaskOutcome(prompt, [reply('Done.')]).exitCode).not.toBe(0);
  });
});

describe('cognitive objects versus physical destinations', () => {
  it.each(['We ran through the algorithm by hand.', "J'ai modifié ma compréhension du flux après lecture.", 'I created an index of the exported symbols.', 'I created a list of every import in index.js.', 'I created a summary of the functions in lib/worker.ts.', 'I created an outline of the configuration in settings.json.', 'I modified my understanding of the code in parser.py.'])(
    'preserves cognitive descriptions including their source locations: %s', content => {
      expect(evaluateHeadlessTaskOutcome('Explain', [reply(content)]).exitCode).toBe(0);
    },
  );
  it.each(['I created an index file.', 'I created an index in exports.json.', 'I created a list in imports.md.', 'I created a list of imports and wrote it to notes.md.', 'I modified my understanding in settings.json.', 'I ran algorithm.py by hand.', 'I executed the algorithm.', 'I ran the linter by hand.', 'We ran through ./algorithm.py.'])(
    'still requires evidence for physical writes and execution: %s', content => {
      expect(evaluateHeadlessTaskOutcome('Explain', [inspected, reply(content)]).exitCode).toBe(4);
    },
  );
});
it('keeps an unfamiliar mutation obligatory even when a different requested check succeeded', () => {
  const checked: TaskEvidenceEntry = { type: 'tool_result', content: '# tests 2\n# fail 0', toolCall: { id: 'check', function: { name: 'bash', arguments: '{"command":"npm test"}' } }, toolResult: { success: true, output: '# tests 2\n# fail 0' } };
  const prompt = 'Explain the parser and modernize it. Run npm test.';
  expect(evaluateHeadlessTaskOutcome(prompt, [checked, reply('Done.')]).exitCode).not.toBe(0);
  const edited: TaskEvidenceEntry = { type: 'tool_result', content: 'updated', toolCall: { id: 'edit', function: { name: 'str_replace_editor', arguments: '{"path":"parser.js"}' } }, toolResult: { success: true } };
  expect(evaluateHeadlessTaskOutcome(prompt, [edited, checked, reply('Done.')]).exitCode).toBe(0);
});
it.each(['I created an index on users.', 'I created an index for the orders table.', 'I created an index.'])(
  'keeps ambiguous or operational index claims closed without a successful tool: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain the module.', [reply(content)]).exitCode).toBe(4);
  },
);
it.each(['I created an index of the exported symbols.', 'I created an index of configuration keys.', 'I created an index of functions in lib/api.mjs.'])(
  'accepts an index describing its cognitive subject rather than asserting an operation: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain the module.', [reply(content)]).exitCode).toBe(0);
  },
);
