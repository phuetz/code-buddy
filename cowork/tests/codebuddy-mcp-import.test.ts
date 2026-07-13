import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverCodeBuddyMcpImports,
  materializeCodeBuddyMcpImport,
} from '../src/main/mcp/codebuddy-mcp-import';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writeConfig(root: string, servers: Record<string, unknown>): void {
  mkdirSync(join(root, '.codebuddy'), { recursive: true });
  writeFileSync(
    join(root, '.codebuddy', 'mcp.json'),
    `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`,
  );
}

describe('Code Buddy MCP import discovery', () => {
  it('previews local stdio entries without exposing or persisting secret values', () => {
    const workspace = temporaryRoot('cowork-mcp-project-');
    const home = temporaryRoot('cowork-mcp-home-');
    writeConfig(workspace, {
      pubcommander: {
        type: 'stdio',
        command: 'node',
        args: ['/opt/pubcommander/mcp.js'],
        env: { LOG_LEVEL: 'silent', API_TOKEN: '${API_TOKEN}' },
        enabled: true,
        description: 'Editorial tools',
      },
      github: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'github-mcp'],
        env: { GITHUB_TOKEN: 'literal-secret-must-not-cross' },
        enabled: false,
      },
    });

    const discovery = discoverCodeBuddyMcpImports({
      workspaceRoots: [workspace],
      homeDir: home,
      configuredServers: [],
    });
    expect(discovery.warnings).toEqual([]);
    expect(discovery.candidates).toHaveLength(2);
    expect(discovery.candidates[0]).toMatchObject({
      name: 'pubcommander',
      command: 'node',
      source: 'project',
      importable: true,
      enabledInSource: true,
      envKeys: ['LOG_LEVEL', 'API_TOKEN'],
      secretEnvKeys: ['API_TOKEN'],
    });
    expect(JSON.stringify(discovery)).not.toContain('literal-secret-must-not-cross');

    const imported = materializeCodeBuddyMcpImport({
      workspaceRoots: [workspace],
      homeDir: home,
      configuredServers: [],
    }, discovery.candidates[0]!.id);
    expect(imported).toMatchObject({
      name: 'pubcommander',
      type: 'stdio',
      command: 'node',
      enabled: false,
      env: { LOG_LEVEL: 'silent' },
    });
    expect(imported.env).not.toHaveProperty('API_TOKEN');
  });

  it('uses project priority, marks existing connectors and refuses network auto-import', () => {
    const workspace = temporaryRoot('cowork-mcp-priority-project-');
    const home = temporaryRoot('cowork-mcp-priority-home-');
    writeConfig(workspace, {
      explorer: { type: 'stdio', command: '/usr/bin/true', enabled: true },
      remote: { type: 'streamable-http', url: 'https://example.test/mcp', enabled: true },
    });
    writeConfig(home, {
      explorer: { type: 'stdio', command: '/untrusted/lower-priority', enabled: true },
    });
    const options = {
      workspaceRoots: [workspace],
      homeDir: home,
      configuredServers: [{
        id: 'existing',
        name: 'explorer',
        type: 'stdio' as const,
        command: '/usr/bin/true',
        enabled: false,
      }],
    };
    const discovery = discoverCodeBuddyMcpImports(options);
    expect(discovery.candidates.filter((entry) => entry.name === 'explorer')).toHaveLength(1);
    expect(discovery.candidates.find((entry) => entry.name === 'explorer')).toMatchObject({
      command: '/usr/bin/true',
      alreadyConfigured: true,
    });
    expect(discovery.candidates.find((entry) => entry.name === 'remote')).toMatchObject({
      importable: false,
      transport: 'streamable-http',
    });
    expect(() => materializeCodeBuddyMcpImport(
      options,
      discovery.candidates.find((entry) => entry.name === 'explorer')!.id,
    )).toThrow(/already configured/i);
  });

  it('binds approval to the preview fingerprint and rejects symlinked config', () => {
    const workspace = temporaryRoot('cowork-mcp-fingerprint-');
    const home = temporaryRoot('cowork-mcp-fingerprint-home-');
    writeConfig(workspace, {
      local: { type: 'stdio', command: '/usr/bin/true', enabled: true },
    });
    const options = { workspaceRoots: [workspace], homeDir: home, configuredServers: [] };
    const original = discoverCodeBuddyMcpImports(options).candidates[0]!;
    writeConfig(workspace, {
      local: { type: 'stdio', command: '/usr/bin/false', enabled: true },
    });
    expect(() => materializeCodeBuddyMcpImport(options, original.id)).toThrow(/no longer exists/i);

    const linkedRoot = temporaryRoot('cowork-mcp-linked-');
    const external = temporaryRoot('cowork-mcp-external-');
    writeConfig(external, { escaped: { type: 'stdio', command: '/usr/bin/true' } });
    mkdirSync(join(linkedRoot, '.codebuddy'));
    symlinkSync(join(external, '.codebuddy', 'mcp.json'), join(linkedRoot, '.codebuddy', 'mcp.json'));
    const linked = discoverCodeBuddyMcpImports({
      workspaceRoots: [linkedRoot],
      homeDir: home,
      configuredServers: [],
    });
    expect(linked.candidates).toEqual([]);
    expect(linked.warnings.join(' ')).toMatch(/lien/u);
  });

  it('redacts literal argument secrets and refuses to persist them', () => {
    const workspace = temporaryRoot('cowork-mcp-secret-args-');
    const home = temporaryRoot('cowork-mcp-secret-args-home-');
    writeConfig(workspace, {
      unsafe: {
        type: 'stdio',
        command: 'node',
        args: [
          'server.js',
          '--api-key',
          'ARG_SECRET_MUST_NOT_CROSS',
          'https://example.test/start?token=URL_SECRET_MUST_NOT_CROSS&mode=safe',
        ],
        env: { LOG_LEVEL: 'opaque-secret-looking-value' },
      },
    });
    const options = { workspaceRoots: [workspace], homeDir: home, configuredServers: [] };
    const discovery = discoverCodeBuddyMcpImports(options);

    expect(discovery.candidates).toHaveLength(1);
    expect(discovery.candidates[0]).toMatchObject({
      importable: false,
      args: [
        'server.js',
        '--api-key',
        '[REDACTED]',
        expect.stringContaining('token=%5BREDACTED%5D'),
      ],
      secretEnvKeys: ['LOG_LEVEL'],
    });
    expect(JSON.stringify(discovery)).not.toContain('ARG_SECRET_MUST_NOT_CROSS');
    expect(JSON.stringify(discovery)).not.toContain('URL_SECRET_MUST_NOT_CROSS');
    expect(JSON.stringify(discovery)).not.toContain('opaque-secret-looking-value');
    expect(() => materializeCodeBuddyMcpImport(
      options,
      discovery.candidates[0]!.id,
    )).toThrow(/secrète littérale/u);
  });

  it('rejects symlinked config directories and symlinked working directories', () => {
    const workspace = temporaryRoot('cowork-mcp-symlink-root-');
    const home = temporaryRoot('cowork-mcp-symlink-home-');
    const external = temporaryRoot('cowork-mcp-symlink-external-');
    writeConfig(external, { escaped: { type: 'stdio', command: '/usr/bin/true' } });
    symlinkSync(join(external, '.codebuddy'), join(workspace, '.codebuddy'));
    const directoryLinked = discoverCodeBuddyMcpImports({
      workspaceRoots: [workspace],
      homeDir: home,
      configuredServers: [],
    });
    expect(directoryLinked.candidates).toEqual([]);
    expect(directoryLinked.warnings.join(' ')).toMatch(/dossier réel/u);

    const cwdWorkspace = temporaryRoot('cowork-mcp-cwd-symlink-');
    const realCwd = join(cwdWorkspace, 'real-cwd');
    mkdirSync(realCwd);
    symlinkSync(realCwd, join(cwdWorkspace, 'linked-cwd'));
    writeConfig(cwdWorkspace, {
      linked: { type: 'stdio', command: '/usr/bin/true', cwd: 'linked-cwd' },
    });
    const cwdDiscovery = discoverCodeBuddyMcpImports({
      workspaceRoots: [cwdWorkspace],
      homeDir: home,
      configuredServers: [],
    });
    expect(cwdDiscovery.candidates[0]).toMatchObject({
      importable: false,
      issue: expect.stringMatching(/lien symbolique/u),
    });
  });

  it('fails closed on malformed argument, environment, and cwd types', () => {
    const workspace = temporaryRoot('cowork-mcp-types-');
    const home = temporaryRoot('cowork-mcp-types-home-');
    writeConfig(workspace, {
      badArgs: { type: 'stdio', command: 'node', args: '--inspect' },
      badEnv: { type: 'stdio', command: 'node', env: ['TOKEN=value'] },
      badCwd: { type: 'stdio', command: 'node', cwd: 42 },
    });
    const candidates = discoverCodeBuddyMcpImports({
      workspaceRoots: [workspace],
      homeDir: home,
      configuredServers: [],
    }).candidates;
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => !candidate.importable)).toBe(true);
  });
});
