/**
 * Security audit of the read-only LSP navigation tools (PR #103).
 *
 * Proofs: workspace confinement (traversal, absolute, symlink), no arbitrary
 * binary from project config, read-only metadata, and the fleetSafe flag not
 * exposing the tools through peer.tool.invoke (no executor → fail closed).
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LSPClient, type LSPLanguage } from '../../src/lsp/lsp-client.js';
import {
  LspDefinitionTool,
  LspDiagnosticsTool,
  LspHoverTool,
  LspReferencesTool,
  LspSymbolsTool,
  type LspReadClient,
  type LspToolDependencies,
} from '../../src/tools/lsp-navigation-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

const isWindows = process.platform === 'win32';

function makeRecordingClient() {
  const calls: string[] = [];
  const client: LspReadClient = {
    detectLanguage: (file) => {
      calls.push(`detectLanguage:${file}`);
      return file.endsWith('.ts') ? 'typescript' : null;
    },
    getServerConfig: (language) => ({ language, command: 'typescript-language-server', args: ['--stdio'] }),
    ensureServerForFile: async () => {
      calls.push('ensureServerForFile');
      return true;
    },
    goToDefinition: async () => [],
    findReferences: async () => [],
    hover: async () => null,
    getDocumentSymbols: async () => [],
    getDiagnostics: async () => [],
  };
  return { client, calls };
}

const ALL_TOOLS: Array<[string, (deps: LspToolDependencies) => LspDefinitionTool | LspReferencesTool | LspHoverTool | LspSymbolsTool | LspDiagnosticsTool, Record<string, unknown>]> = [
  ['lsp_definition', (deps) => new LspDefinitionTool(deps), { symbol: 'x' }],
  ['lsp_references', (deps) => new LspReferencesTool(deps), { symbol: 'x' }],
  ['lsp_hover', (deps) => new LspHoverTool(deps), { symbol: 'x' }],
  ['lsp_symbols', (deps) => new LspSymbolsTool(deps), {}],
  ['lsp_diagnostics', (deps) => new LspDiagnosticsTool(deps), {}],
];

describe('LSP navigation tools — workspace confinement', () => {
  let sandbox: string;
  let workspace: string;
  let outsideFile: string;

  beforeAll(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-lsp-sec-'));
    workspace = path.join(sandbox, 'workspace');
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'inside.ts'), 'export const x = 1;\n');
    outsideFile = path.join(sandbox, 'outside.ts');
    await fs.writeFile(outsideFile, 'export const x = "SECRET";\n');
    if (!isWindows) {
      await fs.symlink(outsideFile, path.join(workspace, 'link.ts'));
      await fs.symlink(sandbox, path.join(workspace, 'escape'), 'dir');
    }
  });

  afterAll(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it.each(ALL_TOOLS)('%s refuses ../ traversal and never touches the LSP client', async (_name, make, args) => {
    const { client, calls } = makeRecordingClient();
    const commandExists = vi.fn(async () => true);
    const result = await make({ client, commandExists }).execute(
      { ...args, file: '../outside.ts' },
      { cwd: workspace }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the active workspace');
    expect(calls).toEqual([]);
    expect(commandExists).not.toHaveBeenCalled();
  });

  it.each(ALL_TOOLS)('%s refuses an absolute path outside the workspace', async (_name, make, args) => {
    const { client, calls } = makeRecordingClient();
    const result = await make({ client, commandExists: async () => true }).execute(
      { ...args, file: outsideFile },
      { cwd: workspace }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the active workspace');
    expect(calls).toEqual([]);
  });

  it.each(ALL_TOOLS)('%s refuses a symlink (file or directory) that resolves outside the workspace', async (_name, make, args) => {
    if (isWindows) return;
    const { client, calls } = makeRecordingClient();
    const tool = make({ client, commandExists: async () => true });

    const viaFileLink = await tool.execute({ ...args, file: 'link.ts' }, { cwd: workspace });
    expect(viaFileLink.success).toBe(false);
    expect(viaFileLink.error).toContain('resolves outside the active workspace');

    const viaDirLink = await tool.execute({ ...args, file: 'escape/outside.ts' }, { cwd: workspace });
    expect(viaDirLink.success).toBe(false);
    expect(viaDirLink.error).toContain('resolves outside the active workspace');
    expect(calls).toEqual([]);
  });

  it('accepts relative and absolute paths INSIDE the workspace', async () => {
    const { client, calls } = makeRecordingClient();
    const tool = new LspSymbolsTool({ client, commandExists: async () => true });

    const relative = await tool.execute({ file: 'src/inside.ts' }, { cwd: workspace });
    const absolute = await tool.execute({ file: path.join(workspace, 'src', 'inside.ts') }, { cwd: workspace });

    expect(relative.success).toBe(true);
    expect(absolute.success).toBe(true);
    expect(calls.filter((call) => call === 'ensureServerForFile')).toHaveLength(2);
  });

  it('anchors on process.cwd() when no execution context is given', async () => {
    const repoRoot = process.cwd();
    const relativeToRepo = path.relative(repoRoot, workspace);
    // Only meaningful when the temp workspace is not inside the repository.
    if (!relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo)) return;
    const { client, calls } = makeRecordingClient();

    const result = await new LspSymbolsTool({ client, commandExists: async () => true }).execute({
      file: path.join(workspace, 'src', 'inside.ts'),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the active workspace');
    expect(calls).toEqual([]);
  });
});

describe('LSP navigation tools — no arbitrary binary, read-only metadata', () => {
  let projectDir: string;
  let previousCwd: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-lsp-cfg-'));
    previousCwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('ignores a project-level .codebuddy/lsp-config.json: only built-in server commands are used', async () => {
    await fs.mkdir(path.join(projectDir, '.codebuddy'), { recursive: true });
    const configPath = path.join(projectDir, '.codebuddy', 'lsp-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        servers: [{ language: 'typescript', command: '/tmp/evil-binary', args: ['--pwn'] }],
        typescript: { command: '/tmp/evil-binary', args: ['--pwn'] },
      })
    );
    process.chdir(projectDir);

    const viaRelativeDefault = new LSPClient();
    const viaExplicitPath = new LSPClient(configPath);
    for (const client of [viaRelativeDefault, viaExplicitPath]) {
      const config = client.getServerConfig('typescript');
      expect(config?.command).toBe('typescript-language-server');
      expect(config?.args).toEqual(['--stdio']);
      expect(client.getRegisteredLanguages()).toEqual([]);
    }
  });

  it('every built-in server command is a bare PATH-resolved name (no path, no shell metacharacters)', () => {
    const languages = LSPClient.getSupportedLanguages();
    expect(languages.length).toBeGreaterThan(0);
    for (const language of languages) {
      const config = LSPClient.getDefaultConfig(language as LSPLanguage);
      expect(config?.command).toMatch(/^[A-Za-z0-9._-]+$/);
      for (const arg of config?.args ?? []) expect(arg).toMatch(/^[A-Za-z0-9._=-]+$/);
    }
  });

  it('commandExists is probed only with the configured server command, never with user input', async () => {
    const { client } = makeRecordingClient();
    const commandExists = vi.fn(async () => false);
    await fs.writeFile(path.join(projectDir, 'a.ts'), 'export const a = 1;\n');

    const result = await new LspDiagnosticsTool({ client, commandExists }).execute(
      { file: 'a.ts; rm -rf /' },
      { cwd: projectDir }
    );

    expect(result.success).toBe(false);
    expect(commandExists).not.toHaveBeenCalled();

    await new LspDiagnosticsTool({ client, commandExists }).execute({ file: 'a.ts' }, { cwd: projectDir });
    expect(commandExists).toHaveBeenCalledTimes(1);
    expect(commandExists).toHaveBeenCalledWith('typescript-language-server');
  });

  it('declares read-only, no-network metadata in both the instance and the registry table', () => {
    for (const [name, make] of ALL_TOOLS) {
      const { client } = makeRecordingClient();
      const metadata = make({ client, commandExists: async () => true }).getMetadata();
      expect(metadata).toMatchObject({ name, modifiesFiles: false, makesNetworkRequests: false });
      const registry = TOOL_METADATA.find((entry) => entry.name === name);
      expect(registry).toBeDefined();
      expect(registry?.fleetSafe).toBe(true);
    }
  });
});

describe('LSP navigation tools — fleetSafe does not expose them via peer.tool.invoke', () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-lsp-peer-'));
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = tempWorkspace;
    process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST =
      'view_file,list_directory,search,lsp_definition,lsp_references,lsp_hover,lsp_symbols,lsp_diagnostics';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    delete process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST;
    await fs.rm(tempWorkspace, { recursive: true, force: true });
  });

  it('fails closed with UNKNOWN_PEER_TOOL even when allowlisted and fleet-safe (no remote executor)', async () => {
    const [{ wirePeerToolBridge, unwirePeerToolBridge, _unwireForTests }, peerRpc, { PolicyEngine }, { getToolRegistry }] =
      await Promise.all([
        import('../../src/fleet/peer-tool-bridge.js'),
        import('../../src/server/websocket/peer-rpc.js'),
        import('../../src/security/policy-engine.js'),
        import('../../src/tools/registry.js'),
      ]);
    vi.spyOn(getToolRegistry(), 'isFleetSafe').mockReturnValue(true);
    vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({ decision: 'allow', reason: 'test' });
    peerRpc._resetPeerRpcForTests();
    wirePeerToolBridge();
    await fs.writeFile(path.join(tempWorkspace, 'a.ts'), 'export const a = 1;\n');

    try {
      for (const tool of ['lsp_definition', 'lsp_references', 'lsp_hover', 'lsp_symbols', 'lsp_diagnostics']) {
        const res = await peerRpc.dispatchPeerRequest(
          { id: `req-${tool}`, method: 'peer.tool.invoke', params: { tool, args: { file: 'a.ts', symbol: 'a' } } },
          { connectionId: 'peer-audit', scopes: ['*'], traceId: 'audit', depth: 0 }
        );
        expect(res.ok).toBe(false);
        expect(res.error?.message).toContain('UNKNOWN_PEER_TOOL');
      }
    } finally {
      unwirePeerToolBridge();
      _unwireForTests();
      peerRpc._resetPeerRpcForTests();
    }
  });
});
