import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addKnowledgeSubcommands, type KnowledgeIngestDeps } from '../../../src/commands/research/knowledge-ingest.js';
import { logger } from '../../../src/utils/logger.js';

function depsRejectingSync(): KnowledgeIngestDeps {
  return {
    fetchPublications: async () => [],
    ingestPublication: async () => null,
    recallHybrid: async () => [],
    getStats: () => ({ entities: 0, relations: 0, ledgerPath: 'unused' }),
    listEntities: () => [],
    rememberFact: () => ({ verdict: { kind: 'new' }, stored: null }),
    recallFacts: () => [],
    exportFactMirror: () => ({ files: [], factCount: 0 }),
    syncFromPeer: async () => {
      throw new Error('CKG_SYNC_PEER_NOT_CONNECTED: no active fleet peer');
    },
    log: () => {},
  };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('R17 research sync errors', () => {
  it('returns a clean exit code instead of an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const command = new Command('research');
    command.exitOverride();
    command.argument('<topic>').action(() => {});
    addKnowledgeSubcommands(command, async () => depsRejectingSync());

    await expect(command.parseAsync(['node', 'research', 'sync', 'no-peer'])).resolves.toBeDefined();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CKG_SYNC_PEER_NOT_CONNECTED'));
  });
});
