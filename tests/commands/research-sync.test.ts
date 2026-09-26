import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { addKnowledgeSubcommands } from '../../src/commands/research/knowledge-ingest.js';
import { logger } from '../../src/utils/logger.js';
import { CollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';
import {
  CKG_SYNC_METHOD,
  _unwirePeerCkgBridgeForTests,
  pullFromPeer,
  wirePeerCkgBridge,
} from '../../src/fleet/peer-ckg-bridge.js';
import {
  _resetPeerRpcForTests,
  dispatchPeerRequest,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('buddy research sync (end to end)', () => {
  let logCalls: string[];
  let errorCalls: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let tempDir: string;
  let source: CollectiveKnowledgeGraph;
  let destination: CollectiveKnowledgeGraph;
  const peerContext: PeerMethodContext = {
    connectionId: 'alpha-peer',
    scopes: ['*'],
    traceId: 'research-sync-test',
    depth: 0,
  };

  beforeEach(async () => {
    logCalls = [];
    errorCalls = [];
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(logger, 'error').mockImplementation((msg: string | Error) => {
      errorCalls.push(msg instanceof Error ? msg.message : String(msg));
    });
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logCalls.push(msg);
    });
    vi.spyOn(console, 'error').mockImplementation((msg: string) => {
      errorCalls.push(msg);
    });

    tempDir = await mkdtemp(join(tmpdir(), 'buddy-research-sync-e2e-'));

    source = new CollectiveKnowledgeGraph(join(tempDir, 'source'));
    destination = new CollectiveKnowledgeGraph(join(tempDir, 'destination'));
    source.remember({ type: 'fact', name: 'e2e-fact', text: 'This is an end to end test fact' });
    source.remember({ type: 'lesson', name: 'e2e-lesson', text: 'Lessons are synchronized too' });

    wirePeerCkgBridge({ getCkg: () => source });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    _unwirePeerCkgBridgeForTests();
    _resetPeerRpcForTests();
    delete process.env.CODEBUDDY_CKG_SYNC;
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const getDeps = () => async () => {
    return {
      log: (msg: string) => logCalls.push(msg),
      warn: (msg: string) => logCalls.push(msg),
      error: (msg: string) => errorCalls.push(msg),
      syncFromPeer: async (id: string, opts: { dryRun?: boolean }) => {
        return pullFromPeer(id, {
          ...opts,
          ckg: destination,
          statePath: join(tempDir, 'destination-sync-state.json'),
          request: async (method: string, params: Record<string, unknown>) => {
            expect(method).toBe(CKG_SYNC_METHOD);
            const response = await dispatchPeerRequest({ id: 'sync-page', method, params }, peerContext);
            if (!response.ok) throw new Error(response.error?.message ?? 'Peer CKG request failed');
            return response.payload;
          },
        });
      },
    };
  };

  it('runs sync end to end and ingests peer facts into local CKG', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';

    const command = new Command('test');
    addKnowledgeSubcommands(command, getDeps());
    await command.exitOverride().parseAsync(['node', 'test', 'sync', 'alpha-peer']);

    expect(errorCalls).toEqual([]);
    expect(exitSpy).not.toHaveBeenCalled();
    const output = logCalls.join('\n');
    expect(output).toContain('CKG synchronisé depuis alpha-peer');
    expect(output).toContain('2 ingérée(s)');
    expect(output).toMatch(/curseur \d+/);

    const recalled = destination.recall('', { types: ['fact', 'lesson'], limit: 10 });
    expect(recalled).toHaveLength(2);
    expect(recalled.map((entry) => entry.name)).toContain('e2e-fact');
  });
});
