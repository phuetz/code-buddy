/**
 * Consolidation P2 — the doctor's read-only MCP inventory must describe what the runtime loads.
 * Runtime contract (src/mcp/config.ts loadMCPConfig):
 * - .codebuddy/mcp.json and ~/.codebuddy/mcp.json: `mcpServers`, or `servers` as an alias;
 * - .codebuddy/settings.json: `mcpServers` only (settings manager / explicit-cwd reader).
 * Diagnostics must never count servers the runtime ignores, never write in the inspected project,
 * and never print secret values.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runIntegrationChecks } from '../../src/doctor/integrations.js';
import { loadMCPConfig, loadMCPConfigReadOnly } from '../../src/mcp/config.js';

const SECRET = 'sk-test-P2settingsSECRETabcdefghijklmnopq012';

function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      out.push(`${path.relative(dir, full)}${entry.isDirectory() ? '/' : `:${fs.readFileSync(full, 'utf8').length}`}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

describe('doctor MCP inventory matches the runtime contract for settings forms (P2)', () => {
  let root: string;
  let project: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-p2-forms-'));
    vi.stubEnv('HOME', path.join(root, 'home'));
    fs.mkdirSync(path.join(root, 'home'), { recursive: true });
    project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, '.codebuddy'), { recursive: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const write = (file: string, value: unknown) => fs.writeFileSync(path.join(project, '.codebuddy', file), typeof value === 'string' ? value : JSON.stringify(value));
  const runtimeNames = () => loadMCPConfig({ cwd: project, includeDisabled: true }).servers.map((s) => s.name).sort();
  const diagnosticNames = () => loadMCPConfigReadOnly({ cwd: project, includeDisabled: true }).servers.map((s) => s.name).sort();
  const server = { command: 'node', env: { API_TOKEN: SECRET } };

  it.each([
    ['settings mcpServers', { 'settings.json': { mcpServers: { a: server } } }, ['a']],
    ['settings servers only (not read at runtime)', { 'settings.json': { servers: { b: server } } }, []],
    ['settings mcpServers + servers', { 'settings.json': { mcpServers: { a: server }, servers: { b: server } } }, ['a']],
    ['project mcp.json servers alias', { 'mcp.json': { servers: { c: server } } }, ['c']],
    ['project mcp.json mcpServers + settings servers', { 'mcp.json': { mcpServers: { c: server } }, 'settings.json': { servers: { b: server } } }, ['c']],
  ])('%s: diagnostic inventory equals runtime inventory', (_label, files, expected) => {
    for (const [file, value] of Object.entries(files)) write(file, value);
    expect(runtimeNames()).toEqual(expected);
    expect(diagnosticNames()).toEqual(runtimeNames());
  });

  it('settings `servers` is reported as ignored at runtime, not counted, not a crash', async () => {
    write('settings.json', { servers: { b: server } });
    const checks = await runIntegrationChecks(project, { noSubprocess: true });
    const mcp = checks.find((c) => c.id === 'mcp');
    expect(mcp?.status).toBe('warn');
    expect(mcp?.message).toContain('no MCP server configured');
    expect(mcp?.message).toMatch(/settings\.json .*servers.* not read at runtime; use mcpServers/);
    expect(JSON.stringify(checks)).not.toContain(SECRET);
  });

  it('a valid settings mcpServers inventory is ok and counted once', async () => {
    write('settings.json', { mcpServers: { a: server } });
    const mcp = (await runIntegrationChecks(project, { noSubprocess: true })).find((c) => c.id === 'mcp');
    expect(mcp).toMatchObject({ status: 'ok' });
    expect(mcp?.message).toMatch(/^1 configured \(0 disabled\)/);
  });

  it.each([
    ['settings mcpServers array', { 'settings.json': { mcpServers: [server] } }],
    ['settings servers array (still ignored, still reported)', { 'settings.json': { servers: [server] } }],
    ['corrupt settings', { 'settings.json': '{ "mcpServers": ' }],
  ])('%s: warns without inventing servers', async (_label, files) => {
    for (const [file, value] of Object.entries(files)) write(file, value);
    const mcp = (await runIntegrationChecks(project, { noSubprocess: true })).find((c) => c.id === 'mcp');
    expect(mcp?.status).toBe('warn');
    expect(loadMCPConfigReadOnly({ cwd: project, includeDisabled: true }).servers).toEqual([]);
  });

  it('diagnostics never create .bak, .tmp or .codebuddy in the inspected project', async () => {
    write('settings.json', '{ broken');
    fs.writeFileSync(path.join(project, '.codebuddy', 'settings.json.bak'), JSON.stringify({ mcpServers: { recovered: server } }));
    const bare = path.join(root, 'bare-project');
    fs.mkdirSync(bare);
    const before = tree(project);
    await runIntegrationChecks(project, { noSubprocess: true });
    await runIntegrationChecks(bare, { noSubprocess: true });
    expect(tree(project)).toEqual(before);
    expect(tree(bare)).toEqual([]);
  });
});
