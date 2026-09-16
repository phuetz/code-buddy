/**
 * Preuve du trou logique : un fait auto-capturé faux gardé en mémoire persistante.
 *
 * Mécanisme (src/memory/persistent-memory.ts:1441-1489) :
 * Lorsque `FactsMemoryService` n'est pas disponible (ou échoue hors FactsExtractionError),
 * `autoCapture` se rabat sur des regex simplistes appliquées aux messages et réponses.
 *
 * Deux failles majeures :
 * 1. La regex `/(?:always |never )([^.]+)/i` capture n'importe quelle négation
 *    conversationnelle courante ("I never said that", "Ce n'est pas toujours vrai")
 *    et l'enregistre en tant que préférence persistante ('preferences').
 * 2. `autoCapture` ingère les phrases issues de la RÉPONSE de l'assistant (`response.match(pattern)`).
 *    Si l'assistant hallucine ou fait une supposition dans sa réponse ("This is a Ruby on Rails backend service"),
 *    l'affirmation est capturée et figée sur disque en tant que fait projet.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import fs from 'fs-extra';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

describe('Revue G3 — Mémoire persistante : capture automatique de faux faits et hallucinations', () => {
  let tmpDir: string;
  let projectMemoryPath: string;
  let userMemoryPath: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `cb-revue-autocapture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tmpDir);
    projectMemoryPath = path.join(tmpDir, 'project_memory.md');
    userMemoryPath = path.join(tmpDir, 'user_memory.md');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('capture à tort une négation conversationnelle ("I never said that") comme préférence persistante', async () => {
    const manager = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: true,
    });
    await manager.initialize();

    // L'utilisateur clarifie une incompréhension dans le dialogue
    await manager.autoCapture('I never said that.', 'Understood, my mistake.');

    const allMemories = [
      ...manager.listMemories('project'),
      ...manager.listMemories('user'),
    ];

    // Une dénégation ou phrase fortuite ne doit JAMAIS être capturée comme préférence
    const capturedPref = allMemories.find((m) => m.value.includes('never said that'));
    expect(capturedPref).toBeUndefined();
  });

  it('ingère et fige les hallucinations de l’assistant comme faits de projet durables', async () => {
    const manager = new PersistentMemoryManager({
      projectMemoryPath,
      userMemoryPath,
      autoCapture: true,
    });
    await manager.initialize();

    // L'utilisateur pose une question neutre, l'assistant hallucine la nature du projet
    await manager.autoCapture('Que fait ce script ?', 'This is a Ruby on Rails backend service.');

    const projectMemories = manager.listMemories('project');

    // Les réponses de l'assistant ne doivent pas auto-capturer des affirmations comme faits certains
    const fakeFact = projectMemories.find((m) => m.value.includes('Ruby on Rails'));
    expect(fakeFact).toBeUndefined();
  });
});
