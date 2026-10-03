import { afterEach, describe, it, expect, vi } from 'vitest';
import { ToolHandler } from '../../src/agent/tool-handler.js';
import { ColabRunner } from '../../src/compute/colab-runner.js';
import { getPolicyManager } from '../../src/security/tool-policy/index.js';
import { getFormalToolRegistry } from '../../src/tools/registry/index.js';
import { resetPermissionModeManager, getPermissionModeManager } from '../../src/security/permission-modes.js';
import { resetToolFilter } from '../../src/utils/tool-filter.js';

function makeHandler() {
  return new ToolHandler({ checkpointManager: { checkpointBeforeCreate: vi.fn(), checkpointBeforeEdit: vi.fn() } as never,
    hooksManager: { executeHooks: vi.fn().mockResolvedValue([]) } as never,
    marketplace: { executeTool: vi.fn() } as never,
    repairCoordinator: { isRepairEnabled: vi.fn(() => false) } as never });
}
afterEach(() => {
  getFormalToolRegistry().unregister('colab_run');
  getPolicyManager().clearSessionOverride('colab_run');
  resetToolFilter(); resetPermissionModeManager(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
describe('Colab paid tool in the real ToolHandler dispatch', () => {
  it('prompts using production metadata and never allocates after refusal', async () => {
    vi.stubEnv('CODEBUDDY_COLAB', 'true'); resetToolFilter(); resetPermissionModeManager(); getPermissionModeManager().setMode('default');
    const run = vi.spyOn(ColabRunner.prototype, 'run');
    const handler = makeHandler();
    expect(handler.getToolPolicy('colab_run', { script: 'job.py' }).action).toBe('confirm');
    const approve = vi.fn().mockResolvedValue(false); handler.setConfirmationCallback(approve);
    const result = await handler.executeTool({ id: 'colab-test', type: 'function', function: { name: 'colab_run', arguments: JSON.stringify({ script: 'job.py' }) } });
    expect(result.success).toBe(false); expect(approve).toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('dispatches through the registry after confirmation and passes cancellation', async () => {
    vi.stubEnv('CODEBUDDY_COLAB', 'true'); resetToolFilter(); resetPermissionModeManager(); getPermissionModeManager().setMode('default');
    const run = vi.spyOn(ColabRunner.prototype, 'run').mockResolvedValue({ session: 'test', gpu: 'L4', outputDir: 'result', files: [], stdout: '42', reservedUnits: 1 });
    const handler = makeHandler(); const approve = vi.fn().mockResolvedValue(true); handler.setConfirmationCallback(approve);
    const controller = new AbortController();
    const result = await handler.executeTool({ id: 'colab-test', type: 'function', function: { name: 'colab_run', arguments: JSON.stringify({ script: 'job.py' }) } }, { abortSignal: controller.signal });
    expect(result.success).toBe(true); expect(approve).toHaveBeenCalled(); expect(run).toHaveBeenCalledWith(expect.objectContaining({ script: 'job.py' }), controller.signal);
  });
});
