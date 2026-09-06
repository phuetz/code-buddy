import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EvolutionNotesExperienceSource,
} from '../../../src/agent/self-improvement/digest-sources.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import { SelfImprovementEngine } from '../../../src/agent/self-improvement/engine.js';
import type { EvolutionNote } from '../../../src/self-model/evolution-notes.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const note: EvolutionNote = {
  id: '2026-09-03:voice',
  date: '2026-09-03',
  title: "Le robot n'entend plus sa propre voix",
  facts: ['Le filtre évite que Lisa se réponde à elle-même.'],
  variables: ['CODEBUDDY_SENSORY_AEC_TRUST'],
  commands: [],
  activation: 'opt-in',
};

describe('evolution-notes experience source', () => {
  it('is opt-in, supplies repair context, and archives changelog provenance', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.evo1-test-'));
    roots.push(root);
    const archive = new EvolutionaryArchive({ workDir: root });
    const source = new EvolutionNotesExperienceSource({
      workDir: root,
      env: { CODEBUDDY_SELF_IMPROVE_EVOLUTION_SOURCE: 'true' },
      archive,
      readNotes: async () => [note],
    });

    const experiences = await source.collect();
    expect(experiences).toMatchObject([{
      id: 'changelog:2026-09-03:voice',
      source: 'changelog',
      kind: 'evolution-notes',
      detail: expect.stringContaining('Ce qui a été réparé et pourquoi'),
      context: expect.stringContaining('Le filtre'),
    }]);
    expect(archive.list()).toMatchObject([{
      proposalId: 'changelog:2026-09-03:voice',
      kind: 'evolution-notes',
      provenance: 'changelog',
    }]);

    await source.collect();
    expect(archive.list()).toHaveLength(1);
  });

  it('does nothing by default and the engine never writes src/', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.evo1-test-'));
    roots.push(root);
    const archive = new EvolutionaryArchive({ workDir: root });
    const source = new EvolutionNotesExperienceSource({
      workDir: root,
      env: {},
      archive,
      readNotes: async () => [note],
    });
    await expect(source.collect()).resolves.toEqual([]);
    expect(await fs.stat(archive.path).catch(() => null)).toBeNull();

    const protectedSource = path.join(process.cwd(), 'src', 'agent', 'self-improvement', 'engine.ts');
    const before = await fs.readFile(protectedSource, 'utf8');
    const engine = new SelfImprovementEngine({
      scenarios: [],
      port: {
        search: () => [],
        add: () => ({ id: 'unused' }),
        remove: () => true,
      },
      proposer: { propose: async () => null },
      archive,
      autonomy: 'propose-only',
    });
    await engine.runCycle([]);
    expect(await fs.readFile(protectedSource, 'utf8')).toBe(before);
  });
});
