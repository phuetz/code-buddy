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
  getDesktopAutomation: () => ({ initialize: vi.fn(), getActiveWindow: async () => ({ processName: 'demo', title: 'Demo', handle: '42', pid: 123 }) }),
  getPermissionManager: () => ({}), getSystemControl: () => ({}),
  getSmartSnapshotManager: () => ({}), getScreenRecorder: () => ({}),
}));
const target = { role: 'button', name: 'Continue' };
function snapshots(source = 'at-spi') {
  const element = { ...target, ref: 19, visible: true, interactive: true, enabled: true, focused: true,
    attributes: { source, protected: false, windowTitle: 'Demo', pid: 123, windowIdentity: 'window1', windowHandle: '42', treeComplete: true } };
  return { takeSnapshot: async () => ({ elements: [element] }), getElement: () => element } as unknown as SmartSnapshotManager;
}
const window = async () => ({ processName: 'demo', title: 'Demo', handle: '42', pid: 123 });
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
    expect(execute).toHaveBeenNthCalledWith(1, { action: 'click', ref: 19 }, expect.any(Function));
    expect(execute).toHaveBeenNthCalledWith(2, kind === 'type' ? { action: 'type', ref: 19, text: 'hello' } : { action: 'key', ref: 19, key: 'Enter' }, expect.any(Function));
  });
  it('refuses a password or an unknown native protection flag', async () => {
    const snapshot = snapshots();
    const take = snapshot.takeSnapshot;
    snapshot.takeSnapshot = async () => { const s = await take(); s.elements[0]!.attributes = { source: 'uia', windowTitle: 'Demo', pid: 123, windowIdentity: 'window1', windowHandle: '42', treeComplete: true }; return s; };
    const effect = vi.fn();
    await expect(desktopReplayHost(snapshot, window, effect).perform({ kind: 'type', target, valueKey: 'password' }, { password: 'never replay' })).rejects.toThrow('Protected');
    expect(effect).not.toHaveBeenCalled();
  });
});

