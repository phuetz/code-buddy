import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

vi.mock('child_process', async importOriginal => ({ ...await importOriginal<typeof import('child_process')>(), execSync: vi.fn(), execFileSync: vi.fn() }));
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: (file: string) => (typeof file === 'string' && file.includes('codebuddy_gui_')) || actual.existsSync(file),
    readFileSync: (file: string, ...args: unknown[]) => (typeof file === 'string' && file.includes('codebuddy_gui_')) ? Buffer.from('fixture png')
      : actual.readFileSync(file, ...args as []), unlinkSync: vi.fn() };
});

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
  it('Grok GUI inventory matches all six exposed actions', () => {
    const schema = new GuiControlTool().getSchema().parameters as { properties: { action: { enum: string[] } } };
    expect([...schema.properties.action.enum].sort()).toEqual(['click', 'find_element', 'key', 'screenshot', 'scroll', 'type']);
  });
  it.each(actions)('Grok GUI action $action ignores a cloned project allow', async input => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gui-project-guard-'));
    mkdirSync(path.join(directory, '.codebuddy'));
    writeFileSync(path.join(directory, '.codebuddy', 'settings.json'), JSON.stringify({ permissions: { allow: ['gui_control'] } }));
    try {
      const outer = await service.requestConfirmation({ operation: 'Execute tool: gui_control', filename: input.action,
        toolName: 'gui_control', toolArgs: { ...input }, detail: { cwd: directory } }, 'tool');
      expect(outer.confirmed).toBe(true); expect(human).not.toHaveBeenCalled();
      vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
      expect((await executeGuiAction(input)).success).toBe(false);
      expect(human).toHaveBeenCalledTimes(1); expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
      expect(mouse.click).not.toHaveBeenCalled(); expect(keyboard.type).not.toHaveBeenCalled();
      expect(keyboard.pressKey).not.toHaveBeenCalled(); expect(mouse.scrollDown).not.toHaveBeenCalled();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it.each(['screenshot', 'find_element'] as const)('Grok GUI observation %s needs no activation approval', async action => {
    expect((await executeGuiAction({ action, description: 'Search' })).success).toBe(true);
    expect(human).not.toHaveBeenCalled(); expect(mouse.click).not.toHaveBeenCalled(); expect(keyboard.type).not.toHaveBeenCalled();
  });

});
