import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComputerControlTool, type ComputerControlInput } from '../../src/tools/computer-control-tool.js';
import { COMPUTER_CONTROL_TOOL } from '../../src/codebuddy/tool-definitions/computer-control-tools.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { getSettingsManager } from '../../src/utils/settings-manager.js';
import { logger } from '../../src/utils/logger.js';

vi.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: () => ({
    initialize: vi.fn(),
    getActiveWindow: async () => ({ handle: 'test', title: 'Draft - Test Editor', processName: 'test-editor', pid: 42 }),
  }),
  getPermissionManager: () => ({}),
  getSystemControl: () => ({}),
  getSmartSnapshotManager: () => ({}),
  getScreenRecorder: () => ({}),
}));

interface PolicyAccess {
  enforceSafetyPolicy(input: ComputerControlInput): Promise<string | null>;
  closeWindow(input: ComputerControlInput): Promise<{ success: boolean }>;
}

describe('computer_control host safety policy', () => {
  let tool: ComputerControlTool;
  const service = ConfirmationService.getInstance();
  const human = vi.fn().mockResolvedValue({ confirmed: false });

  beforeEach(() => {
    resetPermissionModeManager();
    service.resetSession();
    service.setInteractiveBridge(human);
    human.mockReset().mockResolvedValue({ confirmed: false });
    tool = new ComputerControlTool();
  });
  afterEach(() => {
    service.setInteractiveBridge(null);
    resetPermissionModeManager();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const gate = (t: ComputerControlTool, input: ComputerControlInput) =>
    (t as unknown as PolicyAccess).enforceSafetyPolicy(input);

  it.each([
    { action: 'close_window', confirmDangerous: true },
    { action: 'close_window', policyOverrides: { close_window: 'allow' } },
    { action: 'key', key: 'delete', confirmDangerous: true, policyOverrides: { key: 'allow' } },
    { action: 'hotkey', key: 'f4', modifiers: ['alt'], confirmDangerous: true },
  ] as ComputerControlInput[])('requires a human despite model flags: %j', async (input) => {
    const effect = vi.spyOn(tool as unknown as PolicyAccess, 'closeWindow').mockResolvedValue({ success: true });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const result = await tool.execute(input);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/confirmation/i);
    expect(human).toHaveBeenCalledTimes(1);
    expect(human.mock.calls[0]?.[0]).toMatchObject({
      forcePrompt: true, riskLevel: 'high', toolName: 'computer_control',
      operation: expect.stringContaining('high'),
      filename: expect.stringContaining('test-editor'),
    });
    expect(effect).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring model-supplied'), expect.any(Object));
  });

  it.each(['default', 'bypassPermissions', 'dontAsk'] as const)('requires a fresh human decision in %s mode', async (mode) => {
    getPermissionModeManager().setMode(mode);
    vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
    service.setSessionFlag('allOperations', true);
    expect(await gate(tool, { action: 'close_window' })).toMatch(/confirmation/i);
    expect(human).toHaveBeenCalledTimes(1);
  });

  it('executes only after the human accepts', async () => {
    human.mockResolvedValue({ confirmed: true });
    const effect = vi.spyOn(tool as unknown as PolicyAccess, 'closeWindow').mockResolvedValue({ success: true });
    expect((await tool.execute({ action: 'close_window' })).success).toBe(true);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(human).toHaveBeenCalledTimes(1);
  });

  it('blocks in plan mode and never asks to override it', async () => {
    getPermissionModeManager().setMode('plan');
    expect(await gate(tool, { action: 'close_window', confirmDangerous: true })).toMatch(/plan mode/i);
    expect(human).not.toHaveBeenCalled();
  });

  it.each([{ action: 'click', x: 10, y: 20 }, { action: 'snapshot' }, { action: 'close_window', simulateOnly: true }] as ComputerControlInput[])(
    'preserves benign/read/dry-run actions: %j', async (input) => {
      expect(await gate(tool, input)).toBeNull();
      expect(human).not.toHaveBeenCalled();
    });

  it('takes action overrides only from host settings', async () => {
    vi.spyOn(getSettingsManager(), 'getProjectSetting').mockReturnValue({ policyOverrides: { close_window: 'allow' } });
    expect(await gate(tool, { action: 'close_window', policyOverrides: { close_window: 'block' } })).toBeNull();
    expect(human).not.toHaveBeenCalled();
  });

  it('a host block wins over agent flags and simulation', async () => {
    vi.spyOn(getSettingsManager(), 'getProjectSetting').mockReturnValue({ policyOverrides: { close_window: 'block' } });
    expect(await gate(tool, { action: 'close_window', confirmDangerous: true, simulateOnly: true })).toMatch(/blocked/);
    expect(human).not.toHaveBeenCalled();
  });

  it('fails closed when no human approval channel is available', async () => {
    service.setInteractiveBridge(null);
    expect(await gate(tool, { action: 'close_window', confirmDangerous: true })).toMatch(/interactive terminal/i);
  });

  it('does not pass ignored permissions to confirmation or proof artifacts', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const result = await tool.execute({ action: 'close_window', confirmDangerous: true, policyOverrides: { close_window: 'allow' } });
    expect(human.mock.calls[0]?.[0].toolArgs).not.toHaveProperty('confirmDangerous');
    expect(human.mock.calls[0]?.[0].toolArgs).not.toHaveProperty('policyOverrides');
    expect((result.data as { harness: { approval?: unknown } }).harness.approval).toBeUndefined();
    expect(warn.mock.calls.filter(([message]) => message === 'Ignoring model-supplied computer control permissions')).toHaveLength(1);
  });

  it('cannot lift a nested workflow guard with parent or step flags', async () => {
    const effect = vi.spyOn(tool as unknown as PolicyAccess, 'closeWindow').mockResolvedValue({ success: true });
    await tool.execute({
      action: 'macro', confirmDangerous: true, policyOverrides: { macro: 'allow' },
      steps: [{ action: 'close_window', confirmDangerous: true, policyOverrides: { close_window: 'allow' } }],
    });
    expect(human).toHaveBeenCalledTimes(1);
    expect(effect).not.toHaveBeenCalled();
  });

  it('honors an explicit host confirmation for a macro', async () => {
    vi.spyOn(getSettingsManager(), 'getProjectSetting').mockReturnValue({ policyOverrides: { macro: 'confirm' } });
    expect(await gate(tool, { action: 'macro', steps: [{ action: 'click' }] })).toMatch(/confirmation/i);
    expect(human).toHaveBeenCalledTimes(1);
  });

  it('names the application profile and its critical risk', async () => {
    await tool.execute({ action: 'open_app', appName: 'terminal', confirmDangerous: true });
    expect(human.mock.calls[0]?.[0]).toMatchObject({ filename: 'Terminal', riskLevel: 'critical' });
  });

  it('exposes neither permission flag in the model schema or instructions', () => {
    expect(JSON.stringify(COMPUTER_CONTROL_TOOL)).not.toMatch(/confirmDangerous|policyOverrides/);
  });
});
