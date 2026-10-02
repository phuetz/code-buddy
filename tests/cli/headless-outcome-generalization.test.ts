import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome, requestsRepositoryAction, type TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';

const answer = (content: string): TaskEvidenceEntry => ({ type: 'assistant', content });
const shell = (command: string): TaskEvidenceEntry => ({
  type: 'tool_result', content: 'completed',
  toolCall: { id: 'executed', function: { name: 'bash', arguments: JSON.stringify({ command }) } },
  toolResult: { success: true, output: 'completed' },
});

describe('review regressions: completion predicates independent of the recipe', () => {
  it.each([
    'I created an overview of the repository.',
    'I created a summary of what I read.',
    "J'ai créé une liste des dépendances.",
    'I modified my initial hypothesis after reading the code.',
    "J'ai créé un résumé du projet.",
    'I updated my notes after reading index.js.',
    'Created a brief outline of the architecture.',
    'We changed our interpretation of the parser.',
  ])('does not turn a cognitive object into a file mutation: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain the repository', [answer(content)]).exitCode).toBe(0);
  });

  it.each([
    'I ran the linter and fixed all errors.',
    'I ran the build and it succeeded.',
    'I ran the migration successfully.',
    'I ran eslint and cleaned up the warnings.',
    'I started the server and it is now running.',
    "J'ai lancé le build et il a réussi.",
    'I ran docker compose up.',
    'I ran the linter.',
    'Ran the linter and fixed all errors.',
    'We launched the deployment.',
    "J'ai démarré le service.",
    'Executed an unfamiliar-validator.',
  ])('requires evidence for every operational object, including unknown commands: %s', content => {
    for (const entries of [[], [shell('ls .')]]) {
      expect(evaluateHeadlessTaskOutcome('Explain', [...entries, answer(content)]).exitCode).toBe(4);
    }
  });

  it.each([
    'I created overview.md.',
    'I created a summary file.',
    'I updated my notes/ directory.',
    'I updated the file containing my notes.',
    'I modified my hypothesis in config.json.',
    'I ran analysis.py.',
    'I created a mental model and I started the server.',
    'I created a summary, then ran docker compose up.',
  ])('does not let a cognitive noun waive a physical target or another assertion: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [answer(content)]).exitCode).toBe(4);
  });

  it.each([
    'I ran npm run build.', 'I ran the build.', 'Ran npm run build.',
  ])('accepts the corresponding observed command: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [shell('npm run build'), answer(content)]).exitCode).toBe(0);
  });

  it.each([
    'Quel fichier contient le bug ? Corrige-le.',
    'Where is greet defined? Fix it.',
    'Which file has the error? Replace the greeting.',
    'Explain this module. Update the configuration.',
    'Where is the queue? Set its limit to 20.',
    'What is the bug?\nRepair it.',
    'Describe the API; implement authentication.',
    'Quelle fonction échoue ?Corrige-la.',
  ])('requires the second instruction without a connector: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(true);
    expect(evaluateHeadlessTaskOutcome(prompt, [answer('Done.')]).exitCode).not.toBe(0);
    expect(evaluateHeadlessTaskOutcome(prompt, [shell('ls .'), answer('Done.')]).exitCode).not.toBe(0);
  });

  it.each([
    'Where is the parser? What arguments does it take?',
    'Explain the code and summarize its imports.',
    'Show the function. Do not edit any file.',
    'Where does the documentation say "Fix it"?',
  ])('preserves informational and quoted requests: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(false);
    expect(evaluateHeadlessTaskOutcome(prompt, [answer('Observed answer.')]).exitCode).toBe(0);
  });
});

// Seeing an executable name in echoed text or a filename is not running it.
it.each(['echo build', 'cat build.js', 'ls build', 'node --check server.js'])(
  'does not confuse inspection with the asserted operation: %s', command => {
    const content = command.includes('server') ? 'I started the server.' : 'I ran the build.';
    expect(evaluateHeadlessTaskOutcome('Explain', [shell(command), answer(content)]).exitCode).toBe(4);
  },
);

it.each(['I ran all the tests.', 'I executed the project test suite.', 'I ran the project checks.'])(
  'accepts normal quantifiers and verification nouns with genuine test execution: %s', content => {
    const executed = shell('npm test');
    executed.toolResult!.output = executed.content = '# tests 2\n# fail 0';
    expect(evaluateHeadlessTaskOutcome('Explain', [executed, answer(content)]).exitCode).toBe(0);
    expect(evaluateHeadlessTaskOutcome('Explain', [shell('ls .'), answer(content)]).exitCode).toBe(4);
  },
);

