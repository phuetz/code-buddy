import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseEvolutionNotes,
  queryEvolutionNotes,
  readEvolutionNotes,
} from '../../src/self-model/evolution-notes.js';

const fixture = `## [2.0.0] (2026-08-26)

### Le robot n'entend plus sa propre voix — nuit du 2 au 3 septembre 2026

Le filtre évite que Lisa se réponde à elle-même.

- **Garde** : activée par défaut, avec l'option CODEBUDDY_SENSORY_AEC_TRUST=true pour l'opt-in.
- **Œil** : le bruit est filtré avec BUDDY_VISION_MOTION.
- **Commande** : utiliser \`buddy self evolution\`.

### Fiabilité mesurée — 2 septembre 2026

- Les annonces sont vérifiées par des essais concrets.
`;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('evolution notes self-model', () => {
  it('parses dated sections, facts, variables, commands, and activation', () => {
    const notes = parseEvolutionNotes(fixture);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      date: '2026-09-03',
      title: "Le robot n'entend plus sa propre voix",
      variables: ['CODEBUDDY_SENSORY_AEC_TRUST', 'BUDDY_VISION_MOTION'],
      commands: ['buddy self evolution'],
      activation: 'mixed',
    });
    expect(notes[0]?.facts.every((fact) => /[.!?…]$/.test(fact))).toBe(true);
  });

  it('filters by date and subject in newest-first order', () => {
    const notes = parseEvolutionNotes(fixture);
    expect(queryEvolutionNotes(notes, { since: '2026-09-02', subject: 'fiabilité' }).map((note) => note.title))
      .toEqual(['Fiabilité mesurée']);
    expect(queryEvolutionNotes(notes, { limit: 1 })[0]?.date).toBe('2026-09-03');
  });

  it('caches under the project config directory and rebuilds when the source changes', async () => {
    const workDir = await fs.mkdtemp(path.join(process.cwd(), '.evo1-test-'));
    temporaryDirectories.push(workDir);
    const changelogPath = path.join(workDir, 'CHANGELOG.md');
    await fs.writeFile(changelogPath, fixture, 'utf8');

    const first = await readEvolutionNotes({ workDir });
    const cachePath = path.join(workDir, '.codebuddy', 'self-model', 'evolution.json');
    expect(first).toHaveLength(2);
    expect(await fs.stat(cachePath)).toBeTruthy();

    await fs.writeFile(changelogPath, `${fixture}\n### Nouvelle note — 2026-09-01\n\n- Un fait.\n`, 'utf8');
    const second = await readEvolutionNotes({ workDir });
    expect(second).toHaveLength(3);
  });
});
