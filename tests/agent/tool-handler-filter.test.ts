import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolHandler } from '../../src/agent/tool-handler.js';
import { evaluatePolicyEval } from '../../src/observability/policy-evals.js';
import {
  buildRunTrajectoryExport,
  renderRunTrajectoryExport,
} from '../../src/observability/run-trajectory-export.js';
import { RunStore } from '../../src/observability/run-store.js';
import { resetToolFilter, setToolFilter } from '../../src/utils/tool-filter.js';

function makeHandler(): {
  handler: ToolHandler;
  checkpointBeforeCreate: ReturnType<typeof vi.fn>;
  executeHooks: ReturnType<typeof vi.fn>;
} {
  const checkpointBeforeCreate = vi.fn();
  const executeHooks = vi.fn().mockResolvedValue(undefined);
  const handler = new ToolHandler({
    checkpointManager: {
      checkpointBeforeCreate,
      checkpointBeforeEdit: vi.fn(),
    } as never,
    hooksManager: {
      executeHooks,
    } as never,
    marketplace: {
      executeTool: vi.fn(),
    } as never,
    repairCoordinator: {
      isRepairEnabled: vi.fn(() => false),
    } as never,
  });

  return { handler, checkpointBeforeCreate, executeHooks };
}

describe('ToolHandler active tool filter enforcement', () => {
  const tempStores: Array<{ dir: string; store: RunStore; runIds: string[] }> = [];

  afterEach(async () => {
    resetToolFilter();
    for (const item of tempStores.splice(0)) {
      for (const runId of item.runIds) {
        try {
          item.store.endRun(runId, 'cancelled');
        } catch {
          // Ignore already-ended runs.
        }
      }
      item.store.dispose();
      await new Promise((resolve) => setTimeout(resolve, 60));
      fs.rmSync(item.dir, { recursive: true, force: true });
    }
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
  });

  function installTempRunStore(): { store: RunStore; runIds: string[] } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-handler-filter-'));
    const store = new RunStore(dir);
    const runIds: string[] = [];
    tempStores.push({ dir, store, runIds });
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;
    return { store, runIds };
  }

  it('blocks hidden mutation tools before registry execution side effects', async () => {
    setToolFilter({
      enabledPatterns: ['view_file'],
      disabledPatterns: [],
    });
    const { handler, checkpointBeforeCreate, executeHooks } = makeHandler();

    const result = await handler.executeTool({
      id: 'call-filtered-create',
      type: 'function',
      function: {
        name: 'create_file',
        arguments: JSON.stringify({
          path: 'should-not-be-created.txt',
          content: 'blocked',
        }),
      },
    });

    expect(result).toEqual({
      success: false,
      error: 'Tool "create_file" is disabled by the active tool filter and was not executed.',
    });
    expect(checkpointBeforeCreate).not.toHaveBeenCalled();
    expect(executeHooks).not.toHaveBeenCalled();
  });

  it('blocks hidden streaming bash execution before command launch', async () => {
    setToolFilter({
      enabledPatterns: ['view_file'],
      disabledPatterns: [],
    });
    const { handler } = makeHandler();

    const stream = handler.executeToolStreaming({
      id: 'call-filtered-bash',
      type: 'function',
      function: {
        name: 'bash',
        arguments: JSON.stringify({ command: 'echo should-not-run' }),
      },
    });

    const result = await stream.next();

    expect(result.done).toBe(true);
    expect(result.value).toEqual({
      success: false,
      error: 'Tool "bash" is disabled by the active tool filter and was not executed.',
    });
  });

  it('records active filter blocks in run telemetry without marking the tool as used', async () => {
    setToolFilter({
      enabledPatterns: ['view_file'],
      disabledPatterns: [],
    });
    const { store, runIds } = installTempRunStore();
    const runId = store.startRun('Profile safe tool filter block', {
      channel: 'test',
      tags: ['profile:safe'],
    });
    runIds.push(runId);
    const { handler } = makeHandler();
    handler.setRunId(runId);

    const result = await handler.executeTool({
      id: 'call-filtered-telemetry',
      type: 'function',
      function: {
        name: 'create_file',
        arguments: JSON.stringify({
          path: 'blocked-by-filter.txt',
          content: 'blocked',
        }),
      },
    });

    expect(result.success).toBe(false);
    store.endRun(runId, 'completed');
    runIds.splice(runIds.indexOf(runId), 1);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const events = store.getEvents(runId);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'decision',
          data: expect.objectContaining({
            kind: 'tool_filter_block',
            source: 'active_tool_filter',
            toolName: 'create_file',
            toolCallId: 'call-filtered-telemetry',
          }),
        }),
        expect.objectContaining({
          type: 'tool_result',
          data: expect.objectContaining({
            blockedBy: 'active_tool_filter',
            success: false,
            toolName: 'create_file',
          }),
        }),
      ]),
    );
    expect(events.some((event) => event.type === 'tool_call')).toBe(false);

    const trajectory = buildRunTrajectoryExport(runId, { store });
    expect(trajectory?.toolCalls).toEqual([]);
    expect(trajectory?.toolResults).toEqual([
      expect.objectContaining({
        error: expect.stringContaining('disabled by the active tool filter'),
        success: false,
        toolName: 'create_file',
      }),
    ]);
    const policyEval = evaluatePolicyEval('safe-profile-no-mutation', trajectory!);
    expect(policyEval?.passed).toBe(true);
    expect(renderRunTrajectoryExport(trajectory!)).toContain(
      'tool_filter_block create_file source=active_tool_filter',
    );
  });
});
