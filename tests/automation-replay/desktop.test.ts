import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSemanticAct } from '../../src/automation-replay/engine.js';
import { ReplayStore } from '../../src/automation-replay/store.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { desktopReplayHost } from '../../src/automation-replay/desktop-host.js';
import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import type { SmartSnapshotManager } from '../../src/desktop-automation/smart-snapshot.js';

vi.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: () => ({ initialize: vi.fn(), getActiveWindow: async () => ({ processName: 'demo', title: 'Demo' }) }),
  getPermissionManager: () => ({}), getSystemControl: () => ({}),
  getSmartSnapshotManager: () => ({}), getScreenRecorder: () => ({}),
}));
const target = { role: 'button', name: 'Continue' };
function snapshots(source = 'at-spi') {
  const element = { ...target, ref: 19, visible: true, interactive: true, enabled: true, focused: true,
    attributes: { source, protected: false, windowTitle: 'Demo' } };
  return { takeSnapshot: async () => ({ elements: [element] }), getElement: () => element } as unknown as SmartSnapshotManager;
}
const window = async () => ({ processName: 'demo', title: 'Demo' });
afterEach(() => { ConfirmationService.getInstance().setInteractiveBridge(null); vi.restoreAllMocks(); });

describe('desktop semantic replay boundary', () => {
  it.each(['ocr', 'ocr-fallback', 'mock', 'browser-accessibility', ''])('refuses %s provenance', async source => {
    const effect = vi.fn();
    const host = desktopReplayHost(snapshots(source), window, effect);
    await expect(host.perform({ kind: 'click', target }, {})).rejects.toThrow('real AT-SPI/UIA');
    expect(effect).not.toHaveBeenCalled();
  });
  it.each(['at-spi', 'uia'])('requires the actual forcePrompt guard again for %s replay', async source => {
    const tool = new ComputerControlTool();
    const service = ConfirmationService.getInstance();
    service.setSessionFlag('allOperations', true);
    const bridge = vi.fn(async () => ({ confirmed: false })); service.setInteractiveBridge(bridge);
    const request = vi.spyOn(service, 'requestConfirmation');
    const host = desktopReplayHost(snapshots(source), window, input => tool.execute(input));
    await expect(host.perform({ kind: 'click', target }, {})).rejects.toThrow('human confirmation');
    await expect(host.perform({ kind: 'click', target }, {})).rejects.toThrow('human confirmation');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([options]) => options.forcePrompt === true)).toBe(true);
    expect(bridge).toHaveBeenCalledTimes(2);
  });
  it('a locally recorded desktop sequence still reaches the real forcePrompt guard on a cache hit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-replay-'));
    const home = path.join(root, 'home'); await mkdir(home);
    try {
      let finished = false;
      const native = snapshots(); const take = native.takeSnapshot;
      native.takeSnapshot = async () => {
        const s = await take();
        if (finished) s.elements.push({ ...s.elements[0]!, ref: 20, name: 'Finished', interactive: false });
        return s;
      };
      const store = new ReplayStore(root, home);
      const model = vi.fn(async () => ({ content: JSON.stringify({ kind: 'click', target }) }));
      const request = { instruction: 'Continue', expectedText: 'Finished' };
      await runSemanticAct(desktopReplayHost(native, window, async () => { finished = true; return { success: true }; }), request, { store, model });
      finished = false; model.mockClear();
      const service = ConfirmationService.getInstance();
      service.setSessionFlag('allOperations', true);
      service.setInteractiveBridge(async () => ({ confirmed: false }));
      const confirmation = vi.spyOn(service, 'requestConfirmation');
      const tool = new ComputerControlTool();
      await expect(runSemanticAct(desktopReplayHost(native, window, input => tool.execute(input)), request, { store, model })).rejects.toThrow('human confirmation');
      expect(model).not.toHaveBeenCalled();
      expect(confirmation).toHaveBeenCalledWith(expect.objectContaining({ forcePrompt: true, toolName: 'computer_control' }), 'tool');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(['type', 'press'] as const)('routes %s through a guarded click and guarded keyboard action', async kind => {
    const execute = vi.fn(async () => ({ success: true }));
    const host = desktopReplayHost(snapshots(), window, execute);
    await host.perform({ kind, target, valueKey: 'query', key: 'Enter' }, { query: 'hello' });
    expect(execute.mock.calls).toEqual([[{ action: 'click', ref: 19 }], [kind === 'type' ? { action: 'type', text: 'hello' } : { action: 'key', key: 'Enter' }]]);
  });
  it('refuses a password or an unknown native protection flag', async () => {
    const snapshot = snapshots();
    const take = snapshot.takeSnapshot;
    snapshot.takeSnapshot = async () => { const s = await take(); s.elements[0]!.attributes = { source: 'uia', windowTitle: 'Demo' }; return s; };
    const effect = vi.fn();
    await expect(desktopReplayHost(snapshot, window, effect).perform({ kind: 'type', target, valueKey: 'password' }, { password: 'never replay' })).rejects.toThrow('Protected');
    expect(effect).not.toHaveBeenCalled();
  });
});
