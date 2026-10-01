import { describe, expect, it } from 'vitest';
import { groundedEntryAnswer, exactProjectAnswer } from '../../src/cli/headless-source-answer.js';
import type { TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';
const read = (path: string, output: string, success = true): TaskEvidenceEntry => ({
  type: 'tool_result',
  content: output,
  toolCall: {
    id: path,
    function: { name: 'view_file', arguments: JSON.stringify({ path, start_line: 1 }) },
  },
  toolResult: { success, output },
});
const observations = [
  read('package.json', '1: {"main":"entry.js"}'),
  read(
    'entry.js',
    "1: const { wave } = require('./wave.js');\n2: console.log(wave('world'));\n3: "
  ),
];
describe('compact repository answers from observed source', () => {
  it('explains only the manifest, import and actual call without inventing purpose or return values', async () => {
    const answer = await groundedEntryAnswer("explique le point d'entrée", observations);
    expect(answer).toContain('entry.js');
    expect(answer).toContain("require('./wave.js')");
    expect(answer).toContain("console.log(wave('world'))");
    expect(answer).not.toMatch(/Bonjour|greeting|test|application|interface/);
  });
  it('never guesses an entry from a failed read or an unrelated successful read', async () => {
    expect(
      await groundedEntryAnswer('explain the entry point', [
        observations[0]!,
        read('entry.js', '2: console.log(42)', false),
        read('other.js', '1: console.log(42)'),
      ])
    ).toBeUndefined();
  });
  it('does not interpret file strings and comments as executable calls', async () => {
    const answer = await groundedEntryAnswer('explain the entry point', [
      observations[0]!,
      read('entry.js', '1: // console.log(secret)\n2: const text = "console.log(secret)";'),
    ]);
    expect(answer).not.toContain('secret');
  });
  it.each(['Run tests and fix failures', 'Explain the entry point then edit entry.js'])(
    'never substitutes an informational answer for a requested action: %s',
    async (query) => {
      expect(await groundedEntryAnswer(query, observations)).toBeUndefined();
    }
  );
  it('applies an exact literal instruction only to its declared subject', () => {
    const rules =
      '<project_rules>\nPour toute question sur le nom de code, réponds exactement CHECK_THIS_55, sans autre texte.\n</project_rules>';
    expect(exactProjectAnswer('Quel est le nom de code du projet ?', rules)).toBe('CHECK_THIS_55');
    expect(exactProjectAnswer('Quel est le point d’entrée ?', rules)).toBeUndefined();
    expect(
      exactProjectAnswer('Quel est le nom de code ? Puis modifie entry.js', rules)
    ).toBeUndefined();
  });
  it('does not publish credential-shaped literal project contracts', () => {
    const token = 'ghp_' + 'a'.repeat(36);
    expect(
      exactProjectAnswer(
        'What is the token?',
        `<project_rules>\nFor every question about token, reply exactly ${token}, with no other text.\n</project_rules>`
      )
    ).toBeUndefined();
  });
  it('accepts a normal ./ main spelling but never treats an external read as the entry source', async () => {
    const prefixed = [read('package.json', '1: {"main":"./entry.js"}'), observations[1]!];
    expect(await groundedEntryAnswer('Explain the entry point', prefixed)).toContain(
      '`./entry.js`'
    );
    const external = [prefixed[0]!, read('/other-project/entry.js', '1: console.log("wrong")')];
    expect(await groundedEntryAnswer('Explain the entry point', external)).toBeUndefined();
  });
});
