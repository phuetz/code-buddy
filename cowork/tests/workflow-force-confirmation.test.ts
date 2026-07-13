import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';

const state = vi.hoisted(() => ({
  execute: vi.fn(async (name: string) => ({
    success: true,
    output: { ok: true },
    toolName: name,
    duration: 1,
  })),
  confirm: vi.fn(async () => ({ confirmed: true })),
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (modulePath: string) => {
    if (modulePath === 'orchestration/orchestrator.js') return { Orchestrator };
    if (modulePath === 'tools/registry/index.js') {
      return {
        getFormalToolRegistry: () => ({ execute: state.execute }),
        registerBuiltinTools: () => 0,
      };
    }
    if (modulePath === 'utils/confirmation-service.js') {
      return {
        ConfirmationService: {
          getInstance: () => ({ requestConfirmation: state.confirm }),
        },
      };
    }
    return null;
  }),
}));

import { WorkflowBridge } from '../src/main/workflows/workflow-bridge';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('visual workflow external tool confirmation', () => {
  it('uses forcePrompt for the original run and asks again on replay', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-confirm-'));
    directories.push(directory);
    const bridge = new WorkflowBridge(directory);
    const workflow = bridge.create({
      name: 'Publish safely',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', position: { x: 0, y: 0 } },
        {
          id: 'publish',
          type: 'tool',
          name: 'Publish',
          position: { x: 1, y: 0 },
          config: { toolName: 'publish_article', toolInput: { title: 'Reviewed' } },
        },
        { id: 'end', type: 'end', name: 'End', position: { x: 2, y: 0 } },
      ],
      edges: [
        { id: 'a', source: 'start', target: 'publish' },
        { id: 'b', source: 'publish', target: 'end' },
      ],
    });

    const first = await bridge.run(workflow.id);
    expect(first.success).toBe(true);
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ forcePrompt: true }),
      'file'
    );
    expect(state.execute).toHaveBeenCalledTimes(1);

    const replay = await bridge.replay(first.runId!);
    expect(replay.success).toBe(true);
    expect(state.confirm).toHaveBeenCalledTimes(2);
    expect(state.execute).toHaveBeenCalledTimes(2);
  }, 10000);

  it('never reaches the registry after a fresh denial', async () => {
    state.confirm.mockResolvedValueOnce({ confirmed: false, feedback: 'Do not publish' });
    const directory = mkdtempSync(join(tmpdir(), 'workflow-deny-'));
    directories.push(directory);
    const bridge = new WorkflowBridge(directory);
    const workflow = bridge.create({
      name: 'Denied publish',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', position: { x: 0, y: 0 } },
        { id: 'publish', type: 'tool', name: 'Publish', position: { x: 1, y: 0 }, config: { toolName: 'publish_article', toolInput: {} } },
        { id: 'end', type: 'end', name: 'End', position: { x: 2, y: 0 } },
      ],
      edges: [
        { id: 'a', source: 'start', target: 'publish' },
        { id: 'b', source: 'publish', target: 'end' },
      ],
    });
    const result = await bridge.run(workflow.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Do not publish');
    expect(state.execute).not.toHaveBeenCalled();
  }, 10000);
});
