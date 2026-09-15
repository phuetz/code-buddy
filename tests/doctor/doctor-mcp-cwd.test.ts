/**
 * Lot 3 (Grok review) — doctor mcpCheck must not mutate process.cwd().
 * loadMCPConfig({ cwd }) reads the project sources of that directory explicitly;
 * without `cwd` it keeps the historical behaviour (process.cwd()).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runIntegrationChecks } from '../../src/doctor/integrations.js';
import { loadMCPConfig } from '../../src/mcp/config.js';

const SECRET = 'sk-test-DOCTORmcpSECRETabcdefghijklmnop0123';

function project(root: string, name: string, extra: Record<string, unknown> = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, '.codebuddy'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.codebuddy', 'mcp.json'), JSON.stringify({
    mcpServers: {
      [`${name}-stdio`]: { command: 'node', args: ['server.js'], env: { API_TOKEN: SECRET } },
      [`${name}-off`]: { command: 'node', enabled: false },
      ...extra,
    },
  }));
  fs.writeFileSync(path.join(dir, '.codebuddy', 'settings.json'), JSON.stringify({
    mcpServers: { [`${name}-from-settings`]: { transport: { type: 'http', url: 'http://127.0.0.1:1/mcp' } } },
  }));
  return dir;
}

describe('doctor MCP check without process.chdir (lot 3)', () => {
  let root: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-mcp-cwd-'));
    vi.stubEnv('HOME', path.join(root, 'home'));
    vi.stubEnv('USERPROFILE', path.join(root, 'home'));
    fs.mkdirSync(path.join(root, 'home'), { recursive: true });
    fs.mkdirSync(path.join(root, 'elsewhere'), { recursive: true });
    process.chdir(path.join(root, 'elsewhere'));
  });
  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('loadMCPConfig({ cwd }) reads that project like a process started in it', () => {
    const dir = project(root, 'alpha');
    const explicit = loadMCPConfig({ cwd: dir, includeDisabled: true }).servers.map((s) => s.name).sort();
    expect(explicit).toEqual(['alpha-from-settings', 'alpha-off', 'alpha-stdio']);
    expect(loadMCPConfig({ cwd: dir }).servers.map((s) => s.name).sort()).toEqual(['alpha-from-settings', 'alpha-stdio']);
    // Default (no cwd) is unchanged: it reads process.cwd(), which has no project config here.
    expect(loadMCPConfig({ includeDisabled: true }).servers.map((s) => s.name)).not.toContain('alpha-stdio');
    process.chdir(dir);
    expect(loadMCPConfig({ includeDisabled: true }).servers.map((s) => s.name)).toContain('alpha-stdio');
  });

  it('doctor inspects another directory while process.cwd() never changes, even across awaits', async () => {
    const dir = project(root, 'beta');
    const before = process.cwd();
    const seen = new Set<string>();
    let polling = true;
    // Interleave at microtask granularity (an awaited cached import resolves there) and at macrotask level.
    const poll = (async () => {
      for (let i = 0; polling && i < 200_000; i++) {
        seen.add(process.cwd());
        if (i % 1000 === 999) await new Promise((r) => setImmediate(r));
        else await null;
      }
    })();
    const checks = await runIntegrationChecks(dir);
    polling = false;
    await poll;
    expect([...seen]).toEqual([before]);
    expect(process.cwd()).toBe(before);
    const mcp = checks.find((c) => c.id === 'mcp');
    expect(mcp?.message).toMatch(/^3 configured \(1 disabled\)/);
    expect(JSON.stringify(checks)).not.toContain(SECRET);
  });

  it('concurrent doctors on two projects each see their own servers', async () => {
    const a = project(root, 'gamma', { 'gamma-bad': { transport: { type: 'carrier-pigeon' } } });
    const b = project(root, 'delta');
    const before = process.cwd();
    const [ca, cb] = await Promise.all([runIntegrationChecks(a), runIntegrationChecks(b)]);
    expect(ca.find((c) => c.id === 'mcp')?.status).toBe('warn');
    expect(cb.find((c) => c.id === 'mcp')?.status).toBe('ok');
    expect(process.cwd()).toBe(before);
  });

  it('a broken project config is reported without moving process.cwd()', async () => {
    const dir = path.join(root, 'broken');
    fs.mkdirSync(path.join(dir, '.codebuddy', 'mcp.json'), { recursive: true }); // a directory: read fails
    const before = process.cwd();
    const checks = await runIntegrationChecks(dir);
    expect(process.cwd()).toBe(before);
    expect(checks.find((c) => c.id === 'mcp')).toBeDefined();
  });
});
