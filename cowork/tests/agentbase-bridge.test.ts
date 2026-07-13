import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentBaseBridge, classifyAgentBaseTool } from '../src/main/mcp/agentbase-bridge';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup(confirmed = true) {
  const directory = mkdtempSync(join(tmpdir(), 'agentbase-'));
  directories.push(directory);
  const invokeTool = vi.fn(async () => ({ success: true, durationMs: 3, result: { ok: true } }));
  const confirmExternalAction = vi.fn(async () => ({ confirmed, feedback: confirmed ? undefined : 'No' }));
  const bridge = new AgentBaseBridge(directory, {
    listServers: () => [{
      id: 'notion-live',
      name: 'Notion',
      type: 'streamable-http',
      url: 'https://mcp.example.test',
      oauth: true,
      enabled: true,
    }],
    listStatuses: () => [{ id: 'notion-live', status: 'connected' }],
    listTools: () => [
      { name: 'notion__list_pages', serverId: 'notion-live' },
      { name: 'notion__publish_page', serverId: 'notion-live' },
    ],
    listMarketplace: () => [
      { id: 'notion', name: 'Notion', category: 'productivity', installed: true, installedServerId: 'notion-live' },
      { id: 'slack', name: 'Slack', category: 'productivity', installed: false },
    ],
    hasOAuthState: () => true,
    invokeTool,
    confirmExternalAction,
  });
  return { bridge, directory, invokeTool, confirmExternalAction };
}

describe('AgentBaseBridge', () => {
  it('discovers only honest installed/live state and redacts OAuth material', () => {
    const { bridge } = setup();
    const connectors = bridge.list();
    expect(connectors[0]).toMatchObject({
      id: 'notion-live',
      installed: true,
      status: 'connected',
      auth: { mode: 'oauth', configured: true },
    });
    expect(connectors.find((item) => item.catalogId === 'slack')).toMatchObject({
      installed: false,
      status: 'available',
    });
    expect(JSON.stringify(connectors)).not.toContain('token');
  });

  it('allows granted reads but blocks external actions by default', async () => {
    const { bridge, invokeTool, confirmExternalAction } = setup();
    await expect(bridge.invoke({ connectorId: 'notion-live', toolName: 'notion__list_pages', args: {} }))
      .resolves.toMatchObject({ success: true });
    expect(confirmExternalAction).not.toHaveBeenCalled();

    await expect(bridge.invoke({ connectorId: 'notion-live', toolName: 'notion__publish_page', args: {} }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining('permission is disabled') });
    expect(invokeTool).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh confirmation after the external permission is granted', async () => {
    const denied = setup(false);
    denied.bridge.setPermissions('notion-live', { external: true });
    denied.confirmExternalAction.mockResolvedValueOnce({
      confirmed: false,
      feedback: 'authorization=very-secret-token',
    });
    await expect(denied.bridge.invoke({
      connectorId: 'notion-live',
      toolName: 'notion__publish_page',
      args: { title: 'Draft', apiToken: 'never-audited' },
    })).resolves.toMatchObject({ success: false, confirmationRequired: true });
    expect(denied.invokeTool).not.toHaveBeenCalled();
    expect(denied.confirmExternalAction).toHaveBeenCalledWith(expect.objectContaining({
      argumentKeys: ['title'],
    }));
    expect(readFileSync(join(denied.directory, 'audit.jsonl'), 'utf8')).not.toContain('very-secret-token');

    const allowed = setup(true);
    allowed.bridge.setPermissions('notion-live', { external: true });
    await expect(allowed.bridge.invoke({
      connectorId: 'notion-live',
      toolName: 'notion__publish_page',
      args: { title: 'Draft' },
    })).resolves.toMatchObject({ success: true });
    expect(allowed.confirmExternalAction).toHaveBeenCalledTimes(1);
    expect(allowed.invokeTool).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(allowed.directory, 'audit.jsonl'), 'utf8')).not.toContain('Draft');
  });

  it('fails closed for unknown tool semantics', () => {
    expect(classifyAgentBaseTool('list_pages')).toBe('read');
    expect(classifyAgentBaseTool('write_file')).toBe('write');
    expect(classifyAgentBaseTool('get_and_delete')).toBe('external');
    expect(classifyAgentBaseTool('list_then_update')).toBe('write');
    expect(classifyAgentBaseTool('download_export')).toBe('write');
    expect(classifyAgentBaseTool('mark_as_read')).toBe('write');
    expect(classifyAgentBaseTool('archive_thread')).toBe('write');
    expect(classifyAgentBaseTool('ack_alert')).toBe('write');
    expect(classifyAgentBaseTool('do_something')).toBe('external');
  });

  it('rejects non-boolean persisted permission values', () => {
    const { bridge, directory } = setup();
    writeFileSync(join(directory, 'permissions.json'), JSON.stringify({
      'notion-live': { read: true, write: 'yes', external: 'yes' },
    }));
    expect(bridge.list()[0].permissions).toEqual({ read: true, write: false, external: false });
  });

  it('reloads permissions changed by another production bridge', () => {
    const { bridge, directory } = setup();
    expect(bridge.list()[0].permissions.external).toBe(false);
    writeFileSync(join(directory, 'permissions.json'), JSON.stringify({
      'notion-live': { read: true, write: false, external: true },
    }));
    expect(bridge.list()[0].permissions.external).toBe(true);
  });

  it('blocks an external side effect when the durable audit cannot be written', async () => {
    const { bridge, directory, invokeTool, confirmExternalAction } = setup(true);
    bridge.setPermissions('notion-live', { external: true });
    rmSync(join(directory, 'audit.jsonl'), { force: true });
    mkdirSync(join(directory, 'audit.jsonl'));

    await expect(bridge.invoke({
      connectorId: 'notion-live',
      toolName: 'notion__publish_page',
      args: { title: 'Never sent' },
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Audit trail unavailable'),
    });
    expect(confirmExternalAction).not.toHaveBeenCalled();
    expect(invokeTool).not.toHaveBeenCalled();
  });

  it('refuses to follow an audit-log symlink before an external action', async () => {
    const { bridge, directory, invokeTool } = setup(true);
    bridge.setPermissions('notion-live', { external: true });
    const target = join(directory, 'do-not-touch.txt');
    writeFileSync(target, 'sentinel');
    rmSync(join(directory, 'audit.jsonl'), { force: true });
    symlinkSync(target, join(directory, 'audit.jsonl'));

    await expect(bridge.invoke({
      connectorId: 'notion-live',
      toolName: 'notion__publish_page',
      args: {},
    })).resolves.toMatchObject({ success: false });
    expect(invokeTool).not.toHaveBeenCalled();
    expect(readFileSync(target, 'utf8')).toBe('sentinel');
  });

  it('rotates a bounded audit before an external invocation and keeps a tail-readable log', async () => {
    const { bridge, directory, invokeTool } = setup(true);
    bridge.setPermissions('notion-live', { external: true });
    writeFileSync(join(directory, 'audit.jsonl'), `${'x'.repeat(5 * 1024 * 1024)}\n`);

    await expect(bridge.invoke({
      connectorId: 'notion-live',
      toolName: 'notion__publish_page',
      args: {},
    })).resolves.toMatchObject({ success: true });

    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(readdirSync(directory).some((name) => /^audit\.\d+\..+\.jsonl$/u.test(name))).toBe(true);
    const tail = bridge.auditLog(2);
    expect(tail).toHaveLength(2);
    expect(tail[0]?.action).toBe('invocation_completed');
  });
});
