import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { vi } from 'vitest';

vi.mock('../../src/embeddings/embedding-provider.js', () => ({
  EmbeddingProvider: class {
    async initialize(): Promise<void> {
      // initialized
    }

    async embedBatch(chunks: string[]): Promise<{ embeddings: number[][] }> {
      return { embeddings: chunks.map(() => Array(384).fill(0.1)) };
    }

    async embed(): Promise<number[]> {
      return Array(384).fill(0.1);
    }
  },
}));

vi.mock('../../src/search/usearch-index.js', () => ({
  USearchVectorIndex: class {
    private vectors = new Map<number, number[]>();

    async initialize(): Promise<void> {
      // initialized
    }

    async add(vector: { id: string; embedding: number[] | Float32Array }): Promise<void> {
      this.vectors.set(Number(vector.id), Array.from(vector.embedding));
    }

    clear(): void {
      this.vectors.clear();
    }

    async search(): Promise<Array<{ id: string; score: number }>> {
      return Array.from(this.vectors.keys()).map((id) => ({ id: String(id), score: 1 }));
    }

    async save(_path: string): Promise<void> {
      // noop
    }

    async load(_path: string): Promise<void> {
      // noop
    }
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { WorkspaceIndexer } from '../../src/knowledge/workspace-indexer.js';
import { logger } from '../../src/utils/logger.js';

describe('WorkspaceIndexer fs-extra runtime wiring', () => {
  it('initializes and writes metadata without fs-extra namespace crashes', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'workspace-indexer-'));
    const indexPath = join(workspaceRoot, '.codebuddy', 'index', 'workspace.bin');
    writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const answer = 42;\n');

    try {
      const indexer = new WorkspaceIndexer({
        workspaceRoot,
        indexPath,
        chunkSize: 100,
        chunkOverlap: 10,
        filePatterns: ['**/*.ts'],
        ignorePatterns: [],
      });

      await indexer.initialize();
      await indexer.startIndexing();

      expect(logger.error).not.toHaveBeenCalledWith(
        'Failed to initialize WorkspaceIndexer',
        expect.anything(),
      );
      expect(existsSync(`${indexPath}.meta.json`)).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
