vi.mock('../../src/embeddings/embedding-provider.js', () => ({
  EmbeddingProvider: class {
    async initialize(): Promise<void> {
      throw new Error('embedding init failed');
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

describe('WorkspaceIndexer', () => {
  it('does not start indexing when initialization fails', async () => {
    const indexer = new WorkspaceIndexer({
      workspaceRoot: process.cwd(),
      indexPath: 'unused-workspace-index.bin',
    });
    const errorHandler = vi.fn();
    indexer.on('indexing:error', errorHandler);

    await indexer.initialize();
    await expect(indexer.startIndexing()).resolves.toBeUndefined();

    expect(errorHandler).not.toHaveBeenCalled();
  });
});
