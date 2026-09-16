import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { ResourceCatalog } from '../../src/fleet/resource-catalog.js';

let directory: string;
let catalog: ResourceCatalog;
let now: number;
const servers: Server[] = [];
const resource = (id = 'a', extra = {}) => ({ id, kind: 'inference', hostId: 'fixture-host',
  declaredCapabilities: ['text-generation'], endpointRef: `RESOURCE_QA_${id.toUpperCase()}`,
  healthPath: '/health', permissions: { probe: true, use: true }, ttlMs: 1000, timeoutMs: 100, ...extra });
async function server(id: string, status = 200, redirect?: string) {
  let requests = 0;
  const instance = createServer((_request, response) => {
    requests++;
    response.writeHead(status, redirect ? { location: redirect } : {});
    response.end('health fixture');
  });
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  servers.push(instance);
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  process.env[`RESOURCE_QA_${id.toUpperCase()}`] = `http://127.0.0.1:${address.port}`;
  return { instance, requests: () => requests };
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-resource-test-'));
  now = 10000;
  catalog = new ResourceCatalog(path.join(directory, 'resources', 'catalog.json'), () => now);
});
afterEach(async () => {
  for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
  for (const key of Object.keys(process.env)) if (key.startsWith('RESOURCE_QA_')) delete process.env[key];
  await fs.rm(directory, { recursive: true, force: true });
});

