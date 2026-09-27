import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  buildComputerControlProofArtifact,
  buildComputerControlHarnessBundle,
  isComputerControlMutating,
} from '../../src/tools/computer-control-harness.js';
import { RunStore } from '../../src/observability/run-store.js';
import { removeTestDirAsync } from '../helpers/tmp.js';

vi.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
  }),
  getPermissionManager: vi.fn().mockReturnValue({
    check: vi.fn(),
    getInstructions: vi.fn(),
  }),
  getSystemControl: vi.fn().mockReturnValue({
    notify: vi.fn().mockResolvedValue(undefined),
  }),
  getSmartSnapshotManager: vi.fn().mockReturnValue({
    takeSnapshot: vi.fn(),
    getElement: vi.fn(),
    getCurrentSnapshot: vi.fn(),
    toTextRepresentation: vi.fn(),
    findElements: vi.fn(),
    toAnnotatedScreenshot: vi.fn(),
  }),
  getScreenRecorder: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(),
  }),
}));

describe('computer control harness', () => {
  let tempDir: string;
  let store: RunStore | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'computer-control-harness-'));
  });

  afterEach(async () => {
    store?.dispose();
    await store?.whenStreamsClosed();
    store = null;
    await removeTestDirAsync(tempDir);
  });

  it('classifies read and mutating desktop actions', () => {
    expect(isComputerControlMutating({ action: 'snapshot' })).toBe(false);
    expect(isComputerControlMutating({ action: 'list_app_profiles' })).toBe(false);
    expect(isComputerControlMutating({ action: 'read_app_text', appName: 'notepad' })).toBe(false);
    expect(isComputerControlMutating({ action: 'excel_get_cell', cell: 'A1' })).toBe(false);
    expect(isComputerControlMutating({ action: 'get_windows' })).toBe(false);
    expect(isComputerControlMutating({ action: 'click', x: 10, y: 20 })).toBe(true);
    expect(isComputerControlMutating({ action: 'set_slider_value', ref: 1, value: 50 })).toBe(true);
    expect(isComputerControlMutating({ action: 'expand_tree_item', ref: 2 })).toBe(true);
    expect(isComputerControlMutating({ action: 'save_app_document', appName: 'notepad', filePath: 'C:\\temp\\note.txt' })).toBe(true);
    expect(isComputerControlMutating({ action: 'excel_set_cell', cell: 'A1', value: 'hello' })).toBe(true);
    expect(isComputerControlMutating({
      action: 'macro',
      steps: [{ action: 'snapshot' }, { action: 'type', text: 'hello' }],
    })).toBe(true);
  });

  it('builds a read-only harness bundle without sensitive action', () => {
    const bundle = buildComputerControlHarnessBundle({
      audit: {
        id: 'audit-read',
        timestamp: '2026-05-27T00:00:00.000Z',
        action: 'snapshot',
        success: true,
        durationMs: 12,
        safetyProfile: 'balanced',
        dangerous: false,
        simulated: false,
      },
      input: { action: 'snapshot' },
      result: { success: true, output: 'snapshot text' },
    });

    expect(bundle.run.kind).toBe('run');
    expect(bundle.proof.kind).toBe('proof');
    expect(bundle.proof.type).toBe('log');
    expect(bundle.sensitiveAction).toBeUndefined();
    expect(bundle.capabilities.map((cap) => cap.id)).toContain('codebuddy.computer_control.inspect');
  });

  it('builds a sensitive harness bundle for live desktop control', () => {
    const bundle = buildComputerControlHarnessBundle({
      audit: {
        id: 'audit-click',
        timestamp: '2026-05-27T00:00:01.000Z',
        action: 'click',
        success: true,
        durationMs: 20,
        safetyProfile: 'strict',
        dangerous: true,
        simulated: false,
      },
      input: { action: 'click', x: 10, y: 20, confirmDangerous: true },
      result: { success: true, output: 'clicked' },
      artifactRef: 'audit-click.computer-control.json',
    });

    expect(bundle.proof.type).toBe('artifact');
    expect(bundle.sensitiveAction).toMatchObject({
      kind: 'sensitive-action',
      id: 'codebuddy.computer_control.click',
      defaultDryRun: true,
      requires: 'approval-required',
    });
    expect(bundle.approval).toMatchObject({
      kind: 'approval',
      decision: 'approved',
      target: 'codebuddy.computer_control.click',
    });
  });

  it('keeps useful result evidence in proof artifacts while bounding and redacting it', () => {
    const audit = {
      id: 'audit-dialog',
      timestamp: '2026-05-27T00:00:02.000Z',
      action: 'inspect_dialog' as const,
      success: true,
      durationMs: 14,
      safetyProfile: 'strict' as const,
      dangerous: false,
      simulated: false,
    };
    const command = { action: 'inspect_dialog' as const, windowTitle: 'Save changes?' };
    const result = {
      success: true,
      output: 'Dialog inspected',
      data: {
        targetFocus: { matched: true, title: 'Save changes? - Notepad' },
        dialog: {
          text: 'Do you want to save changes?',
          buttons: [
            { text: 'Save', risk: 'caution' },
            { text: 'Delete everything', risk: 'destructive' },
            { text: 'Cancel', risk: 'safe' },
          ],
        },
        selectedButton: { text: 'Cancel', risk: 'safe' },
        apiToken: 'should-not-be-written',
        visualContext: 'x'.repeat(2500),
      },
    };
    const harness = buildComputerControlHarnessBundle({
      audit,
      input: command,
      result,
    });

    const artifact = buildComputerControlProofArtifact({
      audit,
      command,
      result,
      harness,
    }) as {
      result: {
        data: {
          targetFocus: { matched: boolean };
          dialog: { buttons: Array<{ text: string; risk: string }> };
          selectedButton: { text: string };
          apiToken: string;
          visualContext: string;
        };
      };
    };

    expect(artifact.result.data.targetFocus.matched).toBe(true);
    expect(artifact.result.data.dialog.buttons).toContainEqual({ text: 'Cancel', risk: 'safe' });
    expect(artifact.result.data.selectedButton.text).toBe('Cancel');
    expect(artifact.result.data.apiToken).toBe('[redacted]');
    expect(artifact.result.data.visualContext).toHaveLength(2003);
    expect(artifact.result.data.visualContext.endsWith('...')).toBe(true);
  });

  it('adds harness metadata and a proof artifact when a RunStore is active', async () => {
    store = new RunStore(tempDir);
    const runId = store.startRun('Computer use proof run', {
      channel: 'test',
      tags: ['computer-use'],
    });

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'notify',
      title: 'Dry run',
      body: 'No notification should be sent',
      simulateOnly: true,
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      audit: { simulated: boolean };
      harness: { proof: { runId: string; ref: string }; sensitiveAction: { id: string } };
      proofArtifactPath: string;
    };

    expect(data.audit.simulated).toBe(true);
    expect(data.harness.proof.runId).toBe(runId);
    expect(data.harness.sensitiveAction.id).toBe('codebuddy.computer_control.notify');
    expect(await fs.pathExists(data.proofArtifactPath)).toBe(true);

    const artifact = await fs.readJson(data.proofArtifactPath);
    expect(artifact.kind).toBe('computer-control-proof');
    expect(artifact.command.body).toBe('No notification should be sent');
    expect(artifact.harness.proof.ref).toBe(data.harness.proof.ref);

    store.endRun(runId, 'completed');
  });
});
