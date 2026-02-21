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
    fs.rmSync(dir, { recursive: true, force: true });
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