describe('post-consent native revalidation at the actual actuator', () => {
  function fixture() {
    const native = snapshots();
    const element = native.getElement(19)!;
    element.bounds = { x: 10, y: 10, width: 40, height: 20 };
    element.center = { x: 30, y: 20 };
    const elements = [element];
    const snapshot = { elements, valid: true, timestamp: new Date(), ttl: 60000 };
    native.takeSnapshot = vi.fn(async () => snapshot as never);
    native.getCurrentSnapshot = () => snapshot as never;
    let currentWindow = { processName: 'demo', title: 'Demo', handle: '42', pid: 123 };
    const automation = { initialize: vi.fn(), getActiveWindow: async () => currentWindow,
      getScreens: async () => [], click: vi.fn(), type: vi.fn(), keyPress: vi.fn() };
    const tool = new ComputerControlTool();
    Object.assign(tool, { automation, snapshotManager: native });
    const host = desktopReplayHost(native, automation.getActiveWindow, (input, verify) => tool.execute(input, verify));
    return { host, native, element, elements, automation, setWindow: (value: typeof currentWindow) => { currentWindow = value; } };
  }
  it.each(['click', 'type', 'press'] as const)('reobserves after final human prompt before %s, naming role and target', async kind => {
    const f = fixture();
    const prompts: string[] = [];
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async options => {
      expect(options.forcePrompt).toBe(true);
      prompts.push(options.content ?? '');
      return { confirmed: true };
    });
    await f.host.perform({ kind, target, valueKey: 'v', key: 'Enter' }, { v: 'hello' });
    expect(f.automation.click).toHaveBeenCalledOnce();
    expect(prompts.every(p => p.includes('Continue') && p.includes('button'))).toBe(true);
    if (kind === 'type') expect(f.automation.type).toHaveBeenCalledOnce();
    if (kind === 'press') expect(f.automation.keyPress).toHaveBeenCalledOnce();
    expect(f.native.takeSnapshot).toHaveBeenCalledTimes(kind === 'click' ? 2 : 4);
  });
  it.each(['focus', 'terminal', 'handle', 'pid', 'duplicate', 'disabled', 'moved', 'missing', 'incomplete'] as const)('refuses %s changed during consent, without clicking', async mutation => {
    const f = fixture();
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async () => {
      if (mutation === 'focus') f.element.focused = false;
      if (mutation === 'terminal') f.setWindow({ processName: 'terminal', title: 'Demo', handle: '99', pid: 99 });
      if (mutation === 'handle') f.setWindow({ processName: 'demo', title: 'Demo', handle: '99', pid: 123 });
      if (mutation === 'pid') f.setWindow({ processName: 'demo', title: 'Demo', handle: '42', pid: 99 });
      if (mutation === 'duplicate') f.elements.push({ ...f.element, ref: 20 });
      if (mutation === 'disabled') f.element.enabled = false;
      if (mutation === 'moved') f.element.bounds.x = 500;
      if (mutation === 'missing') f.elements.length = 0;
      if (mutation === 'incomplete') f.element.attributes!.treeComplete = false;
      return { confirmed: true };
    });
    await expect(f.host.perform({ kind: 'click', target }, {})).rejects.toThrow();
    expect(f.automation.click).not.toHaveBeenCalled();
  });
  it.each(['type', 'press'] as const)('refuses %s when keyboard focus is lost during its own approval', async kind => {
    const f = fixture();
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async options => {
      if (options.toolArgs?.action === (kind === 'type' ? 'type' : 'key')) f.element.focused = false;
      return { confirmed: true };
    });
    await expect(f.host.perform({ kind, target, valueKey: 'v', key: 'Enter' }, { v: 'hello' })).rejects.toThrow('Keyboard target focus changed during confirmation');
    expect(f.automation.click).toHaveBeenCalledOnce();
    expect(f.automation.type).not.toHaveBeenCalled();
    expect(f.automation.keyPress).not.toHaveBeenCalled();
  });
  it('refuses keyboard activation if the click did not establish focus', async () => {
    const f = fixture();
    f.automation.click.mockImplementation(async () => { f.element.focused = false; });
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockResolvedValue({ confirmed: true });
    await expect(f.host.perform({ kind: 'type', target, valueKey: 'v' }, { v: 'hello' })).rejects.toThrow('Keyboard target focus is not proven');
    expect(f.automation.type).not.toHaveBeenCalled();
  });
  it.each(['type', 'press'] as const)('refuses %s if the terminal gains focus during keyboard consent', async kind => {
    const f = fixture();
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async options => {
      if (options.toolArgs?.action === (kind === 'type' ? 'type' : 'key')) {
        f.setWindow({ processName: 'terminal', title: 'Demo', handle: '99', pid: 99 });
      }
      return { confirmed: true };
    });
    await expect(f.host.perform({ kind, target, valueKey: 'v', key: 'Enter' }, { v: 'hello' })).rejects.toThrow();
    expect(f.automation.click).toHaveBeenCalledOnce();
    expect(f.automation.type).not.toHaveBeenCalled(); expect(f.automation.keyPress).not.toHaveBeenCalled();
  });
  it('refuses two same-title native windows in the same process', async () => {
    const f = fixture();
    f.elements.push({ ...f.element, ref: 20, name: 'Other control', attributes: { ...f.element.attributes, windowIdentity: 'other-window' } });
    await expect(f.host.observe()).rejects.toThrow('window identity');
  });
  it('refuses an incomplete native tree before even asking for consent', async () => {
    const f = fixture(); f.element.attributes!.treeComplete = false;
    const confirm = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation');
    await expect(f.host.perform({ kind: 'click', target }, {})).rejects.toThrow('complete tree');
    expect(confirm).not.toHaveBeenCalled(); expect(f.automation.click).not.toHaveBeenCalled();
  });
  it.each(['PIN', 'OTP', 'IBAN', 'verification code', 'API token'])('refuses protected label %s even if native metadata says public', async name => {
    const f = fixture(); f.element.name = name;
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockResolvedValue({ confirmed: true });
    await expect(f.host.perform({ kind: 'type', target: { role: 'button', name }, valueKey: 'v' }, { v: '1234' })).rejects.toThrow('Protected');
    expect(f.automation.click).not.toHaveBeenCalled();
  });
});

it('checks project model provenance before entering even the desktop cache engine', async () => {
  const trust = await import('../../src/automation-replay/model-trust.js');
  const engine = await import('../../src/automation-replay/engine.js');
  vi.spyOn(trust, 'assertUiModelTrust').mockImplementation(() => { throw new Error('Untrusted project .env'); });
  const run = vi.spyOn(engine, 'runSemanticAct').mockResolvedValue({ success: true, replayed: 1, modelCalls: 0 } as never);
  vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockResolvedValue({ confirmed: true });
  await expect(new ComputerControlTool().execute({ action: 'act', instruction: 'Continue', expectedText: 'Finished' })).rejects.toThrow('project .env');
  expect(run).not.toHaveBeenCalled();
});
