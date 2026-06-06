import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PROOF_LEDGER_ARTIFACT,
  buildProofLedgerForRun,
  renderProofLedger,
  type ProofLedgerEntry,
} from '../../src/observability/proof-ledger.js';
import { RunStore } from '../../src/observability/run-store.js';
import { resetDataRedactionEngine } from '../../src/security/data-redaction.js';

describe('Proof Ledger', () => {
  let tempDir: string;
  let store: RunStore;
  let activeRunIds: string[];

  beforeEach(() => {
    resetDataRedactionEngine();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-ledger-'));
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
    await new Promise((resolve) => setTimeout(resolve, 80));
    store.dispose();
    resetDataRedactionEngine();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function startRun(objective: string, metadata?: Parameters<RunStore['startRun']>[1]): string {
    const runId = store.startRun(objective, metadata);
    activeRunIds.push(runId);
    return runId;
  }

  it('writes a redacted proof card automatically when a run ends', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwx';
    const runId = startRun(`Ship Proof Ledger with ${secret}`, {
      channel: 'cowork',
      tags: ['fleet'],
    });
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolCallId: 'call_test',
        toolName: 'bash',
        args: {
          command: `npm test -- tests/observability/proof-ledger.test.ts --api-key ${secret}`,
        },
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        durationMs: 123,
        success: true,
        toolCallId: 'call_test',
        toolName: 'bash',
      },
    });
    store.emit(runId, {
      type: 'patch_applied',
      data: {
        filesApplied: ['src/observability/proof-ledger.ts'],
      },
    });
    store.saveArtifact(runId, 'screenshots/proof.png', 'PNG placeholder');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const raw = store.getArtifact(runId, PROOF_LEDGER_ARTIFACT);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(secret);

    const entry = JSON.parse(raw as string) as ProofLedgerEntry;
    expect(entry).toMatchObject({
      kind: 'proof_ledger_entry',
      status: 'proven',
      run: {
        runId,
        source: 'fleet',
      },
      tests: {
        failed: 0,
        passed: 1,
        total: 1,
      },
    });
    expect(entry.commands[0]).toEqual(expect.objectContaining({
      isTest: true,
      success: true,
      toolName: 'bash',
    }));
    expect(entry.commands[0]?.command).toContain('[REDACTED');
    expect(entry.artifacts).toEqual([
      expect.objectContaining({
        kind: 'capture',
        name: 'screenshots/proof.png',
      }),
    ]);
    expect(entry.filesChanged).toContain('src/observability/proof-ledger.ts');
    expect(entry.privacy.redactionCount).toBeGreaterThan(0);

    const record = store.getRun(runId);
    expect(record?.summary.artifactCount).toBe(1);
    expect(record?.artifacts).toEqual(['screenshots/proof.png']);
    expect(renderProofLedger(entry)).toContain('Proof ledger');
  });

  it('marks completed runs without verification commands as incomplete', () => {
    const runId = startRun('Implement without a proof command');
    store.saveArtifact(runId, 'summary.md', 'Implementation notes.');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);

    const entry = buildProofLedgerForRun(store, runId);

    expect(entry).toMatchObject({
      status: 'incomplete',
      tests: {
        total: 0,
      },
    });
    expect(entry?.risks).toEqual([
      expect.objectContaining({
        level: 'medium',
        source: 'tool_call',
      }),
    ]);
  });

  it('marks failed verification commands as failed proof', () => {
    const runId = startRun('Run a failing validation');
    store.emit(runId, {
      type: 'tool_call',
      data: {
        toolCallId: 'call_validate',
        toolName: 'bash',
        args: { command: 'npm run validate' },
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        success: false,
        toolCallId: 'call_validate',
        toolName: 'bash',
      },
    });
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);

    const entry = buildProofLedgerForRun(store, runId);

    expect(entry).toMatchObject({
      status: 'failed',
      tests: {
        failed: 1,
        total: 1,
      },
    });
    expect(entry?.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'high',
        source: 'tool_result',
      }),
    ]));
  });

  it('rejects artifact paths that escape the run directory', () => {
    const runId = startRun('Path guard proof');

    expect(() => store.saveArtifact(runId, '../outside.txt', 'nope')).toThrow(
      /escapes run artifacts directory/,
    );
  });
});
