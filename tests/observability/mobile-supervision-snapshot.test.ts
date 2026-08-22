import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildMobileSupervisionSnapshot,
  evaluateMobileSupervisionAction,
  renderMobileSupervisionSnapshot,
} from '../../src/observability/mobile-supervision-snapshot.js';
import { RunStore } from '../../src/observability/run-store.js';

let tempDir: string;
let store: RunStore;

describe('mobile supervision snapshot', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-supervision-'));
    store = new RunStore(tempDir);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    store.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('builds a review-only redacted snapshot from matching run evidence', async () => {
    const leakedSecret = 'api_key="abcdefghijklmnopqrstuvwx"';
    const runId = store.startRun('Architect mobile supervision handoff', {
      channel: 'cowork',
      tags: ['fleet', 'mobile'],
    });
    store.saveArtifact(
      runId,
      'summary.md',
      `Architect handoff found public leads but accidentally included ${leakedSecret}.`,
    );
    store.endRun(runId, 'completed');
    await new Promise((resolve) => setTimeout(resolve, 60));

    const snapshot = await buildMobileSupervisionSnapshot('architect handoff', {
      limit: 5,
      sources: ['cowork'],
      store,
    });

    expect(snapshot).toMatchObject({
      mode: 'review_only',
      safety: {
        autoDispatch: false,
        localApprovalRequired: true,
        outreachDisabled: true,
        remoteExecutionDisabled: true,
        redaction: 'secrets-redacted',
      },
      recallPack: {
        runCount: 1,
      },
      schemaVersion: 1,
    });
    expect(snapshot.allowedActions).toContain('draft_followup_prompt');
    expect(snapshot.blockedActions).toContain('execute_tool');
    expect(snapshot.runs[0]).toEqual(expect.objectContaining({
      artifactPaths: ['summary.md'],
      runId,
      source: 'cowork',
      status: 'completed',
    }));
    expect(snapshot.redactionCount).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain(leakedSecret);
  });

  it('renders a compact human-readable handoff', async () => {
    const snapshot = await buildMobileSupervisionSnapshot('nothing yet', {
      store,
    });

    const rendered = renderMobileSupervisionSnapshot(snapshot);

    expect(rendered).toContain('Mobile supervision snapshot (review_only)');
    expect(rendered).toContain('remote execution disabled');
    expect(rendered).toContain('Blocked:');
  });

  it('evaluates mobile actions with deny-by-default semantics', async () => {
    const snapshot = await buildMobileSupervisionSnapshot('action policy', {
      store,
    });

    expect(evaluateMobileSupervisionAction(snapshot, 'open_artifact')).toMatchObject({
      action: 'open_artifact',
      allowed: true,
      requiresLocalOperator: false,
    });
    expect(evaluateMobileSupervisionAction(snapshot, 'execute_tool')).toMatchObject({
      action: 'execute_tool',
      allowed: false,
      requiresLocalOperator: true,
    });
    expect(evaluateMobileSupervisionAction(snapshot, 'approve_everything')).toMatchObject({
      action: 'approve_everything',
      allowed: false,
      requiresLocalOperator: true,
    });
  });
});
