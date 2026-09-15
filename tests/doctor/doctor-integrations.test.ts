/**
 * P3 — `buddy doctor --json --offline` + Integrations section, with REAL modules.
 * Network primitives are spied: offline mode must not touch any of them.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDoctorChecks, summarizeDoctorChecks } from '../../src/doctor/index.js';
import { buildDoctorJsonReport, doctorJsonReportSchema, runIntegrationChecks } from '../../src/doctor/integrations.js';
import { ResourceCatalog } from '../../src/fleet/resource-catalog.js';

const ENV_KEYS = ['HOME', 'USERPROFILE', 'CODEBUDDY_LM_RESIZER', 'CODEBUDDY_LM_RESIZER_BIN', 'OPENAI_API_KEY', 'RECETTE_ENDPOINT'];

describe('doctor --offline and integrations (P3)', () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-p3-'));
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.HOME = path.join(tmp, 'home');
    process.env.USERPROFILE = process.env.HOME;
    fs.mkdirSync(process.env.HOME, { recursive: true });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function spyNetwork() {
    // Builtin ESM namespaces are frozen; the CommonJS objects are the ones undici/http use.
    const cjs = createRequire(import.meta.url);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden in test'));
    const httpSpy = vi.spyOn(cjs('node:http') as typeof http, 'request');
    const httpsSpy = vi.spyOn(cjs('node:https') as typeof https, 'request');
    const netSpy = vi.spyOn(cjs('node:net') as typeof net, 'connect');
    const netCreateSpy = vi.spyOn(cjs('node:net') as typeof net, 'createConnection');
    return () => fetchSpy.mock.calls.length + httpSpy.mock.calls.length + httpsSpy.mock.calls.length
      + netSpy.mock.calls.length + netCreateSpy.mock.calls.length;
  }

  it('offline core + integrations make zero network calls and yield a schema-valid report', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-offline-fixture';
    const calls = spyNetwork();
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const checks = [...await runDoctorChecks(repo, { offline: true }), ...await runIntegrationChecks(repo)];
    expect(calls()).toBe(0);
    const report = buildDoctorJsonReport(checks, summarizeDoctorChecks(checks), { offline: true });
    expect(doctorJsonReportSchema.parse(report).checks.filter((c) => c.section === 'integrations').map((c) => c.id))
      .toEqual(['lm-resizer', 'code-explorer', 'mcp', 'resources', 'skills', 'code-exec-policy']);
    expect(JSON.stringify(report)).not.toContain('sk-test-offline-fixture');
  });

  it('the spy is effective: without --offline the live key check calls fetch', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-online-fixture';
    const calls = spyNetwork();
    await runDoctorChecks(path.join(tmp), { offline: false });
    expect(calls()).toBeGreaterThan(0);
  });

  it('warns when LM Resizer is enabled but the binary lacks the tool-output protocol', async () => {
    const fake = path.join(tmp, 'lm-resizer');
    fs.writeFileSync(fake, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "lm-resizer 0.1.0"; exit 0; fi\nif [ "$1" = "tool-output" ]; then echo "unknown command" >&2; exit 2; fi\necho "usage: lm-resizer exec|compress"\n', { mode: 0o755 });
    process.env.CODEBUDDY_LM_RESIZER = 'true';
    process.env.CODEBUDDY_LM_RESIZER_BIN = fake;
    const [lm] = await runIntegrationChecks(tmp, {
      codeExplorerFreshness: async () => ({ indexed: false, stale: false }),
      mcpServers: async () => [],
      resources: async () => [],
      skillsIntegrity: async () => [],
    });
    expect(lm).toMatchObject({ id: 'lm-resizer', status: 'warn' });
    expect(lm!.message).toContain('tool-output');
  });

  it('reports a stale Code Explorer index after a new commit (real git repo)', async () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one');
    const indexed = git('rev-parse', 'HEAD');
    fs.mkdirSync(path.join(repo, '.gitnexus'));
    fs.writeFileSync(path.join(repo, '.gitnexus', 'meta.json'), JSON.stringify({ lastCommit: indexed, indexedAt: '2026-09-15T00:00:00Z', stats: { nodes: 1, edges: 0, communities: 0, processes: 0 } }));
    const fresh = (await runIntegrationChecks(repo)).find((c) => c.id === 'code-explorer');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'two');
    const stale = (await runIntegrationChecks(repo)).find((c) => c.id === 'code-explorer');
    expect(fresh?.status).toBe('ok');
    expect(stale).toMatchObject({ status: 'warn' });
    expect(stale!.message).toContain('1 commit(s) behind HEAD');
  });

  it('flags an expired resource observation without probing (loopback control server gets 0 requests)', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => { hits++; res.end('ok'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    process.env.RECETTE_ENDPOINT = `http://127.0.0.1:${port}/`;
    try {
      const file = path.join(tmp, 'catalog.json');
      let now = 1_000_000;
      const catalog = new ResourceCatalog(file, () => now);
      await catalog.add({ id: 'rag-local', kind: 'rag', hostId: 'host', declaredCapabilities: ['pdf-search'], endpointRef: 'RECETTE_ENDPOINT', healthPath: '/api/health', permissions: { probe: true, use: true }, ttlMs: 1000 });
      await catalog.probe('rag-local');
      expect(hits).toBe(1);
      now += 5000; // observation now older than its TTL
      const [check] = await runIntegrationChecks(tmp, {
        lmResizer: async () => ({ enabled: false, available: false, toolOutputSupported: false, binary: 'x', version: 'x', warning: '' }),
      }).then((all) => all.filter((c) => c.id === 'resources'));
      // Default dep reads ~/.codebuddy/resources/catalog.json: point it at the fixture instead.
      const [fixtureCheck] = (await runIntegrationChecks(tmp, { resources: () => catalog.list() })).filter((c) => c.id === 'resources');
      expect(check?.status).toBe('ok'); // empty default catalog in the isolated HOME
      expect(fixtureCheck).toMatchObject({ status: 'warn' });
      expect(fixtureCheck!.message).toContain('rag-local=stale');
      expect(hits).toBe(1); // doctor never probed
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('flags MCP entries that have neither a known transport nor a command, without starting servers', async () => {
    const [mcp] = (await runIntegrationChecks(tmp, {
      mcpServers: async () => [
        { name: 'fs', command: 'npx' },
        { name: 'remote', transport: { type: 'streamable_http' } },
        { name: 'imported-url' },
        { name: 'off', enabled: false },
      ],
    })).filter((c) => c.id === 'mcp');
    expect(mcp).toMatchObject({ status: 'warn' });
    expect(mcp!.message).toContain('unusable transport configuration: imported-url');
    expect(mcp!.message).toContain('4 configured (1 disabled)');
  });
});
