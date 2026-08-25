import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolHandler } from '../../src/agent/tool-handler.js';
import { RunStore } from '../../src/observability/run-store.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { getPolicyManager } from '../../src/security/tool-policy/index.js';
import { BashTool } from '../../src/tools/index.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { resetToolFilter } from '../../src/utils/tool-filter.js';
import type { ToolResult } from '../../src/types/index.js';

function bashCall(command: string, id = 'call-stream-bash') {
  return {
    id,
    type: 'function' as const,
    function: {
      name: 'bash',
      arguments: JSON.stringify({ command }),
    },
  };
}

async function drain(
  gen: AsyncGenerator<string, ToolResult, undefined>,
): Promise<{ chunks: string[]; result: ToolResult }> {
  const chunks: string[] = [];
  let next = await gen.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await gen.next();
  }
  return { chunks, result: next.value as ToolResult };
}

describe('ToolHandler streaming bash observability', () => {
  const tempStores: Array<{ dir: string; store: RunStore; runIds: string[] }> = [];
  let executeHooks: ReturnType<typeof vi.fn>;
  let handler: ToolHandler;
  let streamingSpy: ReturnType<typeof vi.spyOn>;

  function installTempRunStore(): { store: RunStore; runIds: string[] } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-handler-stream-bash-'));
    const store = new RunStore(dir);
    const runIds: string[] = [];
    tempStores.push({ dir, store, runIds });
    (RunStore as unknown as { _instance: RunStore | null })._instance = store;
    return { store, runIds };
  }

  beforeEach(() => {
    resetToolFilter();
    resetPermissionModeManager();
    getPermissionModeManager().setMode('default');
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    executeHooks = vi.fn().mockResolvedValue([]);
    handler = new ToolHandler({
      checkpointManager: {
        checkpointBeforeCreate: vi.fn(),
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
    streamingSpy = vi.spyOn(BashTool.prototype, 'executeStreaming').mockImplementation(
      async function* () {
        yield 'hello\n';
        return { success: true, output: 'hello' };
      },
    );
  });

  afterEach(async () => {
    streamingSpy.mockRestore();
    getPolicyManager().clearSessionOverride('bash');
    ConfirmationService.getInstance().dispose();
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    resetPermissionModeManager();
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

  it('fires lifecycle hooks and records the streamed command in RunStore', async () => {
    const { store, runIds } = installTempRunStore();
    const runId = store.startRun('Streaming bash observability');
    runIds.push(runId);
    handler.setRunId(runId);

    const { chunks, result } = await drain(handler.executeToolStreaming(bashCall('echo hello')));

    expect(result).toEqual({ success: true, output: 'hello' });
    expect(chunks).toEqual(['hello\n']);
    expect(streamingSpy).toHaveBeenCalledOnce();

    const hookTypes = executeHooks.mock.calls.map((call) => call[0]);
    expect(hookTypes).toEqual(
      expect.arrayContaining(['before-tool-call', 'pre-bash', 'post-bash', 'after-tool-call']),
    );
    expect(executeHooks).toHaveBeenCalledWith(
      'pre-bash',
      expect.objectContaining({ command: 'echo hello' }),
    );
    expect(executeHooks).toHaveBeenCalledWith(
      'post-bash',
      expect.objectContaining({ command: 'echo hello', output: 'hello' }),
    );

    const events = store.getEvents(runId);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_call',
          data: expect.objectContaining({
            toolName: 'bash',
            toolCallId: 'call-stream-bash',
            args: expect.objectContaining({ command: 'echo hello' }),
          }),
        }),
        expect.objectContaining({
          type: 'tool_result',
          data: expect.objectContaining({
            toolName: 'bash',
            toolCallId: 'call-stream-bash',
            success: true,
          }),
        }),
      ]),
    );
  });

  it('does not add a second confirmation on top of the shell execution policy', async () => {
    getPolicyManager().setSessionOverride('bash', 'confirm');
    const prompts: string[] = [];
    ConfirmationService.getInstance().setInteractiveBridge(async (options) => {
      prompts.push(options.operation);
      return { confirmed: true };
    });

    const { result } = await drain(handler.executeToolStreaming(bashCall('echo hello')));

    expect(result.success).toBe(true);
    expect(streamingSpy).toHaveBeenCalledOnce();
    expect(prompts).toEqual([]);
  });

  it('blocks a non-readonly shell in plan mode before launching the stream', async () => {
    getPermissionModeManager().setMode('plan');

    const { result } = await drain(
      handler.executeToolStreaming(bashCall('rm -rf /tmp/codebuddy-stream-bash-probe')),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
    expect(streamingSpy).not.toHaveBeenCalled();
    expect(executeHooks).not.toHaveBeenCalledWith('pre-bash', expect.anything());
  });
});
