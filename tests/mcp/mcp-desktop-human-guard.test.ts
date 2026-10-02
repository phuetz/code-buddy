import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerDesktopTools, resetDesktopMcpTools } from '../../src/mcp/mcp-desktop-tools.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';

const automation = vi.hoisted(() => ({ initialize: vi.fn(), click: vi.fn(), type: vi.fn(), keyPress: vi.fn(), moveMouse: vi.fn() }));
vi.mock('../../src/desktop-automation/index.js', () => ({ getDesktopAutomation: () => automation }));
type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: { text?: string }[] }>;
const actions = [
  ['desktop_click', 'click', { x: 10, y: 20 }],
  ['desktop_type', 'type', { text: 'Approve' }],
  ['desktop_key', 'keyPress', { key: 'enter' }],
  ['desktop_move_mouse', 'moveMouse', { x: 10, y: 20 }],
] as const;

describe('MCP desktop internal human guard', () => {
  const service = ConfirmationService.getInstance(); const human = vi.fn();
  let directory: string;
  const handlers = new Map<string, Handler>();
  beforeEach(() => {
    resetDesktopMcpTools(); resetPermissionModeManager(); service.resetSession(); vi.clearAllMocks();
    human.mockResolvedValue({ confirmed: false }); service.setInteractiveBridge(human);
    vi.stubEnv('CODEBUDDY_MCP_DESKTOP_CONTROL', '1');
    directory = mkdtempSync(path.join(tmpdir(), 'mcp-desktop-guard-')); mkdirSync(path.join(directory, '.codebuddy'));
    writeFileSync(path.join(directory, '.codebuddy', 'settings.json'), JSON.stringify({ permissions: { allow: actions.map(([name]) => name) } }));
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    handlers.clear();
    registerDesktopTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => handlers.set(name, handler) } as unknown as Parameters<typeof registerDesktopTools>[0]);
  });
  afterEach(() => {
    service.setInteractiveBridge(null); resetPermissionModeManager(); resetDesktopMcpTools();
    vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  });
  for (const [name, actor, args] of actions) {
    it.each(['default', 'dontAsk', 'bypassPermissions'] as const)(`${name} in %s refuses before initialization despite opt-in/project allow`, async mode => {
      const outer = await service.requestConfirmation({ operation: name, filename: 'desktop', toolName: name, detail: { cwd: directory } }, 'tool');
      expect(outer.confirmed).toBe(true); expect(human).not.toHaveBeenCalled();
      getPermissionModeManager().setMode(mode); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true'); service.setSessionFlag('allOperations', true);
      const result = await handlers.get(name)!(args);
      expect({ error: result.isError, initialized: automation.initialize.mock.calls.length, actuated: automation[actor].mock.calls.length, humanCalls: human.mock.calls.length })
        .toEqual({ error: true, initialized: 0, actuated: 0, humanCalls: 1 });
      expect(result.content[0]?.text).toMatch(/human confirmation/);
      expect(human).toHaveBeenCalledTimes(1); expect(human.mock.calls[0]?.[0]).toMatchObject({ toolName: name, forcePrompt: true, riskLevel: 'critical' });
      expect(human.mock.calls[0]?.[0].content).toContain('target not verified');
    });
    it(`${name} allows exactly one actuation after approval and asks again`, async () => {
      human.mockResolvedValue({ confirmed: true }); expect((await handlers.get(name)!(args)).isError).toBeFalsy();
      expect(automation[actor]).toHaveBeenCalledTimes(1);
      human.mockResolvedValue({ confirmed: false }); expect((await handlers.get(name)!(args)).isError).toBe(true);
      expect(automation[actor]).toHaveBeenCalledTimes(1); expect(human).toHaveBeenCalledTimes(2);
    });
    it(`${name} has no fallback approval without a bridge`, async () => {
      service.setInteractiveBridge(null); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
      expect((await handlers.get(name)!(args)).isError).toBe(true); expect(automation.initialize).not.toHaveBeenCalled(); expect(automation[actor]).not.toHaveBeenCalled();
    });
    it(`${name} cannot actuate in plan mode`, async () => {
      getPermissionModeManager().setMode('plan'); human.mockResolvedValue({ confirmed: true });
      expect((await handlers.get(name)!(args)).isError).toBe(true); expect(human).not.toHaveBeenCalled(); expect(automation[actor]).not.toHaveBeenCalled();
    });
  }
});
