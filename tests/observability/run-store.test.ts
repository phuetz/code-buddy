/**
 * Tests for RunStore
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { RunStore } from '../../src/observability/run-store.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'run-store-test-'));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Ignore
  }
}

describe('RunStore', () => {
  let tmpDir: string;
  let store: RunStore;
  let activeRunIds: string[] = [];

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new RunStore(tmpDir);
    activeRunIds = [];
  });

  afterEach(async () => {
    // End all active runs to close write streams before deleting the directory
    for (const runId of activeRunIds) {
      try { store.endRun(runId, 'cancelled'); } catch { /* ignore */ }
    }
    store.dispose();
    // Give streams time to flush and close
    await new Promise(r => setTimeout(r, 80));
    cleanDir(tmpDir);
    // Reset singleton
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
  });

  // Wrapper that tracks run IDs for cleanup
  function startRun(objective: string, meta?: Parameters<RunStore['startRun']>[1]): string {
    const runId = store.startRun(objective, meta);
    activeRunIds.push(runId);
    return runId;
  }

  describe('startRun', () => {
    it('should return a unique run ID', () => {
      const id1 = startRun('objective 1');
      const id2 = startRun('objective 2');
      expect(id1).toMatch(/^run_/);
      expect(id2).toMatch(/^run_/);
      expect(id1).not.toBe(id2);
    });

    it('should create run directory with events.jsonl and metrics.json', async () => {
      const runId = startRun('test objective');
      // Give write stream time to open the file
      await new Promise(r => setTimeout(r, 30));
      const runDir = path.join(tmpDir, runId);
      expect(fs.existsSync(runDir)).toBe(true);
      expect(fs.existsSync(path.join(runDir, 'events.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(runDir, 'metrics.json'))).toBe(true);
    });

    it('should create artifacts directory', () => {
      const runId = startRun('test');
      expect(fs.existsSync(path.join(tmpDir, runId, 'artifacts'))).toBe(true);
    });

    it('should include run_start event in events.jsonl', async () => {
      const runId = startRun('my objective');
      // End run to flush stream
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 50));

      const events = store.getEvents(runId);
      const startEvent = events.find(e => e.type === 'run_start');
      expect(startEvent).toBeDefined();
      expect(startEvent?.data.objective).toBe('my objective');
    });
  });

  describe('emit', () => {
    it('should write events to JSONL file', async () => {
      const runId = startRun('emit test');
      store.emit(runId, { type: 'tool_call', data: { toolName: 'bash', args: { command: 'echo hello' } } });
      store.emit(runId, { type: 'tool_result', data: { toolName: 'bash', success: true, outputLength: 11 } });
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 50));

      const events = store.getEvents(runId);
      expect(events.length).toBeGreaterThanOrEqual(3); // run_start + 2 emits
      expect(events.some(e => e.type === 'tool_call')).toBe(true);
      expect(events.some(e => e.type === 'tool_result')).toBe(true);
    });

    it('should include timestamp and runId in each event', async () => {
      const runId = startRun('ts test');
      store.emit(runId, { type: 'decision', data: { description: 'test' } });
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 50));

      const events = store.getEvents(runId);
      for (const e of events) {
        expect(e.ts).toBeGreaterThan(0);
        expect(e.runId).toBe(runId);
      }
    });

    it('should silently ignore emit for unknown runId', () => {
      expect(() => {
        store.emit('run_unknown', { type: 'error', data: { message: 'test' } });
      }).not.toThrow();
    });
  });

  describe('endRun', () => {
    it('should update run status to completed', async () => {
      const runId = startRun('end test');
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 30));

      const record = store.getRun(runId);
      expect(record?.summary.status).toBe('completed');
      expect(record?.summary.endedAt).toBeDefined();
    });

    it('should include run_end event', async () => {
      const runId = startRun('end event test');
      store.endRun(runId, 'failed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 50));

      const events = store.getEvents(runId);
      const endEvent = events.find(e => e.type === 'run_end');
      expect(endEvent).toBeDefined();
      expect(endEvent?.data.status).toBe('failed');
    });
  });

  describe('saveArtifact', () => {
    it('should write artifact to run artifacts/ directory', () => {
      const runId = startRun('artifact test');
      const filePath = store.saveArtifact(runId, 'plan.md', '# Plan\nStep 1');

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Plan\nStep 1');
    });

    it('should return list of artifacts in getRun', () => {
      const runId = startRun('artifact list test');
      store.saveArtifact(runId, 'plan.md', 'plan content');
      store.saveArtifact(runId, 'summary.md', 'summary content');

      const record = store.getRun(runId);
      expect(record?.artifacts).toContain('plan.md');
      expect(record?.artifacts).toContain('summary.md');
    });

    it('does not reopen the SQLite artifact index after dispose()', () => {
      const runId = startRun('artifact after dispose');
      store.saveArtifact(runId, 'plan.md', 'plan content');
      const internals = store as unknown as { artifactIndexDb: unknown };
      expect(internals.artifactIndexDb).not.toBeNull();

      store.dispose();
      expect(internals.artifactIndexDb).toBeNull();

      // A post-run hook (learning retrospective) may still save artifacts: the
      // file lands, but the index handle stays released (no EBUSY on cleanup).
      const late = store.saveArtifact(runId, 'late.md', 'late content');
      expect(fs.existsSync(late)).toBe(true);
      expect(internals.artifactIndexDb).toBeNull();
      expect(() => fs.rmSync(path.join(tmpDir, 'artifact-index.sqlite'), { force: true })).not.toThrow();
    });
  });

  describe('listRuns', () => {
    it('should return runs sorted by most recent first', async () => {
      // Add delays to ensure distinct startedAt timestamps
      const id1 = startRun('run 1');
      await new Promise(r => setTimeout(r, 5));
      const id2 = startRun('run 2');
      await new Promise(r => setTimeout(r, 5));
      const id3 = startRun('run 3');

      const runs = store.listRuns();
      const ids = runs.map(r => r.runId);
      // Most recent first
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).toContain(id3);
      expect(ids.indexOf(id3)).toBeLessThan(ids.indexOf(id2));
      expect(ids.indexOf(id2)).toBeLessThan(ids.indexOf(id1));
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        startRun(`run ${i}`);
      }
      const runs = store.listRuns(3);
      expect(runs.length).toBe(3);
    });
  });

  describe('getRun', () => {
    it('should return null for unknown run', () => {
      expect(store.getRun('run_unknown')).toBeNull();
    });

    it('should return full record including metrics', () => {
      const runId = startRun('get test');
      store.updateMetrics(runId, { totalTokens: 1000, totalCost: 0.01 });

      const record = store.getRun(runId);
      expect(record).not.toBeNull();
      expect(record?.summary.objective).toBe('get test');
      expect(record?.metrics.totalTokens).toBe(1000);
      expect(record?.metrics.totalCost).toBe(0.01);
    });
  });

  describe('getArtifact', () => {
    it('should read artifact content', () => {
      const runId = startRun('artifact read test');
      store.saveArtifact(runId, 'patch.diff', '--- a/file.ts\n+++ b/file.ts\n');

      const content = store.getArtifact(runId, 'patch.diff');
      expect(content).toContain('--- a/file.ts');
    });

    it('should return null for missing artifact', () => {
      const runId = startRun('missing artifact test');
      expect(store.getArtifact(runId, 'nonexistent.md')).toBeNull();
    });
  });

  describe('searchRuns', () => {
    it('finds runs by objective, event payload, and artifact content', async () => {
      const runId = startRun('Lead Scout architect enrichment');
      store.emit(runId, {
        type: 'decision',
        data: {
          description: 'Use public directory evidence before contacting architect leads.',
        },
      });
      store.saveArtifact(
        runId,
        'summary.md',
        '# Summary\nPublic architecte evidence chain found telephone and website fields.',
      );
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 50));

      const artifactHits = store.searchRuns('telephone website', { limit: 5 });
      expect(artifactHits[0]).toMatchObject({
        runId,
        matched: 'artifact',
        artifact: 'summary.md',
        status: 'completed',
      });
      expect(artifactHits[0]?.snippet).toContain('telephone and website');

      const eventHits = store.searchRuns('public directory evidence', { includeArtifacts: false });
      expect(eventHits.some((hit) => hit.matched === 'event' && hit.eventType === 'decision')).toBe(true);

      const summaryHits = store.searchRuns('architect enrichment', {
        includeArtifacts: false,
        includeEvents: false,
      });
      expect(summaryHits).toEqual([
        expect.objectContaining({ runId, matched: 'summary' }),
      ]);
    });

    it('returns no hits for empty or missing queries', () => {
      startRun('unrelated run');

      expect(store.searchRuns('   ')).toEqual([]);
      expect(store.searchRuns('not-present')).toEqual([]);
    });

    it('supports short terms and CJK characters in search queries', async () => {
      const runId = startRun('Lead Scout db optimization with c++ and python');
      store.saveArtifact(
        runId,
        'readme.md',
        '# CJK Test\nBonjour, ce test contient des caractères comme 测试 et 日本语.',
      );
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 50));

      // Test short term (2 characters)
      const dbHits = store.searchRuns('db', { limit: 5 });
      expect(dbHits).toContainEqual(
        expect.objectContaining({ runId, matched: 'summary' }),
      );

      // Test short term (3 characters)
      const cppHits = store.searchRuns('c++', { limit: 5 });
      expect(cppHits).toContainEqual(
        expect.objectContaining({ runId, matched: 'summary' }),
      );

      // Test CJK single character
      const cjkSingleHits = store.searchRuns('测', { limit: 5 });
      expect(cjkSingleHits).toContainEqual(
        expect.objectContaining({ runId, matched: 'artifact', artifact: 'readme.md' }),
      );

      // Test CJK double character
      const cjkDoubleHits = store.searchRuns('测试', { limit: 5 });
      expect(cjkDoubleHits).toContainEqual(
        expect.objectContaining({ runId, matched: 'artifact', artifact: 'readme.md' }),
      );
    });

    it('filters recall hits by source channel and tags', async () => {
      const coworkRun = startRun('Architect discovery follow-up', {
        channel: 'cowork',
        tags: ['fleet', 'scheduled'],
      });
      const cliRun = startRun('Architect discovery command-line check', {
        channel: 'terminal',
        tags: ['local'],
      });
      store.saveArtifact(coworkRun, 'summary.md', 'Cowork Fleet architect workflow artifact.');
      store.saveArtifact(cliRun, 'summary.md', 'CLI architect workflow artifact.');
      store.endRun(coworkRun, 'completed');
      store.endRun(cliRun, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== coworkRun && id !== cliRun);
      await new Promise(r => setTimeout(r, 50));

      const coworkHits = store.searchRuns('architect workflow', { sources: ['cowork'] });
      expect(coworkHits).toEqual([
        expect.objectContaining({ runId: coworkRun, source: 'cowork' }),
      ]);

      const fleetHits = store.searchRuns('architect workflow', { sources: ['fleet'] });
      expect(fleetHits.map((hit) => hit.runId)).toEqual([coworkRun]);

      const cliHits = store.searchRuns('architect workflow', { sources: ['cli'] });
      expect(cliHits).toEqual([
        expect.objectContaining({ runId: cliRun, source: 'terminal' }),
      ]);
    });

    it('persists artifact recall in the durable FTS index across store instances', async () => {
      const runId = startRun('Browser Operator parity audit', {
        channel: 'cowork',
        tags: ['fleet'],
      });
      store.saveArtifact(
        runId,
        'operator-audit.md',
        '# Audit\nManus browser operator telemetry needs a visible action log.',
      );
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 50));
      store.dispose();

      fs.rmSync(path.join(tmpDir, runId, 'artifacts', 'operator-audit.md'), { force: true });

      const reopened = new RunStore(tmpDir);
      try {
        const hits = reopened.searchRuns('browser telemetry', {
          includeEvents: false,
          limit: 5,
          sources: ['cowork'],
        });
        expect(hits[0]).toMatchObject({
          runId,
          matched: 'artifact',
          artifact: 'operator-audit.md',
          source: 'cowork',
        });
        expect(hits[0]?.snippet).toContain('browser operator telemetry');
      } finally {
        reopened.dispose();
      }
    });

    it('backfills the artifact index for historical run folders', async () => {
      const runId = startRun('Historical operator handoff', {
        channel: 'cowork',
        tags: ['fleet'],
      });
      const artifactPath = path.join(tmpDir, runId, 'artifacts', 'legacy-handoff.md');
      fs.writeFileSync(
        artifactPath,
        '# Legacy handoff\nHistorical browser proof telemetry should remain searchable.',
        'utf-8',
      );
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 50));

      const backfill = store.backfillArtifactIndex({
        limit: 5,
        sources: ['cowork'],
      });
      expect(backfill).toEqual(expect.objectContaining({
        artifactCount: 1,
        failedCount: 0,
        indexedCount: 1,
        runCount: 1,
        sources: ['cowork', 'desktop'],
        unavailable: false,
      }));
      store.dispose();

      fs.rmSync(artifactPath, { force: true });
      const reopened = new RunStore(tmpDir);
      try {
        const hits = reopened.searchRuns('browser proof telemetry', {
          includeEvents: false,
          limit: 5,
          sources: ['cowork'],
        });
        expect(hits[0]).toMatchObject({
          runId,
          matched: 'artifact',
          artifact: 'legacy-handoff.md',
        });
      } finally {
        reopened.dispose();
      }
    });
  });

  describe('artifact index doctor', () => {
    it('reports a clean index as healthy with no stale rows', async () => {
      const runId = startRun('Healthy run', { channel: 'cowork' });
      store.saveArtifact(runId, 'note.md', '# Note\nSearchable content here.');
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 30));

      const health = store.checkArtifactIndexHealth();
      // Skip the assertion gracefully if the native SQLite layer is unavailable.
      if (health.unavailable) return;

      expect(health.totalRows).toBeGreaterThanOrEqual(1);
      expect(health.staleRows).toBe(0);
      expect(health.orphanedRows).toBe(0);
      expect(health.healthyRows).toBe(health.totalRows);
      expect(health.rows).toEqual([]);
    });

    it('flags a stale row when the run folder is removed', async () => {
      const runId = startRun('Soon-to-be-pruned run', { channel: 'cowork' });
      store.saveArtifact(runId, 'gone.md', '# Gone\nThis run folder will disappear.');
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 30));

      const before = store.checkArtifactIndexHealth();
      if (before.unavailable) return;
      expect(before.staleRows).toBe(0);

      // Simulate a pruned/moved run folder while the index keeps the row.
      fs.rmSync(path.join(tmpDir, runId), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

      const after = store.checkArtifactIndexHealth();
      expect(after.staleRows).toBe(1);
      expect(after.rows).toEqual([
        expect.objectContaining({ runId, artifact: 'gone.md', reason: 'missing_run' }),
      ]);
    });

    it('flags an orphaned row when only the artifact file is removed', async () => {
      const runId = startRun('Orphan run', { channel: 'cowork' });
      store.saveArtifact(runId, 'orphan.md', '# Orphan\nFile removed but folder kept.');
      store.endRun(runId, 'completed');
      activeRunIds = activeRunIds.filter(id => id !== runId);
      await new Promise(r => setTimeout(r, 30));

      const health0 = store.checkArtifactIndexHealth();
      if (health0.unavailable) return;

      fs.rmSync(path.join(tmpDir, runId, 'artifacts', 'orphan.md'), { force: true });

      const health = store.checkArtifactIndexHealth();
      expect(health.orphanedRows).toBe(1);
      expect(health.staleRows).toBe(0);
      expect(health.rows).toEqual([
        expect.objectContaining({ runId, artifact: 'orphan.md', reason: 'missing_artifact' }),
      ]);
    });

    it('repairs stale rows and leaves orphans unless includeOrphans is set', async () => {
      const staleRunId = startRun('Stale run', { channel: 'cowork' });
      store.saveArtifact(staleRunId, 'stale.md', '# Stale\nRemove the whole folder.');
      store.endRun(staleRunId, 'completed');

      const orphanRunId = startRun('Orphan run', { channel: 'cowork' });
      store.saveArtifact(orphanRunId, 'orphan.md', '# Orphan\nRemove only the file.');
      store.endRun(orphanRunId, 'completed');

      activeRunIds = activeRunIds.filter(id => id !== staleRunId && id !== orphanRunId);
      await new Promise(r => setTimeout(r, 30));

      const baseline = store.checkArtifactIndexHealth();
      if (baseline.unavailable) return;

      fs.rmSync(path.join(tmpDir, staleRunId), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      fs.rmSync(path.join(tmpDir, orphanRunId, 'artifacts', 'orphan.md'), { force: true });

      // Default repair removes only the stale (missing-run) row.
      const repaired = store.repairArtifactIndex();
      expect(repaired.repaired).toBe(true);
      expect(repaired.includedOrphans).toBe(false);
      expect(repaired.removedRows).toBe(1);

      const afterStaleRepair = store.checkArtifactIndexHealth();
      expect(afterStaleRepair.staleRows).toBe(0);
      expect(afterStaleRepair.orphanedRows).toBe(1);

      // Repair again including orphans removes the remaining row.
      const repairedOrphans = store.repairArtifactIndex({ includeOrphans: true });
      expect(repairedOrphans.removedRows).toBe(1);

      const final = store.checkArtifactIndexHealth();
      expect(final.staleRows).toBe(0);
      expect(final.orphanedRows).toBe(0);
    });
  });

  describe('getRunLineage', () => {
    it('returns not found for an unknown run', () => {
      const lineage = store.getRunLineage('does-not-exist');
      expect(lineage.found).toBe(false);
      expect(lineage.tree).toBeNull();
      expect(lineage.familySize).toBe(0);
    });

    it('reports a single run as a root with no ancestors', () => {
      const runId = startRun('Solo run');
      const lineage = store.getRunLineage(runId);
      expect(lineage.found).toBe(true);
      expect(lineage.ancestors).toEqual([]);
      expect(lineage.tree?.runId).toBe(runId);
      expect(lineage.tree?.children).toEqual([]);
      expect(lineage.familySize).toBe(1);
    });

    it('builds an ancestor chain and descendant subtree across forks', () => {
      const root = startRun('Root objective');
      const child = store.forkRun(root, 'retry');
      activeRunIds.push(child);
      const grandchild = store.forkRun(child, 'ab-variant-B');
      activeRunIds.push(grandchild);
      const sibling = store.forkRun(root, 'checkpoint-rollback');
      activeRunIds.push(sibling);

      // Lineage of the grandchild: root → child as ancestors.
      const fromGrandchild = store.getRunLineage(grandchild);
      expect(fromGrandchild.ancestors.map((a) => a.runId)).toEqual([root, child]);
      expect(fromGrandchild.ancestors[1]?.forkReason).toBe('retry');
      expect(fromGrandchild.tree?.runId).toBe(grandchild);
      expect(fromGrandchild.tree?.forkReason).toBe('ab-variant-B');

      // Lineage from the root: two children, one with a grandchild.
      const fromRoot = store.getRunLineage(root);
      expect(fromRoot.ancestors).toEqual([]);
      expect(fromRoot.tree?.children).toHaveLength(2);
      const childNode = fromRoot.tree?.children.find((c) => c.runId === child);
      expect(childNode?.children.map((c) => c.runId)).toEqual([grandchild]);
      // root + child + grandchild + sibling
      expect(fromRoot.familySize).toBe(4);
    });
  });

  describe('pruning', () => {
    it('should not exceed 30 runs', () => {
      // Create 35 runs
      for (let i = 0; i < 35; i++) {
        startRun(`run ${i}`);
      }
      const runs = store.listRuns(100);
      expect(runs.length).toBeLessThanOrEqual(30);
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const i1 = RunStore.getInstance();
      const i2 = RunStore.getInstance();
      expect(i1).toBe(i2);
    });
  });
});
