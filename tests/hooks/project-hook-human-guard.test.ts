import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ToolHandler } from '../../src/agent/tool-handler.js';
import { HooksManager } from '../../src/hooks/lifecycle-hooks.js';
import { HookManager } from '../../src/hooks/hook-manager.js';
import { HookSystem } from '../../src/hooks/hook-system.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';

// Real managers, real ConfirmationService and a bounded shell canary; no desktop process.
describe.skipIf(process.platform === 'win32')('Project hook mandatory human guard', () => {
  const service = ConfirmationService.getInstance();
  const human = vi.fn();
  let directory: string;
  let marker: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'project-hook-guard-'));
    marker = path.join(directory, 'executed');
    mkdirSync(path.join(directory, '.codebuddy'));
    writeFileSync(path.join(directory, '.codebuddy', 'settings.json'), JSON.stringify({ permissions: { allow: ['project_hook'] } }));
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    resetPermissionModeManager(); service.resetSession();
    human.mockReset().mockResolvedValue({ confirmed: false }); service.setInteractiveBridge(human);
  });
  afterEach(() => {
    service.setInteractiveBridge(null); resetPermissionModeManager();
    vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  });
  const managers = ['HooksManager', 'HookManager', 'HookSystem'] as const;
  function run(manager: typeof managers[number]) {
    const command = `touch '${marker}'`;
    const hook = { name: 'cloned', type: 'before-tool-call', event: 'PreToolUse', command, enabled: true, timeout: 5000, failOnError: false, continueOnError: true };
    if (manager === 'HookSystem') hook.type = 'pre-bash';
    writeFileSync(path.join(directory, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: [hook] }));
    if (manager === 'HooksManager') return new HooksManager(directory).executeHooks('before-tool-call', { toolName: 'computer_control' });
    if (manager === 'HookManager') return new HookManager().executeHooks('PreToolUse', { toolName: 'computer_control' });
    return new HookSystem(directory).executeHooks('pre-bash', { command: 'xdotool key Return' });
  }
  for (const manager of managers) {
    it.each(['default', 'dontAsk', 'bypassPermissions'] as const)(`${manager} array-format project hooks in %s stop before shell despite allow and failOnError=false`, async mode => {
      const outer = await service.requestConfirmation({ operation: 'hook', filename: directory, toolName: 'project_hook', detail: { cwd: directory } }, 'tool');
      expect(outer.confirmed).toBe(true); expect(human).not.toHaveBeenCalled();
      getPermissionModeManager().setMode(mode); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true'); service.setSessionFlag('allOperations', true);
      const result = await run(manager);
      expect({ ran: existsSync(marker), humanCalls: human.mock.calls.length, result })
        .toEqual({ ran: false, humanCalls: 1, result: expect.anything() });
      const first = Array.isArray(result) ? result[0] : result;
      expect(first).toMatchObject({ success: false, error: expect.stringMatching(/human confirmation/) });
      expect(human).toHaveBeenCalledTimes(1);
      expect(human.mock.calls[0]?.[0]).toMatchObject({ forcePrompt: true, riskLevel: 'critical', toolName: 'project_hook' });
    });
    it(`${manager} runs once only after a fresh human approval`, async () => {
      human.mockResolvedValue({ confirmed: true });
      await run(manager); expect(existsSync(marker)).toBe(true); expect(human).toHaveBeenCalledTimes(1);
      rmSync(marker); human.mockResolvedValue({ confirmed: false });
      await run(manager); expect(existsSync(marker)).toBe(false); expect(human).toHaveBeenCalledTimes(2);
    });
    it(`${manager} fails closed without a bridge`, async () => {
      service.setInteractiveBridge(null); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
      await run(manager); expect(existsSync(marker)).toBe(false);
    });
    it(`${manager} plan mode cannot run even with an accepting human`, async () => {
      getPermissionModeManager().setMode('plan'); human.mockResolvedValue({ confirmed: true });
      await run(manager); expect(existsSync(marker)).toBe(false); expect(human).not.toHaveBeenCalled();
    });
  }
  it('production ToolHandler aborts a tool when an array-format project hook is refused', async () => {
    getPermissionModeManager().setMode('dontAsk'); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
    writeFileSync(path.join(directory, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: [{
      name: 'before-desktop', type: 'before-tool-call', command: `touch '${marker}'`, enabled: true, timeout: 5000, failOnError: false,
    }] }));
    const handler = new ToolHandler({
      checkpointManager: { checkpointBeforeCreate: vi.fn(), checkpointBeforeEdit: vi.fn() } as never,
      hooksManager: new HooksManager(directory), marketplace: { executeTool: vi.fn() } as never,
      repairCoordinator: { isRepairEnabled: () => false } as never,
    });
    const internals = handler as unknown as { executeRegistryTool: () => Promise<{ success: boolean }>; registry: { has: (name: string) => boolean } };
    const actor = vi.spyOn(internals, 'executeRegistryTool').mockResolvedValue({ success: true });
    internals.registry.has = () => true;
    const result = await handler.executeTool({ id: 'hook-guard', type: 'function', function: { name: 'view_file', arguments: JSON.stringify({ path: 'fixture.txt' }) } });
    expect({ ran: existsSync(marker), success: result.success, tools: actor.mock.calls.length }).toEqual({ ran: false, success: false, tools: 0 });
    expect(result.error).toMatch(/aborted/); expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
  });
  it('HooksManager guards custom handlers and aborts despite failOnError=false', async () => {
    const handler = vi.fn().mockResolvedValue({ success: true, duration: 0 });
    const manager = new HooksManager(directory, { hooks: [{ name: 'custom', type: 'before-tool-call', handler, enabled: true, timeout: 1000, failOnError: false }] });
    expect(await manager.executeHooks('before-tool-call', {})).toEqual([expect.objectContaining({ success: false, abort: true })]);
    expect(handler).not.toHaveBeenCalled(); expect(human).toHaveBeenCalledTimes(1);
  });
  it('HooksManager guards script hooks before node starts', async () => {
    writeFileSync(path.join(directory, 'hook.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`);
    const manager = new HooksManager(directory, { hooks: [{ name: 'script', type: 'before-tool-call', script: 'hook.cjs', enabled: true, timeout: 1000, failOnError: false }] });
    const result = await manager.executeHooks('before-tool-call', {});
    expect(existsSync(marker)).toBe(false); expect(result[0]).toMatchObject({ success: false, abort: true }); expect(human).toHaveBeenCalledTimes(1);
  });
});
