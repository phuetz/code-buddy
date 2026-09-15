import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RagChatTool } from '../../src/tools/ragchat-tool.js';

const profile = 'b76130a5-efed-4e62-a561-6f6cf07ac634';
const hit = { documentId: profile, fileName: 'facts.pdf', pageNumber: 2, excerpt: 'Budget 42750 euros', matchedTerms: 1 };
const tool = new RagChatTool();

beforeEach(() => {
  vi.stubEnv('RAGCHAT_BASE_URL', 'http://127.0.0.1:43921');
  vi.stubEnv('RAGCHAT_ACCESS_TOKEN', 'fixture-private-token');
  vi.stubEnv('RAGCHAT_PROFILE_ID', profile);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('RagChat authenticated read-only adapter', () => {
  it('preserves backend page citations and scopes lexical query to the profile', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([hit])));
    vi.stubGlobal('fetch', fetcher);
    const result = await tool.execute({ query: 'budget & coût', limit: 3 });
    expect(result.success).toBe(true);
    const output = JSON.parse(result.output!);
    expect(output.hits[0].citation).toBe('facts.pdf, p. 2');
    expect(output.generatedAnswer).toBe(false);
    const [url, options] = fetcher.mock.calls[0];
    expect(url.searchParams.get('profileId')).toBe(profile);
    expect(url.searchParams.get('q')).toBe('budget & coût');
    expect(options).toMatchObject({ method: 'GET', redirect: 'manual', headers: { Authorization: 'Bearer fixture-private-token' } });
  });
  it('lists only backend-authorized profiles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: profile, name: 'RH', description: 'Documents' }]))));
    expect((await tool.execute({ operation: 'profiles' })).success).toBe(true);
  });
  it('reports empty retrieval without inventing a citation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]')));
    expect(JSON.parse((await tool.execute({ query: 'absent' })).output!).hits).toEqual([]);
  });
  it.each([301, 401, 403, 500])('does not expose error bodies or follow HTTP %s', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret upstream body', { status, headers: { Location: 'https://other.example/' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await tool.execute({ query: 'budget' });
    expect(result.success).toBe(false);
    expect(result.error).toContain(String(status));
    expect(JSON.stringify(result)).not.toMatch(/secret upstream|fixture-private-token|other.example/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ query: 'x', url: 'http://other' }, { query: 'x', limit: 100 }, { query: 'x', profile_id: '../../other' }, { operation: 'upload' }])('rejects unexpected or privileged arguments %j', async args => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await tool.execute(args)).success).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails closed before network when configuration is missing', async () => {
    vi.stubEnv('RAGCHAT_ACCESS_TOKEN', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await tool.execute({ query: 'x' })).success).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['http://user:password@localhost', 'http://localhost/path', 'file:///etc/passwd', 'http://remote.example'])('rejects unsafe configured origin %s', async origin => {
    vi.stubEnv('RAGCHAT_BASE_URL', origin); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await tool.execute({ query: 'x' })).success).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects invalid page numbers instead of manufacturing citations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ ...hit, pageNumber: 0 }]))));
    expect((await tool.execute({ query: 'x' })).success).toBe(false);
  });
  it('bounds response size and never prints fetch exceptions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1))));
    expect((await tool.execute({ query: 'x' })).success).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture-private-token')));
    expect(JSON.stringify(await tool.execute({ query: 'x' }))).not.toContain('fixture-private-token');
  });
});