describe('explicit resource catalog', () => {
  it('selects a fresh resource, then another after the real first endpoint stops', async () => {
    const a = await server('a'); await server('b');
    await catalog.add(resource('a')); await catalog.add(resource('b'));
    expect((await catalog.select('text-generation')).selected).toBeNull();
    await catalog.probe('a'); await catalog.probe('b');
    expect((await catalog.select('text-generation')).selected?.resource.id).toBe('a');
    a.instance.closeAllConnections(); await new Promise<void>(r => a.instance.close(() => r()));
    await catalog.probe('a');
    const next = await catalog.select('text-generation');
    expect(next.selected?.resource.id).toBe('b');
    expect(next.excluded).toContainEqual({ id: 'a', reason: 'UNREACHABLE_OR_TIMEOUT' });
    expect(next.selected?.load).toBeNull();
    expect(next.selected?.usageConfirmed).toBe(false);
  });
  it('does not refresh observation time on reads and expires exactly at TTL', async () => {
    await server('a'); await catalog.add(resource()); await catalog.probe('a');
    now += 999;
    expect((await catalog.list())[0].state).toBe('online');
    now++;
    expect((await catalog.list())[0].state).toBe('stale');
    expect((await catalog.select('text-generation')).selected).toBeNull();
    expect((await catalog.list())[0].observation?.checkedAt).toBe(10000);
  });
  it('invalidates health when an environment endpoint changes', async () => {
    await server('a'); await catalog.add(resource()); await catalog.probe('a');
    process.env.RESOURCE_QA_A = 'http://127.0.0.1:1';
    expect((await catalog.list())[0].reason).toBe('ENDPOINT_CHANGED');
    expect((await catalog.select('text-generation')).selected).toBeNull();
  });
  it('denies probes and usage independently; never captures camera or database contents', async () => {
    const s = await server('a');
    await catalog.add(resource('a', { permissions: { probe: false, use: true } }));
    await expect(catalog.probe('a')).rejects.toThrow('PROBE_NOT_PERMITTED');
    for (const kind of ['camera', 'microphone', 'database', 'storage']) {
      await catalog.add(resource(kind, { kind, endpointRef: 'RESOURCE_QA_A' }));
      await expect(catalog.probe(kind)).rejects.toThrow('NO_READ_ONLY_PROBE');
    }
    await catalog.add(resource('b', { endpointRef: 'RESOURCE_QA_A', permissions: { probe: true, use: false } }));
    await catalog.probe('b');
    expect((await catalog.select('text-generation')).excluded).toContainEqual({ id: 'b', reason: 'USE_NOT_PERMITTED' });
    expect(s.requests()).toBe(1);
  });
  it('does not follow redirects or persist endpoint credentials', async () => {
    const destination = await server('b'); await server('a', 302, process.env.RESOURCE_QA_B);
    await catalog.add(resource());
    expect((await catalog.probe('a')).reason).toBe('HTTP_302');
    expect(destination.requests()).toBe(0);
    process.env.RESOURCE_QA_A = 'http://private-user:private-password@127.0.0.1/';
    await expect(catalog.probe('a')).rejects.toThrow('ENDPOINT_INVALID');
    expect(await fs.readFile(catalog.filename, 'utf8')).not.toMatch(/private-password|127\.0\.0\.1/);
  });
  it('keeps an explicit lock fail-closed and preserves corrupt existing data', async () => {
    await catalog.add(resource());
    await fs.mkdir(`${catalog.filename}.lock`);
    await expect(catalog.add(resource('b'))).rejects.toThrow('CATALOG_BUSY');
    await fs.rmdir(`${catalog.filename}.lock`);
    await fs.writeFile(catalog.filename, '{broken');
    await expect(catalog.add(resource('b'))).rejects.toThrow('INVALID_CATALOG');
    expect(await fs.readFile(catalog.filename, 'utf8')).toBe('{broken');
  });
  it('rejects inline URLs and extra fields, persists private declarations only', async () => {
    await expect(catalog.add({ ...resource(), endpoint: 'http://secret@host/' })).rejects.toThrow('INVALID_RESOURCE');
    await catalog.add(resource());
    await expect(catalog.add(resource())).rejects.toThrow('RESOURCE_EXISTS');
    if (process.platform !== 'win32') {
      expect((await fs.stat(catalog.filename)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.dirname(catalog.filename))).mode & 0o777).toBe(0o700);
    }
  });
  it('rejects a simultaneous writer while a real probe is in progress', async () => {
    let release: (() => void) | undefined;
    let arrived: (() => void) | undefined;
    const started = new Promise<void>(r => { arrived = r; });
    const instance = createServer((_request, response) => {
      release = () => { response.writeHead(200); response.end(); };
      arrived?.();
    });
    servers.push(instance);
    await new Promise<void>(r => instance.listen(0, '127.0.0.1', r));
    const address = instance.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    process.env.RESOURCE_QA_A = `http://127.0.0.1:${address.port}`;
    await catalog.add(resource('a', { timeoutMs: 1000 }));
    const probe = catalog.probe('a');
    await started;
    try { await expect(catalog.add(resource('b'))).rejects.toThrow('CATALOG_BUSY'); }
    finally { release?.(); }
    await probe;
    await catalog.add(resource('b'));
    expect((await catalog.list()).map(e => e.resource.id)).toEqual(['a', 'b']);
  });
  it('removes a declaration and its former observations before re-registration', async () => {
    await server('a'); await catalog.add(resource()); await catalog.probe('a');
    await catalog.remove('a');
    await catalog.add(resource());
    expect((await catalog.list())[0].observation).toBeNull();
  });
  it('rejects malformed capabilities and invalidates future or missing-endpoint observations without I/O', async () => {
    const service = await server('a');
    await catalog.add(resource()); await catalog.probe('a');
    await expect(catalog.select('')).rejects.toThrow('INVALID_CAPABILITY');
    now--;
    expect((await catalog.list())[0].state).toBe('stale');
    delete process.env.RESOURCE_QA_A;
    expect((await catalog.list())[0].state).toBe('unknown');
    expect((await catalog.select('text-generation')).selected).toBeNull();
    expect(service.requests()).toBe(1);
  });
  it('does not wait for a stalled response body after health headers', async () => {
    const instance = createServer((_request, response) => { response.writeHead(200); response.flushHeaders(); });
    servers.push(instance);
    await new Promise<void>(r => instance.listen(0, '127.0.0.1', r));
    const address = instance.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    process.env.RESOURCE_QA_A = `http://127.0.0.1:${address.port}`;
    await catalog.add(resource());
    const start = Date.now();
    expect((await catalog.probe('a')).state).toBe('online');
    expect(Date.now() - start).toBeLessThan(2000);
  });
  it('does not keep an online state when the response stream fails during cancellation', async () => {
    process.env.RESOURCE_QA_A = 'http://127.0.0.1:1';
    await catalog.add(resource());
    const body = new ReadableStream({ start(controller) { controller.error(new Error('stream failed')); } });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body, { status: 200 }));
    try {
      expect((await catalog.probe('a')).state).toBe('offline');
      expect((await catalog.select('text-generation')).selected).toBeNull();
    } finally { fetch.mockRestore(); }
  });
  it('bounds an unresponsive real endpoint by the configured timeout', async () => {
    const instance = createServer(() => undefined); servers.push(instance);
    await new Promise<void>(r => instance.listen(0, '127.0.0.1', r));
    const address = instance.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    process.env.RESOURCE_QA_A = `http://127.0.0.1:${address.port}`;
    await catalog.add(resource());
    const start = Date.now();
    expect((await catalog.probe('a')).state).toBe('offline');
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
