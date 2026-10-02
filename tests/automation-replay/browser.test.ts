import { describe, it, expect, vi, afterEach } from 'vitest';
import { BrowserManager } from '../../src/browser-automation/browser-manager.js';
import { browserReplayHost } from '../../src/automation-replay/browser-host.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { WebTestTool } from '../../src/tools/registry/web-test-tool.js';
import { BrowserExecuteTool, BrowserSnapshotExecuteTool } from '../../src/tools/registry/misc-tools.js';

const action = { kind: 'click' as const, target: { role: 'button', name: 'Continue' } };
afterEach(() => { vi.restoreAllMocks(); ConfirmationService.getInstance().setInteractiveBridge(null); });
it('semantic browser execution uses strict role/name locators, never coordinates', async () => {
  const manager = new BrowserManager();
  const locator = { count: async () => 1, isVisible: async () => true, isEnabled: async () => true,
    getAttribute: async () => null, click: vi.fn(), fill: vi.fn(), press: vi.fn() };
  const page = { getByRole: vi.fn(() => locator), waitForTimeout: vi.fn(), mouse: { click: vi.fn() } };
  vi.spyOn(manager as unknown as { getCurrentPage: () => unknown }, 'getCurrentPage').mockReturnValue(page);
  await manager.performSemanticAction(action, {});
  expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Continue', exact: true });
  expect(locator.click).toHaveBeenCalledOnce(); expect(page.mouse.click).not.toHaveBeenCalled();
  locator.count = async () => 2;
  await expect(manager.performSemanticAction(action, {})).rejects.toThrow('ambiguous');
  expect(locator.click).toHaveBeenCalledOnce();
  locator.count = async () => 1;
  locator.getAttribute = async () => 'password' as never;
  await expect(manager.performSemanticAction({ ...action, kind: 'type', valueKey: 'p' }, { p: 'secret' })).rejects.toThrow('Password replay');
  expect(locator.fill).not.toHaveBeenCalled();
});
it('rechecks the target after browser approval and propagates denial', async () => {
  const manager = new BrowserManager();
  let protectedField = false;
  vi.spyOn(manager, 'takeSnapshot').mockImplementation(async () => ({ url: 'https://example.test/', elements: [{
    ref: 1, role: 'button', name: 'Continue', visible: true, interactive: true, disabled: false,
    inputType: protectedField ? 'password' : 'button',
  }] }) as never);
  vi.spyOn(manager, 'evaluate').mockResolvedValue({ success: true, value: 'Continue' });
  const effect = vi.spyOn(manager, 'performSemanticAction').mockResolvedValue();
  const host = browserReplayHost(manager);
  vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async () => {
    protectedField = true; return { confirmed: true };
  });
  await expect(host.perform(action, {})).rejects.toThrow('Protected');
  expect(effect).not.toHaveBeenCalled();
});

describe('web_test natural assertion integration', () => {
  it.each([true, false])('propagates a fresh browser assert result %s into the report', async passed => {
    vi.spyOn(BrowserSnapshotExecuteTool.prototype, 'execute').mockResolvedValue({ success: true, output: 'snapshot' });
    const browser = vi.spyOn(BrowserExecuteTool.prototype, 'execute').mockImplementation(async input => {
      if (input.action === 'assert') return { success: passed, output: 'Observed evidence' };
      return { success: true, data: { entries: [], failures: [] } };
    });
    // This test isolates dispatch/reporting; real browser + model is measured by scripts/qa/rejeu-live.ts.
    const result = await new WebTestTool().execute({ url: 'https://example.test/', screenshot: false,
      assertions: [{ type: 'assert', value: 'A control is available' }] });
    expect(browser).toHaveBeenCalledWith({ action: 'assert', instruction: 'A control is available' });
    expect((result.data as { passed: boolean }).passed).toBe(passed);
  });
});
