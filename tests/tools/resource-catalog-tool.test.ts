import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ResourceCatalog } from '../../src/fleet/resource-catalog.js';
import { RagChatTool } from '../../src/tools/ragchat-tool.js';
import { ResourceCatalogTool } from '../../src/tools/resource-catalog-tool.js';

let directory: string;
let catalog: ResourceCatalog;
let tool: ResourceCatalogTool;
let now = 10000;
const resource = { id: 'ragchat-fixture', kind: 'rag', hostId: 'qa', declaredCapabilities: ['pdf-search'],
  endpointRef: 'RAGCHAT_BASE_URL', healthPath: '/api/health', permissions: { probe: true, use: true }, ttlMs: 1000 };
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'resource-tool-'));
  now = 10000;
  catalog = new ResourceCatalog(path.join(directory, 'catalog.json'), () => now);
  tool = new ResourceCatalogTool(catalog);
  vi.stubEnv('RAGCHAT_BASE_URL', 'http://127.0.0.1:43921');
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

describe('resource catalog read-only tool', () => {
  it('does not create a catalog or probe when none exists', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const r = JSON.parse((await tool.execute({ operation: 'list' })).output!);
    expect(r).toMatchObject({ resources: [], probed: false, dispatched: false });
    await expect(fs.stat(catalog.filename)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('lists declarations without endpoint values, secrets or fingerprints', async () => {
    await catalog.add(resource);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await catalog.probe(resource.id);
    const before = await fs.readFile(catalog.filename, 'utf8');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const result = await tool.execute({ operation: 'list' });
    expect(result.output).not.toContain('127.0.0.1');
    expect(result.output).not.toContain('endpointFingerprint');
    expect(JSON.parse(result.output!).resources[0]).toMatchObject({ state: 'online', load: null, usageConfirmed: false });
    expect(await fs.readFile(catalog.filename, 'utf8')).toBe(before);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('selects fresh allowed RagChat then excludes stale observations without refreshing them', async () => {
    await catalog.add(resource);
    const fetcher = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetcher);
    await catalog.probe(resource.id);
    expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:43921/api/health');
    const args = { operation: 'select', capability: 'pdf-search', kind: 'rag' };
    expect(JSON.parse((await tool.execute(args)).output!).selected.resource.id).toBe(resource.id);
    now += 1000;
    const result = JSON.parse((await tool.execute(args)).output!);
    expect(result.selected).toBeNull();
    expect(result.excluded).toContainEqual({ id: resource.id, reason: 'OBSERVATION_EXPIRED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves explicit use denial', async () => {
    await catalog.add({ ...resource, permissions: { probe: true, use: false } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}'))); await catalog.probe(resource.id);
    const result = JSON.parse((await tool.execute({ operation: 'select', capability: 'pdf-search' })).output!);
    expect(result.selected).toBeNull();
    expect(result.excluded[0].reason).toBe('USE_NOT_PERMITTED');
  });
  it.each([{ operation: 'probe', id: 'qa' }, { operation: 'list', filename: '/etc/passwd' }, { operation: 'select' }, { operation: 'select', capability: 'x', endpoint: 'https://other' }])('rejects mutation and arbitrary paths %j', async args => {
    expect((await tool.execute(args)).success).toBe(false);
  });
  it('selecting another endpoint reference never reconfigures RagChat transport', async () => {
    vi.stubEnv('OTHER_RAG_URL', 'https://other.example');
    vi.stubEnv('RAGCHAT_ACCESS_TOKEN', 'fixture-token');
    vi.stubEnv('RAGCHAT_PROFILE_ID', 'b76130a5-efed-4e62-a561-6f6cf07ac634');
    await catalog.add({ ...resource, endpointRef: 'OTHER_RAG_URL' });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('[]'));
    vi.stubGlobal('fetch', fetcher);
    await catalog.probe(resource.id);
    const selected = JSON.parse((await tool.execute({ operation: 'select', capability: 'pdf-search' })).output!);
    expect(selected.selected.resource.endpointRef).toBe('OTHER_RAG_URL');
    expect(selected.dispatched).toBe(false);
    expect((await new RagChatTool().execute({ query: 'budget' })).success).toBe(true);
    expect(String(fetcher.mock.calls[1][0])).toContain('http://127.0.0.1:43921/api/search?');
  });
  it('select warns when a rag resource references another endpoint than RAGCHAT_BASE_URL (P8)', async () => {
    vi.stubEnv('OTHER_RAG_URL', 'http://127.0.0.1:43922');
    await catalog.add({ ...resource, id: 'rag-other', endpointRef: 'OTHER_RAG_URL' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await catalog.probe('rag-other');
    const other = JSON.parse((await tool.execute({ operation: 'select', capability: 'pdf-search', kind: 'rag' })).output!);
    expect(other.selected.resource.id).toBe('rag-other');
    expect(other.warning).toContain('RAGCHAT_BASE_URL');
    expect(other.warning).toContain('OTHER_RAG_URL');
    expect(other.warning).not.toContain('127.0.0.1');

    await catalog.remove('rag-other');
    await catalog.add(resource);
    await catalog.probe(resource.id);
    const same = JSON.parse((await tool.execute({ operation: 'select', capability: 'pdf-search', kind: 'rag' })).output!);
    expect(same.selected.resource.id).toBe(resource.id);
    expect(same).not.toHaveProperty('warning');
  });
  it('fails closed on corrupt catalog without replacing it', async () => {
    await fs.writeFile(catalog.filename, 'broken');
    expect((await tool.execute({ operation: 'list' })).success).toBe(false);
    expect(await fs.readFile(catalog.filename, 'utf8')).toBe('broken');
  });
});
