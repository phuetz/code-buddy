/** P8 — `/resources`: read-only catalog view in the CLI, headless and Cowork surfaces. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourceCatalog } from '../../src/fleet/resource-catalog.js';
import { handleResources, RESOURCES_EMPTY_HINT } from '../../src/commands/handlers/resources-handler.js';
import { builtinCommands } from '../../src/commands/slash/builtin-commands.js';
import { coworkHeadlessAllowlist, resolveSlashAvailability } from '../../src/commands/slash/surfaces.js';
import * as core from '../../src/fleet/resource-catalog.js';
import { listCoworkResources } from '../../cowork/src/main/fleet/resource-catalog-view.js';

const ORIGIN = 'http://127.0.0.1:43931/';
const NOW = Date.parse('2026-09-15T12:00:00Z');

function fixtureCatalog(file: string) {
  const fingerprint = createHash('sha256').update(`${ORIGIN}api/health`).digest('hex');
  const old = NOW - 3_600_000;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
    { resource: { id: 'ragchat-local', kind: 'rag', hostId: 'host-alpha', declaredCapabilities: ['pdf-search'], endpointRef: 'RAGCHAT_BASE_URL',
      healthPath: '/api/health', permissions: { probe: true, use: true }, ttlMs: 60000, timeoutMs: 1000 },
    observation: { state: 'online', checkedAt: old, lastSeen: old, latencyMs: 12, endpointFingerprint: fingerprint, reason: 'HTTP_HEALTH_OK_NOT_USAGE_PROOF' } },
    { resource: { id: 'gpu-inference', kind: 'inference', hostId: 'host-beta', declaredCapabilities: ['chat'], endpointRef: 'GPU_INFER_URL',
      healthPath: '/v1/models', permissions: { probe: false, use: true }, ttlMs: 60000, timeoutMs: 1000 }, observation: null },
  ] }), { mode: 0o600 });
  return fingerprint;
}

describe('/resources (P8)', () => {
  let tmp: string;
  let file: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-p8-'));
    file = path.join(tmp, 'home', '.codebuddy', 'resources', 'catalog.json');
    vi.stubEnv('HOME', path.join(tmp, 'home'));
    vi.stubEnv('RAGCHAT_BASE_URL', ORIGIN);
    vi.stubEnv('GPU_INFER_URL', ORIGIN);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists both resources with state and endpoint reference, without URL, fingerprint, probe or write', async () => {
    const fingerprint = fixtureCatalog(file);
    const before = fs.readFileSync(file, 'utf8');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await handleResources(new ResourceCatalog(file, () => NOW), () => NOW);
    const text = result.entry?.content ?? '';
    expect(text).toContain('ragchat-local');
    expect(text).toContain('gpu-inference');
    expect(text).toContain('state: stale (OBSERVATION_EXPIRED), checked 60 min ago');
    expect(text).toContain('state: unknown (NEVER_PROBED), checked never');
    expect(text).toContain('endpoint ref: RAGCHAT_BASE_URL');
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toContain(fingerprint.slice(0, 12));
    expect(fetcher).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('without a catalog, points to `buddy resources add` and creates nothing', async () => {
    const result = await handleResources(new ResourceCatalog(file));
    expect(result.entry?.content).toBe(RESOURCES_EMPTY_HINT);
    expect(result.entry?.content).toContain('buddy resources add');
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  it('a corrupt catalog is reported and left untouched', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'broken');
    const result = await handleResources(new ResourceCatalog(file));
    expect(result.entry?.content).toMatch(/unreadable \(INVALID_CATALOG/);
    expect(fs.readFileSync(file, 'utf8')).toBe('broken');
  });

  it('is a builtin wired to the engine handler and declared headless for Cowork', async () => {
    const command = builtinCommands.find((c) => c.name === 'resources');
    expect(command?.prompt).toBe('__RESOURCES__');
    expect(coworkHeadlessAllowlist().has('__RESOURCES__')).toBe(true);
    expect(resolveSlashAvailability(command!, 'cowork')).toEqual({ status: 'available' });
    const { getEnhancedCommandHandler } = await import('../../src/commands/enhanced-command-handler.js');
    expect(getEnhancedCommandHandler().getRegisteredTokens()).toContain('__RESOURCES__');

    fixtureCatalog(file);
    const { dispatchSlashPrompt } = await import('../../src/commands/headless-slash.js');
    const headless = await dispatchSlashPrompt('/resources');
    expect(headless?.handled).toBe(true);
    expect(headless?.output).toContain('ragchat-local');
    expect(headless?.output).not.toContain('127.0.0.1');
  });

  it('Cowork IPC view returns stale state with no resolved URL and no fingerprint', async () => {
    const fingerprint = fixtureCatalog(file);
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const view = await listCoworkResources(async () => core as never);
      expect(view.status).toBe('ok');
      if (view.status !== 'ok') return;
      expect(view.resources.map((r) => [r.id, r.state])).toEqual([['ragchat-local', 'stale'], ['gpu-inference', 'unknown']]);
      const raw = JSON.stringify(view);
      expect(raw).not.toContain('127.0.0.1');
      expect(raw).not.toContain(fingerprint);
      expect(raw).not.toContain('endpointFingerprint');
    } finally {
      vi.useRealTimers();
    }
    fs.rmSync(file);
    expect(await listCoworkResources(async () => core as never)).toMatchObject({ status: 'empty', hint: expect.stringContaining('buddy resources add') });
    expect(await listCoworkResources(async () => null)).toMatchObject({ status: 'error' });
  });
});
