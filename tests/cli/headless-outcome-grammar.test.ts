import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, requestsRepositoryAction, unsupportedActionClaims, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';

const reply = (content: string): TaskEvidenceEntry => ({ type: 'assistant', content });
const read: TaskEvidenceEntry = { type: 'tool_result', content: 'observed', toolCall: { id: 'r', function: { name: 'view_file', arguments: '{"path":"index.js"}' } }, toolResult: { success: true } };
const edit: TaskEvidenceEntry = { type: 'tool_result', content: 'updated', toolCall: { id: 'e', function: { name: 'str_replace_editor', arguments: '{"path":"index.js"}' } }, toolResult: { success: true } };

describe('headless grammatical scope', () => {
  it.each([
    'Lis AGENTS.md et respecte-le. Quel est le nom du projet dans package.json ?',
    'Read the instructions and follow them. What is the entry point?',
    'Follow the actual imports and calculations; cite only facts in these files.',
    'Trace the imports and their dependencies, including the observed return value.',
    'Describe the code, with the result on the final line.',
    'List the files and their imports.',
    'Ne suppose aucune intention; décris seulement le code.',
    'Ne change rien. Donne le nom du module.',
    'Décris le flux, en incluant sa sortie observée.',
    'Summarize the file, without making assumptions.',
  ])('accepts reading obligations and dependent modifiers: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(false);
    expect(evaluateHeadlessTaskOutcome(prompt, [read, reply('Observed facts.')]).exitCode).toBe(0);
  });
  it.each(['rename the symbol', 'recalibrate it', 'translate it to Python', 'convert it to Rust'])(
    'retains an independent operation after modifiers: %s', action => {
      for (const join of [' and ', ', then ', '; ', '. ']) {
        const prompt = `Read index.js and describe it, with a concise answer${join}${action}.`;
        expect(evaluateHeadlessTaskOutcome(prompt, [read, reply('Done.')]).exitCode).not.toBe(0);
        expect(evaluateHeadlessTaskOutcome(prompt, [read, edit, reply('Done.')]).exitCode).toBe(0);
      }
    },
  );
  it.each(['Translate the explanation to French.', 'Traduis le commentaire en anglais.', 'Translate this paragraph to Spanish.'])(
    'keeps natural language translation informational: %s', prompt => expect(requestsRepositoryAction(prompt)).toBe(false),
  );
  it.each(['Python', 'TypeScript', 'Rust', 'Go'])(
    'requires a material transformation when translating source to %s', language => {
      expect(evaluateHeadlessTaskOutcome(`Read index.js and translate it to ${language}.`, [read, reply('Done.')]).exitCode).not.toBe(0);
    },
  );
  it.each(['instructions', 'steps', 'procedure'])(
    'accepts explicitly mental execution of abstract %s', subject => {
      expect(unsupportedActionClaims(`I executed the ${subject} mentally.`, [])).toEqual([]);
      expect(unsupportedActionClaims(`I executed the ${subject}.`, [])).toContain('run');
    },
  );
  it.each(['I executed script.py mentally.', 'I executed the instructions in runner.js mentally.', 'I executed npm test mentally.', 'I executed the instructions mentally and ran the build.'])(
    'does not let mental modifiers excuse physical execution: %s', content => expect(unsupportedActionClaims(content, [])).toContain('run'),
  );
});
