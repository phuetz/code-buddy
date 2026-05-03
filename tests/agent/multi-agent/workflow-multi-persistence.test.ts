/**
 * Phase O (V0.4.1) — workflow-multi-persistence unit tests.
 *
 * Validates per-id atomic save/load, listAllWorkflows ordering, legacy
 * current.json fallback, and path-traversal guard on workflowId.
 */

// Set unique paths per test file BEFORE imports — vitest pool=forks runs
// files in parallel.
import path from 'path';
import os from 'os';
process.env.CODEBUDDY_WORKFLOWS_DIR = path.join(
  os.tmpdir(),
  `codebuddy-workflows-test-${process.pid}-mp`,
);
process.env.CODEBUDDY_LEGACY_WORKFLOW_PATH = path.join(
  os.tmpdir(),
  `codebuddy-workflows-test-${process.pid}-mp-legacy.json`,
);

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import {
  saveWorkflowById,
  loadWorkflowById,
  listAllWorkflows,
  clearWorkflowById,
  _workflowsDirForTests,
  _legacyPathForTests,
} from '../../../src/agent/multi-agent/workflow-multi-persistence.js';
import type { PersistedWorkflow } from '../../../src/agent/multi-agent/workflow-persistence.js';

const WORKFLOWS_DIR = _workflowsDirForTests();
const LEGACY_PATH = _legacyPathForTests();

function makeState(goal = 'test', overrides: Partial<PersistedWorkflow> = {}): PersistedWorkflow {
  return {
    goal,
    startedAt: new Date().toISOString(),
    strategy: 'hierarchical',
    status: 'running',
    plan: null,
    results: [],
    artifacts: [],
    timeline: [],
    errors: [],
    ...overrides,
  };
}

async function rmRecursive(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe('workflow-multi-persistence — Phase O (V0.4.1)', () => {
  beforeEach(async () => {
    await rmRecursive(WORKFLOWS_DIR);
    try {
      await fs.unlink(LEGACY_PATH);
    } catch {
      /* not present */
    }
  });

  afterEach(async () => {
    await rmRecursive(WORKFLOWS_DIR);
    try {
      await fs.unlink(LEGACY_PATH);
    } catch {
      /* not present */
    }
  });

  describe('save/load by id', () => {
    it('round-trips a single workflow under workflows/{id}.json', async () => {
      await saveWorkflowById('wf-test-1', makeState('goal-A'));
      const loaded = await loadWorkflowById('wf-test-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.goal).toBe('goal-A');
      expect(loaded!.schemaVersion).toBe('v0.3');
    });

    it('writes per-id files atomically (no stale .tmp on success)', async () => {
      await saveWorkflowById('wf-atomic', makeState('a'));
      const tmp = path.join(WORKFLOWS_DIR, 'wf-atomic.json.tmp');
      await expect(fs.access(tmp)).rejects.toThrow();
    });

    it('rejects path-traversal workflowIds (best-effort, throws caught + logged)', async () => {
      // saveWorkflowById is best-effort: invalid id throws inside, the
      // outer try/catch logs + returns undefined. Verify the function
      // signature doesn't reject and that no file was created with the
      // escape id form (regex guard prevents the path join).
      await expect(
        saveWorkflowById('../escape', makeState('evil')),
      ).resolves.toBeUndefined();
      // No file with literal "../escape.json" name in our dir.
      const literalPath = path.join(WORKFLOWS_DIR, '../escape.json');
      try {
        await fs.unlink(literalPath); // pre-clean if some other test leaked
      } catch { /* not present is fine */ }
      // Re-attempt write — should still not create the file.
      await saveWorkflowById('../escape', makeState('evil-2'));
      await expect(fs.access(literalPath)).rejects.toThrow();
    });

    it('loadWorkflowById returns null for unknown id', async () => {
      const r = await loadWorkflowById('does-not-exist');
      expect(r).toBeNull();
    });

    it('returns null for path-traversal id (rejected by guard)', async () => {
      const r = await loadWorkflowById('../etc/passwd');
      expect(r).toBeNull();
    });
  });

  describe('listAllWorkflows', () => {
    it('returns empty when no files', async () => {
      const all = await listAllWorkflows();
      expect(all).toEqual([]);
    });

    it('lists all per-id files', async () => {
      await saveWorkflowById('wf-1', makeState('a'));
      await saveWorkflowById('wf-2', makeState('b'));
      await saveWorkflowById('wf-3', makeState('c'));
      const all = await listAllWorkflows();
      expect(all).toHaveLength(3);
      const ids = all.map(([id]) => id).sort();
      expect(ids).toEqual(['wf-1', 'wf-2', 'wf-3']);
    });

    it('falls back to legacy current.json when per-id dir is empty', async () => {
      await fs.mkdir(path.dirname(LEGACY_PATH), { recursive: true });
      await fs.writeFile(LEGACY_PATH, JSON.stringify(makeState('legacy-goal')), 'utf8');

      const all = await listAllWorkflows();
      expect(all).toHaveLength(1);
      expect(all[0][0]).toBeNull(); // legacy = null id
      expect(all[0][1].goal).toBe('legacy-goal');
    });

    it('does NOT fall back to legacy when any per-id files exist', async () => {
      await saveWorkflowById('wf-priority', makeState('per-id-goal'));
      await fs.mkdir(path.dirname(LEGACY_PATH), { recursive: true });
      await fs.writeFile(LEGACY_PATH, JSON.stringify(makeState('legacy-goal')), 'utf8');

      const all = await listAllWorkflows();
      expect(all).toHaveLength(1);
      expect(all[0][0]).toBe('wf-priority');
      expect(all[0][1].goal).toBe('per-id-goal');
    });

    it('skips invalid filenames in the workflows dir', async () => {
      await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
      await fs.writeFile(path.join(WORKFLOWS_DIR, 'not-json.txt'), 'x', 'utf8');
      await fs.writeFile(path.join(WORKFLOWS_DIR, '../escape.json'), '{}', 'utf8'); // outside via name
      await saveWorkflowById('wf-good', makeState('good'));

      const all = await listAllWorkflows();
      expect(all).toHaveLength(1);
      expect(all[0][0]).toBe('wf-good');
    });

    it('skips per-id files with invalid JSON (corrupt)', async () => {
      await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
      await fs.writeFile(path.join(WORKFLOWS_DIR, 'wf-corrupt.json'), '{ broken', 'utf8');
      await saveWorkflowById('wf-good', makeState('good'));

      const all = await listAllWorkflows();
      expect(all).toHaveLength(1);
      expect(all[0][0]).toBe('wf-good');
    });
  });

  describe('clearWorkflowById', () => {
    it('removes a single workflow file', async () => {
      await saveWorkflowById('wf-clear', makeState('a'));
      await clearWorkflowById('wf-clear');
      const r = await loadWorkflowById('wf-clear');
      expect(r).toBeNull();
    });

    it('is a no-op for unknown id', async () => {
      await expect(clearWorkflowById('does-not-exist')).resolves.toBeUndefined();
    });

    it('does not affect other workflows', async () => {
      await saveWorkflowById('wf-keep', makeState('keep'));
      await saveWorkflowById('wf-drop', makeState('drop'));
      await clearWorkflowById('wf-drop');
      const remaining = await listAllWorkflows();
      expect(remaining).toHaveLength(1);
      expect(remaining[0][0]).toBe('wf-keep');
    });
  });
});
