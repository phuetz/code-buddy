import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeGuiAction, type GuiToolInput } from '../../src/tools/gui-tool.js';
import { GuiControlTool } from '../../src/tools/registry/gui-tools.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { getToolGroups } from '../../src/security/tool-policy/tool-groups.js';
import { PolicyResolver } from '../../src/security/tool-policy/policy-resolver.js';
import { DEFAULT_POLICY_CONFIG } from '../../src/security/tool-policy/types.js';

const { mouse, keyboard } = vi.hoisted(() => ({
  mouse: { move: vi.fn(), click: vi.fn(), doubleClick: vi.fn(), scrollDown: vi.fn() },
  keyboard: { type: vi.fn(), pressKey: vi.fn(), releaseKey: vi.fn() },
}));
vi.mock('@nut-tree-fork/nut-js', () => ({
  mouse, keyboard, Button: { LEFT: 1, RIGHT: 2, MIDDLE: 3 }, Key: { Enter: 1, Delete: 2 },
  straightTo: (point: unknown) => point,
  Point: class { constructor(public x: number, public y: number) {} },
}));

const actions: GuiToolInput[] = [
  { action: 'click', x: 100, y: 100 },
  { action: 'type', text: 'approve' },
  { action: 'key', keys: 'delete' },
  { action: 'scroll', x: 100, y: 100, direction: 'down' },
];

describe('B2: gui_control human action gate', () => {
  const service = ConfirmationService.getInstance();
  const human = vi.fn().mockResolvedValue({ confirmed: false });
  beforeEach(() => {
    resetPermissionModeManager();
    service.resetSession();
    human.mockReset().mockResolvedValue({ confirmed: false });
    service.setInteractiveBridge(human);
    vi.clearAllMocks();
  });
  afterEach(() => {
    service.setInteractiveBridge(null);
    resetPermissionModeManager();
    vi.unstubAllEnvs();
  });

  it.each(['default', 'dontAsk', 'bypassPermissions'] as const)('requires a human for all mutations in %s', async (mode) => {
    getPermissionModeManager().setMode(mode);
    vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
    service.setSessionFlag('allOperations', true);
    const tool = new GuiControlTool();
    for (const input of actions) {
      const result = await tool.execute({ ...input, confirmDangerous: true, policyOverrides: { [input.action]: 'allow' } });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/human confirmation/i);
    }
    expect(human).toHaveBeenCalledTimes(actions.length);
    expect(human.mock.calls[0]?.[0]).toMatchObject({ forcePrompt: true, toolName: 'gui_control', riskLevel: 'high' });
    expect(mouse.move).not.toHaveBeenCalled();
    expect(mouse.click).not.toHaveBeenCalled();
    expect(keyboard.type).not.toHaveBeenCalled();
    expect(keyboard.pressKey).not.toHaveBeenCalled();
    expect(mouse.scrollDown).not.toHaveBeenCalled();
  });

  it('applies the gate to direct executeGuiAction calls as well', async () => {
    expect((await executeGuiAction(actions[0]!)).success).toBe(false);
    expect(human).toHaveBeenCalledTimes(1);
    expect(mouse.click).not.toHaveBeenCalled();
  });

  it('allows the approved click exactly once', async () => {
    human.mockResolvedValue({ confirmed: true });
    expect((await new GuiControlTool().execute({ action: 'click', x: 100, y: 100 })).success).toBe(true);
    human.mockResolvedValue({ confirmed: false });
    expect((await new GuiControlTool().execute({ action: 'click', x: 100, y: 100 })).success).toBe(false);
    expect(human).toHaveBeenCalledTimes(2);
    expect(mouse.click).toHaveBeenCalledTimes(1);
  });

  it('keeps the hard system-key denial before human approval', async () => {
    human.mockResolvedValue({ confirmed: true });
    const result = await executeGuiAction({ action: 'key', keys: 'ctrl+alt+delete' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/system key combo/i);
    expect(human).not.toHaveBeenCalled();
    expect(keyboard.pressKey).not.toHaveBeenCalled();
  });

  it('does not turn a plan denial into a human override', async () => {
    getPermissionModeManager().setMode('plan');
    human.mockResolvedValue({ confirmed: true });
    expect((await executeGuiAction(actions[0]!)).success).toBe(false);
    expect(human).not.toHaveBeenCalled();
    expect(mouse.click).not.toHaveBeenCalled();
  });

  it('belongs to the same desktop policy group as computer_control', () => {
    expect(getToolGroups('gui_control')).toEqual(getToolGroups('computer_control'));
    expect(getToolGroups('gui_control').length).toBeGreaterThan(0);
  });

  it('a system policy denial covers both desktop entry points', () => {
    const policy = new PolicyResolver({ ...DEFAULT_POLICY_CONFIG, globalRules: [
      { group: 'group:system:modify', action: 'deny', priority: 100 },
    ] });
    for (const tool of ['computer_control', 'gui_control']) expect(policy.resolve(tool).action).toBe('deny');
  });
});
