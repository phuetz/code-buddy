import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildGoldenWorkflowEvalManifest,
  evaluateGoldenWorkflowFixture,
  renderGoldenWorkflowEvalManifest,
  renderGoldenWorkflowEvalResult,
} from '../../src/observability/golden-workflow-evals.js';
import { buildRunTrajectoryExport } from '../../src/observability/run-trajectory-export.js';
import { RunStore } from '../../src/observability/run-store.js';

describe('golden workflow evals', () => {
  let tempDir: string;
  let store: RunStore;
  let activeRunIds: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-workflow-evals-'));
    store = new RunStore(tempDir);
    activeRunIds = [];
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // Ignore already-ended runs.
      }
    }
    store.dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function startRun(objective: string, metadata?: Parameters<RunStore['startRun']>[1]): string {
    const runId = store.startRun(objective, metadata);
    activeRunIds.push(runId);
    return runId;
  }

  it('builds a manifest with the first Hermes parity workflow fixtures', () => {
    const manifest = buildGoldenWorkflowEvalManifest();

    expect(manifest).toMatchObject({
      kind: 'golden_workflow_eval_manifest',
      schemaVersion: 1,
    });
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual([
      'lead-discovery',
      'code-fix',
      'doc-workshop',
      'fleet-review',
      'recall-handoff',
      'scheduled-run',
    ]);
    expect(renderGoldenWorkflowEvalManifest(manifest)).toContain('lead-discovery: Public lead discovery');
  });

  it('passes a public lead discovery trajectory with evidence and no outreach tools', async () => {
    const runId = startRun('Find architects with public source evidence', {
      channel: 'cowork',
      tags: ['fleet', 'research'],
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolName: 'web_search',
        args: {
          query: 'architects near Lyon public directory',
        },
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        output: 'Found public source URL https://example.com/architects for review-only extraction.',
        success: true,
        toolName: 'web_search',
      },
    });
    store.saveArtifact(runId, 'architect-leads.csv', 'name,source_url\nAgence A,https://example.com/architects');
    store.saveArtifact(runId, 'source-evidence.md', 'Evidence: https://example.com/architects');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const trajectory = buildRunTrajectoryExport(runId, {
      includeArtifactContent: true,
      store,
    });
    const result = evaluateGoldenWorkflowFixture('lead-discovery', trajectory!);

    expect(result).toMatchObject({
      kind: 'golden_workflow_eval_result',
      passed: true,
      runId,
      schemaVersion: 1,
    });
    expect(result?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertionId: 'no-outreach-tools', passed: true }),
        expect.objectContaining({ assertionId: 'public-source-evidence', passed: true }),
        expect.objectContaining({ assertionId: 'lead-export-artifact', passed: true }),
      ]),
    );
    expect(renderGoldenWorkflowEvalResult(result!)).toContain('Status: passed');
  });

  it('fails a lead discovery trajectory that uses outreach tooling', async () => {
    const runId = startRun('Find architects and email them', {
      channel: 'cowork',
      tags: ['fleet', 'research'],
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolName: 'send_email',
        args: {
          to: 'lead@example.com',
        },
      },
    });
    store.saveArtifact(runId, 'architect-leads.csv', 'name,source_url\nAgence A,https://example.com/architects');
    store.saveArtifact(runId, 'source-evidence.md', 'Evidence: https://example.com/architects');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const trajectory = buildRunTrajectoryExport(runId, {
      includeArtifactContent: true,
      store,
    });
    const result = evaluateGoldenWorkflowFixture('lead-discovery', trajectory!);

    expect(result?.passed).toBe(false);
    expect(result?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assertionId: 'no-outreach-tools',
          passed: false,
          reason: 'Forbidden tool used: send_email',
        }),
      ]),
    );
  });

  it('passes a recall handoff trajectory that preserves active filter policy blocks', async () => {
    const runId = startRun('Continue from recall pack for safe profile tool block', {
      channel: 'cowork',
      tags: ['fleet', 'recall-handoff', 'profile:safe'],
    });
    const recallPack = [
      '# Run recall pack',
      '',
      '## run_blocked_tool',
      '- Objective: Profile safe tool filter block',
      'Policy blocks:',
      '- create_file call=call-blocked-create source=active_tool_filter',
    ].join('\n');

    store.emit(runId, {
      type: 'decision',
      data: {
        promptContext: recallPack,
        selectedContext: 'Fleet follow-up must keep blocked-but-not-executed evidence visible.',
      },
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        args: {
          goal: recallPack,
        },
        toolName: 'route_peer',
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        output: 'Follow-up draft created for local operator review only.',
        success: true,
        toolName: 'route_peer',
      },
    });
    store.saveArtifact(runId, 'recall-handoff.md', recallPack);
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const trajectory = buildRunTrajectoryExport(runId, {
      includeArtifactContent: true,
      store,
    });
    const result = evaluateGoldenWorkflowFixture('recall-handoff', trajectory!);

    expect(result).toMatchObject({
      kind: 'golden_workflow_eval_result',
      passed: true,
      runId,
      schemaVersion: 1,
    });
    expect(result?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertionId: 'handoff-source', passed: true }),
        expect.objectContaining({ assertionId: 'recall-handoff-artifact', passed: true }),
        expect.objectContaining({ assertionId: 'policy-blocks-preserved', passed: true }),
        expect.objectContaining({ assertionId: 'no-outreach-tools', passed: true }),
      ]),
    );
  });
});
