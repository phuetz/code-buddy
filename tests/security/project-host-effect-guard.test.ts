import fsPromises from 'node:fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { UserHooksManager } from '../../src/hooks/user-hooks.js';
import { MCPManager } from '../../src/mcp/client.js';
import { loadMCPConfig } from '../../src/mcp/config.js';
import { MCPClient } from '../../src/mcp/mcp-client.js';
import { OfficeMacroTool } from '../../src/tools/office-macro-tool.js';
import { UserSettingsSchema } from '../../src/utils/config-validation/schema.js';
import { SettingsManager } from '../../src/utils/settings-manager.js';

const effects = vi.hoisted(() => ({ transport: vi.fn(), spawn: vi.fn(), macro: vi.fn() }));
vi.mock('../../src/mcp/transports.js', () => ({
  createTransport: effects.transport,
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn().mockResolvedValue(undefined);
    listTools = vi.fn().mockResolvedValue({ tools: [] });
    close = vi.fn().mockResolvedValue(undefined);
  },
}));
// Hooks run real, bounded shell commands; only MCP's legacy spawn is replaced.
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: (...args: unknown[]) => {
    if (args[0] === 'fixture-mcp') {
      effects.spawn(...args);
      const child = new EventEmitter();
      Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { write: vi.fn() }, kill: vi.fn() });
      setImmediate(() => child.emit('error', new Error('fixture started')));
      return child;
    }
    return actual.spawn(...args as Parameters<typeof actual.spawn>);
  } };
});
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const invoke = (...args: unknown[]) => {
    effects.macro(...args);
    const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
    callback(null, 'fixture macro', '');
  };
  return { ...actual, exec: invoke, execFile: invoke };
});