it.each(['ls tests', 'echo tests', 'echo "# tests 2\n# fail 0"'])(
  'requires test execution rather than inspection or echoed summaries: %s', command => {
    const inspected = shell(command);
    inspected.toolResult!.output = inspected.content = '# tests 2\n# fail 0';
    for (const content of ['I ran the tests.', 'All tests passed.']) {
      expect(evaluateHeadlessTaskOutcome('Explain', [inspected, answer(content)]).exitCode).toBe(4);
    }
  },
);

// The full independent review corpus, separate from the held-out model tasks.
it.each([
  "I ran into a problem while reading index.js.",
  "I ran into an issue with the parser.",
  "I ran across a mismatch between the two files.",
  "J'ai lancé une recherche pour retrouver la fonction.",
  "J'ai lancé l'analyse statique du projet.",
  "I created an overview of the repository.",
  "I created a summary of what I read.",
  "J'ai créé une liste des dépendances.",
  "I modified my initial hypothesis after reading the code.",
  "This file was created by the build step.",
  "The test suite was created automatically by the scaffold.",
  "I ran out of time before finishing.",
  "I ran through the logic of index.js.",
  "J'ai exécuté le raisonnement dans ma tête.",
  "I executed a mental walk-through of the flow.",
  "I have not run npm test yet.",
  "I didn't modify any file.",
  "I will run the tests once the environment is ready.",
  "If I had run npm test, it would have failed.",
  "Il faudrait lancer npm test mais je n'ai pas encore pu.",
  "The program runs greet at startup.",
  "When executed, index.js calls greet.",
  "L'utilisateur a lancé npm test avant moi.",
  "This script executes on import.",
  "Le point d'entrée exécute greet.js.",
  "I used ls to inspect the directory.",
  "I read index.js to find the entry point.",
  "J'ai utilisé cat pour lire le manifeste.",
  "I inspected the repository structure.",
  "I checked package.json."
])('preserves every honest formulation from the independent review: %s', content => {
  expect(evaluateHeadlessTaskOutcome('Explain', [answer(content)]).exitCode).toBe(0);
});

it.each(['eslint .', 'npm run lint', 'lint_project'])(
  'recognizes the observed lint role without requiring its literal executable name: %s', command => {
    const executed = command === 'lint_project' ? { ...shell(''), toolCall: { id: 'lint', function: { name: 'lint_project', arguments: '{}' } } } : shell(command);
    expect(evaluateHeadlessTaskOutcome('Explain', [executed, answer('I ran the linter.')]).exitCode).toBe(0);
    expect(evaluateHeadlessTaskOutcome('Explain', [shell('npm test'), answer('I ran the linter.')]).exitCode).toBe(4);
  },
);

it.each([
  "Quel est le point d'entrée ? Réécris-le.",
  'Where is the cache? Synchronize it.',
  'Explain the parser. Rework it.',
])('fails closed for an unfamiliar imperative in a subsequent sentence: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(true);
  expect(evaluateHeadlessTaskOutcome(prompt, [answer('Done.')]).exitCode).not.toBe(0);
  expect(evaluateHeadlessTaskOutcome(prompt, [shell('ls .'), answer('Done.')]).exitCode).not.toBe(0);
});

it.each([
  'Explain the callers. Write your answer as JSON.',
  'Read the code, then write only a sentence in response.',
  'Show the default. After reading, output only the value.',
  'Describe the exports. Respect AGENTS.md and use only the export names in your answer.',
])('distinguishes response formatting from repository changes: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(false);
  expect(evaluateHeadlessTaskOutcome(prompt, [answer('Observed answer.')]).exitCode).toBe(0);
});

it.each([
  'Show the default. Write your answer to report.md.',
  'Describe the exports. Write only the names into a file.',
  'Explain the code. Do not alter the tests, but repair the module.',
])('does not use output or negative constraints to waive requested work: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(true);
  expect(evaluateHeadlessTaskOutcome(prompt, [answer('Done.')]).exitCode).not.toBe(0);
});

it('requires the explicit edit as well as the requested green check', () => {
  const checked = shell('npm test'); checked.toolResult!.output = checked.content = '# tests 2\n# fail 0';
  expect(evaluateHeadlessTaskOutcome('Run npm test. Then replace the label in button.js.', [checked, answer('Done.')]).exitCode).not.toBe(0);
});
it('treats a subordinate formatting preamble as part of the output instruction', () => {
  expect(requestsRepositoryAction('Read the declaration. After the header, write only the numeric value.')).toBe(false);
  expect(requestsRepositoryAction('Read the declaration. After the header, write data.json.')).toBe(true);
});
it('does not use an unrelated successful shell inspection for an unfamiliar mutation', () => {
  expect(evaluateHeadlessTaskOutcome('Where is the cache? Synchronize it.', [shell('grep cache source.js'), answer('Done.')]).exitCode).not.toBe(0);
});
it('verifies requests to make tests pass even when the verb is not run', () => {
  const edit: TaskEvidenceEntry = { type: 'tool_result', content: 'updated', toolCall: { id: 'edit', function: { name: 'str_replace_editor', arguments: '{"path":"source.js"}' } }, toolResult: { success: true } };
  expect(evaluateHeadlessTaskOutcome('Make the failing tests pass.', [edit, answer('Done.')]).exitCode).not.toBe(0);
  const checked = shell('npm test'); checked.toolResult!.output = checked.content = '# tests 2\n# fail 0';
  expect(evaluateHeadlessTaskOutcome('Make the failing tests pass.', [checked, answer('Done.')]).exitCode).toBe(0);
});

