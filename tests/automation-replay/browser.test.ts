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
  Object.assign(page, { url: () => 'https://other.test/' });
  await expect(manager.performSemanticAction(action, {}, 'https://example.test/')).rejects.toThrow('URL changed');
  expect(locator.click).toHaveBeenCalledOnce();
  locator.count = async () => 2;
  await expect(manager.performSemanticAction(action, {})).rejects.toThrow('ambiguous');
  expect(locator.click).toHaveBeenCalledOnce();
  locator.count = async () => 1;
  locator.getAttribute = async () => 'PASSWORD' as never;
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

it('refuses a URL changed during browser approval even with identical controls', async () => {
  const manager = new BrowserManager(); let url = 'https://example.test/original';
  vi.spyOn(manager, 'takeSnapshot').mockImplementation(async () => ({ url, elements: [{
    ref: 1, ...action.target, visible: true, interactive: true,
  }] }) as never);
  vi.spyOn(manager, 'evaluate').mockResolvedValue({ success: true, value: 'Continue' });
  const effect = vi.spyOn(manager, 'performSemanticAction').mockResolvedValue();
  vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockImplementation(async () => {
    url = 'https://other.test/same-controls'; return { confirmed: true };
  });
  await expect(browserReplayHost(manager).perform(action, {})).rejects.toThrow('URL changed');
  expect(effect).not.toHaveBeenCalled();
});

it('does not fingerprint field or ARIA values, including protected low-entropy values', async () => {
  const manager = new BrowserManager(); let value = '1234';
  vi.spyOn(manager, 'takeSnapshot').mockImplementation(async () => ({ url: 'https://example.test', elements: [{
    ref: 1, role: 'textbox', name: 'OTP', visible: true, interactive: true,
    value, ariaAttributes: { 'aria-valuetext': value, 'aria-valuenow': value },
  }] }) as never);
  vi.spyOn(manager, 'evaluate').mockResolvedValue({ success: true, value: 'OTP' });
  const host = browserReplayHost(manager);
  const first = await host.observe(); value = '5678';
  expect(await host.observe()).toEqual(first);
  expect(first.nodes[0]?.protected).toBe(true);
});
