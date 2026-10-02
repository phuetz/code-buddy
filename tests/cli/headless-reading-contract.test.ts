import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, requestsRepositoryAction, unsupportedActionClaims } from '../../src/cli/headless-task-outcome.js';

describe('reading contracts expressed with different grammatical heads', () => {
  it.each(['Identify', 'Locate', 'Inspect', 'Consult', 'Report', 'Outline', 'Highlight', 'State', 'Mention', 'Recense', 'Identifie', 'Repère', 'Consulte', 'Indique'])(
    'recognizes a reading/restitution verb without inventing a mutation: %s', verb => {
      expect(requestsRepositoryAction(`${verb} the declaration in source.js.`)).toBe(false);
      expect(requestsRepositoryAction(`${verb} the declaration in source.js, then rework it.`)).toBe(true);
    },
  );
  it.each([
    'Explain source.js, using two bullets.',
    'Tell me its inputs and outputs.',
    'Read README. Keep the reply short.',
    'Read the manifest and give the package name. Nothing else.',
    'Lis les règles et applique-les à ta réponse.',
  ])('keeps presentation and coordinated objects within the reading contract: %s', prompt => {
    expect(evaluateHeadlessTaskOutcome(prompt, [{ type: 'assistant', content: 'Observed answer.' }]).exitCode).toBe(0);
  });
  it.each([
    'Explain source.js, including writing notes.md.',
    'Describe the code, with a file saved to summary.txt.',
    'Read README. Keep the server running.',
    'Explain code. The source must be modernized.',
    'Explain code and deploy.',
  ])('retains operational obligations even inside a modifier: %s', prompt => {
    expect(evaluateHeadlessTaskOutcome(prompt, [{ type: 'assistant', content: 'Done.' }]).exitCode).not.toBe(0);
  });
  it.each(['C++', 'C#', 'F#', 'Lua', 'Kotlin'])(
    'requires the source conversion to %s, including punctuation in language names', language => {
      expect(requestsRepositoryAction(`Read source.js and translate it to ${language}.`)).toBe(true);
    },
  );
  it('distinguishes a mental map and walkthrough from on-disk or executed artifacts', () => {
    expect(unsupportedActionClaims('I created a mental map of the dependencies.', [])).toEqual([]);
    expect(unsupportedActionClaims('I ran through the examples in my head.', [])).toEqual([]);
    expect(unsupportedActionClaims('I created a mental map in notes.json.', [])).toContain('create');
    expect(unsupportedActionClaims('I ran through runner.py in my head.', [])).toContain('run');
  });
});
it('does not confuse giving a function a parameter with giving the user an answer', () => {
  expect(requestsRepositoryAction('Read source.js and give the function a second parameter.')).toBe(true);
  expect(requestsRepositoryAction('Read source.js and give me the parameter names.')).toBe(false);
});
it('distinguishes French restrictive ne…que from a prohibition', () => {
  expect(requestsRepositoryAction('Ne modifie que config.json.')).toBe(true);
  expect(requestsRepositoryAction('Ne lis que config.json.')).toBe(false);
  expect(requestsRepositoryAction('Ne modifie aucun fichier.')).toBe(false);
  expect(requestsRepositoryAction('Ne modifie jamais config.json.')).toBe(false);
});