it.each(['I created an analysis script.', 'Created an overview module.', 'I created a model.'])(
  'does not waive physical or ambiguous creation without evidence: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [answer(content)]).exitCode).toBe(4);
  },
);

it.each([
  'Read the setting. After the header return it alone.',
  'Describe the exports. No commentary afterwards.',
  'Read the options. After inspection, output only the raw datum.',
])('treats presentation instructions as output, regardless of their object vocabulary: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(false);
  expect(evaluateHeadlessTaskOutcome(prompt, [answer('Observed answer.')]).exitCode).toBe(0);
});

it.each([
  'Where is the cache? No commentary, synchronize it.',
  'Where is the cache? No commentary and synchronize it.',
  'Where is the formatter? Return only null from the function.',
])('does not let a presentation constraint absorb a following action: %s', prompt => {
  expect(requestsRepositoryAction(prompt)).toBe(true);
  expect(evaluateHeadlessTaskOutcome(prompt, [answer('Done.')]).exitCode).not.toBe(0);
});

it('requires a real green suite for a request to check a test suite', () => {
  const edit: TaskEvidenceEntry = { type: 'tool_result', content: 'updated', toolCall: { id: 'edit', function: { name: 'str_replace_editor', arguments: '{"path":"worker.js"}' } }, toolResult: { success: true } };
  expect(evaluateHeadlessTaskOutcome('Check the test suite and correct the implementation.', [edit, answer('Done.')]).exitCode).not.toBe(0);
});

it('does not mistake an echoed summary for the required executed suite', () => {
  const fake = shell('node -e \'console.log("# tests 2\\n# fail 0")\'');
  fake.toolResult!.output = fake.content = '# tests 2\n# fail 0';
  expect(evaluateHeadlessTaskOutcome('Run the tests.', [fake, answer('Done.')]).exitCode).not.toBe(0);
});

const edited = (path: string): TaskEvidenceEntry => ({ type: 'tool_result', content: 'updated', toolCall: { id: path, function: { name: 'str_replace_editor', arguments: JSON.stringify({ path }) } }, toolResult: { success: true } });
it.each(['I edited Panel.js after reading Helpers.js.', "J'ai modifié Panel.js après lecture de Helpers.js."])(
  'scopes a physical target to its assertion rather than incidental reading: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [edited('Panel.js'), answer(content)]).exitCode).toBe(0);
  },
);
it('keeps both coordinated edit targets as evidence obligations', () => {
  expect(evaluateHeadlessTaskOutcome('Explain', [edited('Panel.js'), answer('I edited Panel.js and Helpers.js.')]).exitCode).toBe(4);
});
it('does not mistake a quoted reading target for an executed command', () => {
  expect(evaluateHeadlessTaskOutcome('Explain', [shell('npm test'), answer('I ran `npm test` after reading `package.json`.')]).exitCode).toBe(0);
});
it('preserves the explicitly mental model exception', () => {
  expect(evaluateHeadlessTaskOutcome('Explain', [answer('I created a mental model of the flow.')]).exitCode).toBe(0);
});

it.each(['Read the exports. Use the presentation format in AGENTS.md.', 'Lis la déclaration. Utilise le format de lecture défini dans AGENTS.md.'])(
  'does not mistake use of project presentation instructions for a mutation: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(false);
    expect(evaluateHeadlessTaskOutcome(prompt, [answer('Observed answer.')]).exitCode).toBe(0);
  },
);
it.each(['Read the exports. Use the format in output.js.', 'Read the exports. Use the format in AGENTS.md and rework the module.'])(
  'keeps physical targets and independent actions behind presentation instructions: %s', prompt => {
    expect(requestsRepositoryAction(prompt)).toBe(true);
    expect(evaluateHeadlessTaskOutcome(prompt, [answer('Done.')]).exitCode).not.toBe(0);
  },
);


it.each(['I created an analysis tool.', 'I created an overview service.'])(
  'does not hide a software artifact behind a cognitive modifier: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [answer(content)]).exitCode).toBe(4);
  },
);
it.each(['I created an analysis of the tool.', 'I created an overview of the service.'])(
  'preserves a cognitive account whose subject is a software artifact: %s', content => {
    expect(evaluateHeadlessTaskOutcome('Explain', [answer(content)]).exitCode).toBe(0);
  },
);
