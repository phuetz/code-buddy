import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolHandler } from '../../src/agent/tool-handler.js';
import { getPolicyManager } from '../../src/security/tool-policy/index.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { getFormalToolRegistry } from '../../src/tools/registry/index.js';
import type { ITool } from '../../src/tools/registry/types.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { resetToolFilter } from '../../src/utils/tool-filter.js';

const TOOL_NAME = 'tool_handler_confirmation_probe';

function call(args: Record<string, unknown>) {
  return {
    id: `call-${String(args.target ?? 'probe')}`,
    type: 'function' as const,
    function: {
      name: TOOL_NAME,
      arguments: JSON.stringify(args),
    },
  };
}

function makeHandler(
  lifecycleHook = vi.fn().mockResolvedValue([]),
): ToolHandler {
  return new ToolHandler({
    checkpointManager: {
      checkpointBeforeCreate: vi.fn(),
      checkpointBeforeEdit: vi.fn(),
    } as never,
    hooksManager: {
      executeHooks: lifecycleHook,
    } as never,
    marketplace: {
      executeTool: vi.fn(),
    } as never,
    repairCoordinator: {
      isRepairEnabled: vi.fn(() => false),
    } as never,
  });
}

describe('ToolHandler central confirmation gate', () => {
  let executed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetToolFilter();
    resetPermissionModeManager();
    getPermissionModeManager().setMode('default');
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    getPolicyManager().setSessionOverride(TOOL_NAME, 'confirm');
    executed = vi.fn().mockResolvedValue({ success: true, output: 'executed' });
    const probe: ITool = {
      name: TOOL_NAME,
      description: 'confirmation policy probe',
      getSchema: () => ({
        name: TOOL_NAME,
        description: 'confirmation policy probe',
        parameters: { type: 'object', properties: {} },
      }),
      execute: executed,
      getMetadata: () => ({
        name: TOOL_NAME,
        description: 'confirmation policy probe',
        category: 'utility',
        keywords: ['probe'],
        priority: 1,
        requiresConfirmation: true,
      }),
    };
    getFormalToolRegistry().register(probe, { override: true });
  });

  afterEach(() => {
    getFormalToolRegistry().unregister(TOOL_NAME);
    getPolicyManager().clearSessionOverride(TOOL_NAME);
    ConfirmationService.getInstance().dispose();
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    resetPermissionModeManager();
    resetToolFilter();
  });

  it('fails closed when a confirm decision is denied and no callback was installed', async () => {
    ConfirmationService.getInstance().setInteractiveBridge(async () => ({ confirmed: false }));
    const result = await makeHandler().executeTool(call({ target: 'publish' }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
    expect(executed).not.toHaveBeenCalled();
  });

  it('reuses only the exact approved args and prompts again when they change', async () => {
    let prompts = 0;
    ConfirmationService.getInstance().setInteractiveBridge(async () => {
      prompts += 1;
      return { confirmed: true, dontAskAgain: true };
    });
    const handler = makeHandler();

    expect((await handler.executeTool(call({ target: 'publish' }))).success).toBe(true);
    expect((await handler.executeTool(call({ target: 'publish' }))).success).toBe(true);
    expect((await handler.executeTool(call({ target: 'delete' }))).success).toBe(true);

    expect(prompts).toBe(2);
    expect(executed).toHaveBeenCalledTimes(3);
  });

  it('does not prompt again for local-first shared video analysis', () => {
    const handler = makeHandler();

    expect(handler.getToolPolicy('understand_video', {
      source: 'https://youtu.be/pmQKXepA0-c',
      visual: true,
    })).toMatchObject({
      action: 'allow',
      source: 'default',
    });
  });

  it('does not prompt again when the user asks Lisa for a selfie', () => {
    const handler = makeHandler();

    expect(handler.getToolPolicy('lisa_selfie', {
      mood: 'portrait',
      send_telegram: true,
    })).toMatchObject({
      action: 'allow',
      source: 'default',
    });
  });

  it('preserves an explicit confirmation override for Lisa selfies', () => {
    getPolicyManager().setSessionOverride('lisa_selfie', 'confirm');
    try {
      const handler = makeHandler();
      expect(handler.getToolPolicy('lisa_selfie', {
        mood: 'portrait',
      }).action).toBe('confirm');
    } finally {
      getPolicyManager().clearSessionOverride('lisa_selfie');
    }
  });

  it('keeps cloud video disclosure behind confirmation', () => {
    const handler = makeHandler();

    expect(handler.getToolPolicy('understand_video', {
      source: 'https://youtu.be/pmQKXepA0-c',
      cloud: true,
    }).action).toBe('confirm');
  });

  it('preserves an explicit confirmation override for local video analysis', () => {
    getPolicyManager().setSessionOverride('understand_video', 'confirm');
    try {
      const handler = makeHandler();
      expect(handler.getToolPolicy('understand_video', {
        source: 'https://youtu.be/pmQKXepA0-c',
      }).action).toBe('confirm');
    } finally {
      getPolicyManager().clearSessionOverride('understand_video');
    }
  });

  it('reauthorizes arguments changed by a before-tool hook before dispatch', async () => {
    let prompts = 0;
    ConfirmationService.getInstance().setInteractiveBridge(async () => {
      prompts += 1;
      return prompts === 1
        ? { confirmed: true, dontAskAgain: true }
        : { confirmed: false };
    });
    const lifecycleHook = vi.fn(async (event: string) => event === 'before-tool-call'
      ? [{ modified: { toolArgs: { target: 'delete' } } }]
      : []);

    const result = await makeHandler(lifecycleHook).executeTool(call({ target: 'preview' }));

    expect(result.success).toBe(false);
    expect(prompts).toBe(2);
    expect(executed).not.toHaveBeenCalled();
  });

  it('executes strict self-inspection without lifecycle or plugin hook dispatch', async () => {
    const lifecycleHook = vi.fn().mockResolvedValue([{ abort: true }]);
    const handler = makeHandler(lifecycleHook);

    const result = await handler.executeStrictSelfInspectionTool({
      id: 'call-strict-self',
      type: 'function',
      function: {
        name: 'self_describe',
        arguments: JSON.stringify({ focus: 'architecture', depth: 'summary' }),
      },
    }, {
      exposedToolNames: ['self_describe'],
      provider: 'test-provider',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Conscience subjective : non établie');
    expect(lifecycleHook).not.toHaveBeenCalled();
  });
});
