import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';
import {
  CKG_SYNC_METHOD,
  _unwirePeerCkgBridgeForTests,
  pullFromPeer,
  serveCkgDelta,
  wirePeerCkgBridge,
  type CkgSyncResponse,
} from '../../src/fleet/peer-ckg-bridge.js';
import {
  _resetPeerRpcForTests,
  dispatchPeerRequest,
  type PeerMethodContext,
  type PeerResponseFrame,
} from '../../src/server/websocket/peer-rpc.js';

const context: PeerMethodContext = {
  connectionId: 'requesting-peer',
  scopes: ['*'],
  traceId: 'trace-ckg-test',
  depth: 0,
};

function payloadOf(response: PeerResponseFrame): CkgSyncResponse {
  expect(response.ok).toBe(true);
  return response.payload as CkgSyncResponse;
}

describe('peer.ckg.sync', () => {
  let directory: string;
  let source: CollectiveKnowledgeGraph;
  let destination: CollectiveKnowledgeGraph;
  let statePath: string;
  let clock: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'peer-ckg-bridge-'));
    source = new CollectiveKnowledgeGraph({
      ledgerPath: join(directory, 'source', 'ckg-ledger.jsonl'),
      agentId: 'source/local',
    });
    destination = new CollectiveKnowledgeGraph({
      ledgerPath: join(directory, 'destination', 'ckg-ledger.jsonl'),
      agentId: 'destination/local',
    });
    statePath = join(directory, 'destination', 'sync-state.json');
    clock = Date.parse('2026-07-15T10:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    delete process.env.CODEBUDDY_CKG_SYNC;
    delete process.env.CODEBUDDY_CKG_SYNC_TYPES;
    delete process.env.CODEBUDDY_CKG_SYNC_MAX;
    _unwirePeerCkgBridgeForTests();
    _resetPeerRpcForTests();
  });

  afterEach(async () => {
    _unwirePeerCkgBridgeForTests();
    _resetPeerRpcForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.CODEBUDDY_CKG_SYNC;
    delete process.env.CODEBUDDY_CKG_SYNC_TYPES;
    delete process.env.CODEBUDDY_CKG_SYNC_MAX;
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function remember(
    ckg: CollectiveKnowledgeGraph,
    type: 'lesson' | 'decision' | 'fact' | 'discovery',
    name: string,
    options: { agentId?: string; source?: string } = {},
  ): void {
    vi.setSystemTime(clock);
    const stored = ckg.remember({
      type,
      name,
      text: `${name} text`,
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.source ? { source: options.source } : {}),
    });
    expect(stored).not.toBeNull();
    clock += 1000;
  }

  async function dispatch(params: Record<string, unknown> = {}): Promise<PeerResponseFrame> {
    return dispatchPeerRequest(
      { id: `request-${clock}`, method: CKG_SYNC_METHOD, params },
      context,
    );
  }

  it('fails closed before reading the ledger when the env opt-in is absent', async () => {
    remember(source, 'fact', 'private-fact');
    const readLedger = vi.fn(() => {
      throw new Error('ledger must not be touched');
    });
    wirePeerCkgBridge({ getCkg: () => source, readLedger });

    const response = await dispatch();

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain('CKG_SYNC_NOT_ENABLED');
    expect(readLedger).not.toHaveBeenCalled();
  });

  it('fails closed on the requesting side before transport or state access', async () => {
    const request = vi.fn(async () => ({ entries: [], maxTs: 0 }));

    await expect(
      pullFromPeer('alpha', { ckg: destination, statePath, request }),
    ).rejects.toThrow('CKG_SYNC_NOT_ENABLED');

    expect(request).not.toHaveBeenCalled();
    expect(existsSync(statePath)).toBe(false);
    expect(existsSync(destination.getLedgerPath())).toBe(false);
  });

  it('serves only the default lesson/fact allowlist and intersects requested types', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';
    remember(source, 'lesson', 'lesson-one');
    remember(source, 'fact', 'fact-one');
    remember(source, 'decision', 'decision-one');
    remember(source, 'discovery', 'discovery-one');
    wirePeerCkgBridge({ getCkg: () => source });

    const defaultResponse = payloadOf(await dispatch());
    expect(defaultResponse.entries.map((entry) => entry.type)).toEqual(['lesson', 'fact']);

    const requestedResponse = payloadOf(await dispatch({ types: ['fact', 'decision'] }));
    expect(requestedResponse.entries.map((entry) => entry.type)).toEqual(['fact']);
  });

  it('allows decision only when explicitly present in CODEBUDDY_CKG_SYNC_TYPES', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';
    process.env.CODEBUDDY_CKG_SYNC_TYPES = 'fact,decision';
    remember(source, 'lesson', 'lesson-one');
    remember(source, 'fact', 'fact-one');
    remember(source, 'decision', 'decision-one');
    wirePeerCkgBridge({ getCkg: () => source });

    const response = payloadOf(await dispatch({ types: ['lesson', 'fact', 'decision'] }));

    expect(response.entries.map((entry) => entry.type)).toEqual(['fact', 'decision']);
  });

  it('does not re-serve entries whose provenance is already a remote peer', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';
    remember(source, 'fact', 'first-hand');
    remember(source, 'fact', 'gossip-agent', { agentId: 'peer:X' });
    remember(source, 'lesson', 'gossip-source', { source: 'peer:X' });
    wirePeerCkgBridge({ getCkg: () => source });

    const response = payloadOf(await dispatch());

    expect(response.entries.map((entry) => entry.name)).toEqual(['first-hand']);
  });

  it('returns only entries newer than sinceTs and reports the correct maxTs', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';
    const firstTimestamp = clock;
    remember(source, 'fact', 'old-fact');
    wirePeerCkgBridge({ getCkg: () => source });
    const first = payloadOf(await dispatch());
    expect(first.maxTs).toBe(firstTimestamp);

    const secondTimestamp = clock;
    remember(source, 'lesson', 'new-lesson');
    const second = payloadOf(await dispatch({ sinceTs: first.maxTs }));

    expect(second.entries.map((entry) => entry.name)).toEqual(['new-lesson']);
    expect(second.maxTs).toBe(secondTimestamp);
  });

  it('deduplicates by entry id and records peer provenance through normal CKG ingestion', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';
    remember(source, 'lesson', 'shared-lesson');
    remember(source, 'fact', 'shared-fact');
    const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
      // Deliberately ignore the cursor so the second run receives the same ids.
      return serveCkgDelta({ ...params, sinceTs: 0 }, source);
    });

    const first = await pullFromPeer('alpha', { ckg: destination, statePath, request });
    const ledgerAfterFirst = readFileSync(destination.getLedgerPath(), 'utf8');
    const second = await pullFromPeer('alpha', { ckg: destination, statePath, request });
    const ledgerAfterSecond = readFileSync(destination.getLedgerPath(), 'utf8');

    expect(first).toMatchObject({ ingested: 2, skipped: 0, wouldIngest: 2 });
    expect(second).toMatchObject({ ingested: 0, skipped: 2, wouldIngest: 0 });
    expect(ledgerAfterSecond).toBe(ledgerAfterFirst);
    const recalled = destination.recall('', { types: ['lesson', 'fact'], limit: 10 });
    expect(recalled).toHaveLength(2);
    expect(recalled.every((entry) => entry.agentId === 'peer:alpha')).toBe(true);
    expect(recalled.every((entry) => entry.source === 'peer:alpha')).toBe(true);
  });

  it('lets native CKG corroboration count the same fact from two independent peers', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';
    remember(source, 'fact', 'corroborated-fact');
    const request = async (_method: string, params: Record<string, unknown>) =>
      serveCkgDelta(params, source);

    await pullFromPeer('alpha', { ckg: destination, statePath, request });
    await pullFromPeer('beta', { ckg: destination, statePath, request });

    const [fact] = destination.recall('corroborated fact', { types: ['fact'], limit: 1 });
    expect(fact).toMatchObject({
      id: 'fact:collective:corroborated-fact',
      corroborations: 2,
      confidence: 0.92,
    });
  });

  it('enforces CODEBUDDY_CKG_SYNC_MAX as a hard per-run ingestion bound', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';
    process.env.CODEBUDDY_CKG_SYNC_MAX = '2';
    remember(source, 'fact', 'fact-one');
    remember(source, 'fact', 'fact-two');
    remember(source, 'lesson', 'lesson-three');
    remember(source, 'lesson', 'lesson-four');
    const request = async (_method: string, params: Record<string, unknown>) =>
      serveCkgDelta(params, source);

    const result = await pullFromPeer('bounded-peer', {
      ckg: destination,
      statePath,
      request,
      limit: 500,
    });

    expect(result.ingested).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(destination.recall('', { limit: 10 })).toHaveLength(2);
  });

  it('keeps both ledger and sync state untouched during dry-run', async () => {
    process.env.CODEBUDDY_CKG_SYNC = 'true';
    remember(source, 'fact', 'preview-fact');
    const request = async (_method: string, params: Record<string, unknown>) =>
      serveCkgDelta(params, source);

    const result = await pullFromPeer('preview-peer', {
      ckg: destination,
      statePath,
      request,
      dryRun: true,
    });

    expect(result).toMatchObject({ dryRun: true, ingested: 0, wouldIngest: 1 });
    expect(existsSync(destination.getLedgerPath())).toBe(false);
    expect(existsSync(statePath)).toBe(false);
  });

  describe('hardening against a malicious peer (post-review)', () => {
    function syncEntry(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        v: 1,
        kind: 'entity',
        recordedAt: new Date(clock).toISOString(),
        agentId: 'malicious/first-hand',
        contentHash: `hash-${name}`,
        id: `id-${name}`,
        type: 'fact',
        name,
        text: `${name} text`,
        ...overrides,
      };
    }

    function pullWith(response: Record<string, unknown>, limit = 2) {
      process.env.CODEBUDDY_CKG_SYNC = 'true';
      const request = async () => response;
      return pullFromPeer('hostile-peer', { ckg: destination, statePath, request, limit });
    }

    it('rejects a page larger than the requested limit without ingesting anything', async () => {
      const entries = [syncEntry('a'), syncEntry('b'), syncEntry('c')];
      await expect(pullWith({ entries, maxTs: clock }, 2)).rejects.toThrow(/more entries than requested/);
      expect(existsSync(destination.getLedgerPath())).toBe(false);
    });

    it('rejects oversized entry fields (ledger bloat protection)', async () => {
      const entries = [syncEntry('giant', { text: 'x'.repeat(20_000) })];
      await expect(pullWith({ entries, maxTs: clock }, 5)).rejects.toThrow(/disallowed or malformed/);
      expect(existsSync(destination.getLedgerPath())).toBe(false);
    });

    it('rejects a poisoned maxTs far in the future (cursor freeze protection)', async () => {
      const entries = [syncEntry('honest')];
      await expect(pullWith({ entries, maxTs: clock + 10 * 60 * 1000 }, 5)).rejects.toThrow(
        /unreasonably far in the future/,
      );
    });

    it('rejects a maxTs that does not match the newest returned entry', async () => {
      const entries = [syncEntry('honest')];
      await expect(pullWith({ entries, maxTs: clock + 1 }, 5)).rejects.toThrow(
        /must equal the newest returned entry/,
      );
    });

    it('never lets a peer supersede first-hand local knowledge — it coexists instead', async () => {
      process.env.CODEBUDDY_CKG_SYNC = 'true';
      const local = destination.remember({ type: 'fact', name: 'shared-key', text: 'local truth' });
      expect(local).not.toBeNull();

      const remoteText = 'remote different claim';
      const entries = [syncEntry('shared-key', { text: remoteText })];
      const result = await pullWith({ entries, maxTs: clock }, 5);
      expect(result.ingested).toBe(1);

      const current = destination.getCurrentEntity('fact', 'shared-key');
      expect(current?.text).toBe('local truth');

      const { createHash } = await import('crypto');
      const disambiguator = createHash('sha256').update(`fact|${remoteText}`).digest('hex').slice(0, 8);
      const coexisting = destination.getCurrentEntity('fact', `shared-key#peer-${disambiguator}`);
      expect(coexisting?.text).toBe(remoteText);
      expect(coexisting?.contributors.every((contributor) => contributor.startsWith('peer:'))).toBe(true);
    });
  });
});