describe('Grok project startup and Office guards', () => {
  const service = ConfirmationService.getInstance();
  const human = vi.fn();
  let directory: string;
  beforeEach(() => {
    resetPermissionModeManager(); service.resetSession();
    human.mockReset().mockResolvedValue({ confirmed: false }); service.setInteractiveBridge(human);
    vi.clearAllMocks();
    directory = mkdtempSync(path.join(tmpdir(), 'host-effect-guard-'));
    mkdirSync(path.join(directory, '.codebuddy'));
    writeFileSync(path.join(directory, '.codebuddy', 'settings.json'), JSON.stringify({
      permissions: { allow: ['project_hook', 'mcp_connect', 'office_macro_execute'] },
    }));
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    effects.transport.mockReturnValue({ type: 'stdio', connect: vi.fn().mockResolvedValue({}), disconnect: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => {
    service.setInteractiveBridge(null); resetPermissionModeManager();
    vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  });
  it.each(['SessionStart', 'PreToolUse'] as const)('Grok cloned hooks %s cannot launch before approval', async event => {
    getPermissionModeManager().setMode('bypassPermissions'); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
    const marker = path.join(directory, 'hook-was-run');
    writeFileSync(path.join(directory, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: {
      [event]: [{ type: 'command', command: `touch '${marker}'` }],
    } }));
    const result = await new UserHooksManager(directory).executeHooks(event, { toolName: 'computer_control' });
    expect({ allowed: result.allowed, spawned: existsSync(marker) }).toEqual({ allowed: false, spawned: false });
    expect(human).toHaveBeenCalledTimes(1); expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
  });
  it('Grok synchronous pre_compact cannot execute an unapproved project command', () => {
    const marker = path.join(directory, 'compact-was-run');
    writeFileSync(path.join(directory, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: {
      pre_compact: [{ type: 'command', command: `touch '${marker}'` }],
    } }));
    new UserHooksManager(directory).runPreCompact({} as Parameters<UserHooksManager['runPreCompact']>[0]);
    expect(existsSync(marker)).toBe(false);
  });
  it('Grok approved hook receives hostile FILE as literal data, including inside quotes', async () => {
    human.mockResolvedValue({ confirmed: true });
    const marker = path.join(directory, 'interpolation-was-run');
    const hostile = `$(touch '${marker}')`;
    writeFileSync(path.join(directory, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: {
      PreToolUse: [{ type: 'command', command: 'printf "%s" "$FILE"' }],
    } }));
    const result = await new UserHooksManager(directory).executeHooks('PreToolUse', { filePath: hostile });
    expect(result.allowed).toBe(true); expect(existsSync(marker)).toBe(false);
    expect(human).toHaveBeenCalledTimes(1);
  });
  it.each(['default', 'dontAsk', 'bypassPermissions'] as const)('Grok project MCP stdio in %s cannot create a transport', async mode => {
    const outer = await service.requestConfirmation({ operation: 'Connect server', filename: 'hostile', toolName: 'mcp_connect', detail: { cwd: directory } }, 'tool');
    expect(outer.confirmed).toBe(true); expect(human).not.toHaveBeenCalled();
    getPermissionModeManager().setMode(mode); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true'); service.setSessionFlag('allOperations', true);
    writeFileSync(path.join(directory, '.codebuddy', 'mcp.json'), JSON.stringify({
      mcpServers: { hostile: { command: 'fixture-mcp', args: ['key', 'Return'] } },
    }));
    const config = loadMCPConfig({ cwd: directory }).servers.find(server => server.name === 'hostile')!;
    const manager = new MCPManager();
    try {
      let error = '';
      try { await manager.addServer(config); } catch (failure) { error = String(failure); }
      expect({ transports: effects.transport.mock.calls.length, error })
        .toEqual({ transports: 0, error: expect.stringMatching(/human confirmation/) });
      expect(human).toHaveBeenCalledTimes(1);
      expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
    } finally { await manager.removeServer(config.name); }
  });
  it('Grok legacy MCP cannot spawn a project process before approval', async () => {
    getPermissionModeManager().setMode('dontAsk'); service.setSessionFlag('allOperations', true);
    const client = new MCPClient();
    let error = '';
    try { await client.connect({ name: 'hostile', command: 'fixture-mcp' }); } catch (failure) { error = String(failure); }
    expect({ processes: effects.spawn.mock.calls.length, error })
      .toEqual({ processes: 0, error: expect.stringMatching(/human confirmation/) }); expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
  });
  it.each(['vba', 'powershell'] as const)('Grok Office %s has an internal forced gate', async type => {
    const outer = await service.requestConfirmation({ operation: 'Execute Office macro', filename: 'Excel', toolName: 'office_macro_execute', detail: { cwd: directory } }, 'tool');
    expect(outer.confirmed).toBe(true); expect(human).not.toHaveBeenCalled();
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      getPermissionModeManager().setMode('dontAsk'); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
      const write = vi.spyOn(fsPromises, 'writeFile');
      const result = await new OfficeMacroTool().execute({ application: 'Excel', macroCode: 'Sub Main()\nEnd Sub', type });
      expect({ success: result.success, processes: effects.macro.mock.calls.length, files: write.mock.calls.length })
        .toEqual({ success: false, processes: 0, files: 0 });
      expect(result.error).toMatch(/human confirmation/);
      expect(human.mock.calls[0]?.[0]).toMatchObject({ filename: 'Excel', riskLevel: 'critical', forcePrompt: true });
    } finally { Object.defineProperty(process, 'platform', descriptor); }
  });
  it('MCP can connect only after the human accepts', async () => {
    human.mockResolvedValue({ confirmed: true }); const manager = new MCPManager();
    try {
      await manager.addServer({ name: 'approved', command: 'fixture-mcp' });
      expect(effects.transport).toHaveBeenCalledTimes(1); expect(human).toHaveBeenCalledTimes(1);
      expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
    } finally { await manager.dispose(); }
  });
  it('MCP fails closed without a human channel even in automatic mode', async () => {
    service.setInteractiveBridge(null); vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
    await expect(new MCPManager().addServer({ name: 'unapproved', command: 'fixture-mcp' })).rejects.toThrow(/human confirmation/);
    expect(effects.transport).not.toHaveBeenCalled();
  });
  it('canceling MCP while a human decision is pending prevents a late start', async () => {
    let approve: (value: { confirmed: boolean }) => void = () => undefined;
    human.mockImplementation(() => new Promise(resolve => { approve = resolve; }));
    const manager = new MCPManager(); const pending = manager.addServer({ name: 'cancelled', command: 'fixture-mcp' });
    const rejected = expect(pending).rejects.toThrow(/cancelled/);
    await manager.removeServer('cancelled'); approve({ confirmed: true }); await rejected;
    expect(effects.transport).not.toHaveBeenCalled();
  });
  it('MCP confirmation does not copy secret environment values', async () => {
    await expect(new MCPManager().addServer({ name: 'private', command: 'fixture-mcp',
      env: { API_TOKEN: 'fixture-private-value' } })).rejects.toThrow(/human confirmation/);
    expect(human.mock.calls[0]?.[0].content).toContain('fixture-mcp');
    expect(human.mock.calls[0]?.[0].content).not.toContain('fixture-private-value');
  });
  it('Grok valid user settings retain computerControl through the actual loader', () => {
    const file = path.join(directory, 'user-settings.json');
    const settings = { computerControl: { policyOverrides: { close_window: 'block' } } };
    writeFileSync(file, JSON.stringify(settings));
    expect(UserSettingsSchema.safeParse(settings).success).toBe(true);
    const Constructor = SettingsManager as unknown as new (overrides: { userSettingsPath: string }) => SettingsManager;
    expect(new Constructor({ userSettingsPath: file }).loadUserSettings().computerControl).toEqual(settings.computerControl);
  });
});
