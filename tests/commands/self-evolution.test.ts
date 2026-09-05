import { describe, expect, it } from 'vitest';
import { createChangelogCommand } from '../../src/commands/changelog.js';
import { createSelfCommand } from '../../src/commands/self.js';
import type { EvolutionNote } from '../../src/self-model/evolution-notes.js';

const notes: EvolutionNote[] = [
  {
    id: '2026-09-03:voice',
    date: '2026-09-03',
    title: 'Une voix plus sûre',
    facts: ['Je distingue mieux les échanges.'],
    variables: ['CODEBUDDY_SENSORY_AEC_TRUST'],
    commands: ['buddy self evolution'],
    activation: 'opt-in',
  },
  {
    id: '2026-08-26:context',
    date: '2026-08-26',
    title: 'Contexte vérifié',
    facts: ['Les informations importantes sont conservées.'],
    variables: [],
    commands: [],
    activation: 'default',
  },
];

describe('self evolution CLI', () => {
  it('uses the shared presenter through buddy changelog --self', async () => {
    const stdout: string[] = [];
    await createChangelogCommand({
      cwd: process.cwd(),
      stdout: (value) => stdout.push(value),
      readEvolutionNotes: async () => notes,
    }).parseAsync(['node', 'changelog', '--self', '--since', '2026-09-01', '--limit', '1']);

    expect(stdout.join('')).toContain('# Évolutions documentées de Code Buddy');
    expect(stdout.join('')).toContain('Une voix plus sûre');
    expect(stdout.join('')).not.toContain('Contexte vérifié');
  });

  it('provides the explicit buddy self evolution command with JSON output', async () => {
    const stdout: string[] = [];
    await createSelfCommand({
      cwd: process.cwd(),
      stdout: (value) => stdout.push(value),
      readEvolutionNotes: async () => notes,
    }).parseAsync(['node', 'self', 'evolution', '--subject', 'contexte', '--json']);

    const payload = JSON.parse(stdout.join('')) as { kind: string; notes: EvolutionNote[] };
    expect(payload.kind).toBe('self_evolution');
    expect(payload.notes.map((note) => note.title)).toEqual(['Contexte vérifié']);
  });
});
