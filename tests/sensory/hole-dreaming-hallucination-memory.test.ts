import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSensoryMemory } from '../../src/sensory/sensory-memory.js';
import { runDreamingPass } from '../../src/sensory/dreaming.js';
import { getMemoryManager, resetMemoryManagerForTests } from '../../src/memory/persistent-memory.js';

describe('Mission SENSE3 — Trou 5 : Promotion des perceptions inventées du noir en mémoire permanente (CODEBUDDY_MEMORY.md)', () => {
  let tmp: string;

  beforeEach(async () => {
    resetMemoryManagerForTests();
    tmp = await mkdtemp(path.join(os.tmpdir(), 'dream-hole-'));
    getSensoryMemory().drain();
  });

  afterEach(async () => {
    resetMemoryManagerForTests();
    await rm(tmp, { recursive: true, force: true });
    getSensoryMemory().drain();
  });

  it('les descriptions de scènes issues de bruits d\'obscurité ne doivent pas contaminer la mémoire permanente dream:recent', async () => {
    const memoryPath = path.join(tmp, '.codebuddy', 'CODEBUDDY_MEMORY.md');
    getMemoryManager({
      projectMemoryPath: memoryPath,
      userMemoryPath: path.join(tmp, 'user-memory.md'),
    });

    // Simuler l'injection faite par vision-reaction.ts après analyse moondream d'une image noire.
    getSensoryMemory().push({
      modality: 'vision',
      kind: 'scene_described',
      salience: 150,
      tsMs: 100_000,
      receivedAt: 100_000,
      payload: {
        camera: 'brio',
        description: 'feux d artifice dans un ciel nocturne', // hallucination moondream sur image noire
        confidence: 0.9,
        motionScore: 0.03,
      },
    });

    // Exécuter la consolidation du cycle de rêve
    const summary = await runDreamingPass({ cwd: tmp, now: 105_000 });
    expect(summary).not.toBeNull();

    // Une scène sombre ne déclenche aucune écriture de mémoire permanente.
    let memoryContent = '';
    try {
      memoryContent = await readFile(memoryPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const dreamJournal = await readFile(path.join(tmp, '.codebuddy', 'companion', 'dreams.jsonl'), 'utf8');

    // Pour préserver l'intégrité cognitive du robot, une hallucination d'obscurité ne doit pas être promue.
    expect(dreamJournal).toContain('vision/scene_described');
    expect(memoryContent).not.toContain('vision/scene_described');
  });
});
