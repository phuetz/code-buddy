/**
 * R34 jumeau: autoCapture must not invent facts from regex when extractFacts
 * throws FactsExtractionError (empty [] = no facts; throw = extraction failed).
 */
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

vi.mock('../../src/memory/facts-memory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/facts-memory.js')>();
  return {
    ...actual,
    FactsMemoryService: class {
      async isAvailable(): Promise<boolean> {
        return true;
      }
      async extractFacts(): Promise<never> {
        throw new actual.FactsExtractionError(
          'this is a TypeScript framework extraction failure',
        );
      }
    },
  };
});

import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';

describe('autoCapture — FactsExtractionError is not a pattern-match source', () => {
  let workspace: string;
  let manager: PersistentMemoryManager;

  beforeEach(async () => {
    workspace = makeTmpDir('r37-autocapture-', path.join(process.cwd(), 'tmp'));
    manager = new PersistentMemoryManager({
      projectMemoryPath: path.join(workspace, 'project_memory.md'),
      userMemoryPath: path.join(workspace, 'user_memory.md'),
      autoCapture: true,
    });
    await manager.initialize();
  });

  afterEach(() => {
    removeTmpDir(workspace);
  });

  it('does not store a regex fallback when fact extraction throws', async () => {
    await manager.autoCapture('hello', 'world');
    const captured = manager.listMemories('project').filter((memory) =>
      memory.tags?.includes('auto-captured'),
    );
    expect(captured).toEqual([]);
  });
});
