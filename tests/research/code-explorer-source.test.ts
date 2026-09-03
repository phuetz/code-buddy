import { describe, it, expect } from 'vitest';
import { fetchCodeExplorerInsights } from '../../src/research/code-explorer-source.js';
import type { CodeExplorerClient } from '../../src/plugins/code-explorer/code-explorer-client.js';

function stubClient(available: boolean, responses: Record<string, string>): CodeExplorerClient {
  return {
    available: async () => available,
    call: async (op: string) => responses[op] ?? '',
    query: async () => '',
    impact: async () => '',
    context: async () => '',
    listRepos: async () => '',
  };
}

describe('code-explorer-source — Code Explorer insights → CKG discoveries', () => {
  it('maps each non-empty insight op to a discovery (skips empty)', async () => {
    const client = stubClient(true, {
      hotspots: 'foo.ts is a risky hotspot (churn × complexity).',
      find_cycles: 'Cycle: A → B → A',
      get_insights: '', // empty → skipped
    });
    const pubs = await fetchCodeExplorerInsights({ client, ops: ['hotspots', 'find_cycles', 'get_insights'] });
    expect(pubs).toHaveLength(2);
    expect(pubs.every((p) => p.source === 'code-explorer')).toBe(true);
    expect(pubs.map((p) => p.id)).toEqual(['codeexplorer:hotspots', 'codeexplorer:find_cycles']);
    expect(pubs[0]!.abstract).toContain('risky hotspot');
  });

  it('encodes the repo in the id/title when given', async () => {
    const client = stubClient(true, { hotspots: 'x' });
    const pubs = await fetchCodeExplorerInsights({ client, ops: ['hotspots'], repo: '/r/code-buddy' });
    expect(pubs[0]!.id).toBe('codeexplorer:hotspots:/r/code-buddy');
    expect(pubs[0]!.title).toContain('/r/code-buddy');
  });

  it('returns [] when Code Explorer is not connected', async () => {
    const pubs = await fetchCodeExplorerInsights({ client: stubClient(false, { hotspots: 'x' }) });
    expect(pubs).toEqual([]);
  });

  it('falls back to list_repos when default insight ops are empty', async () => {
    const client = stubClient(true, {});
    client.listRepos = async () => JSON.stringify([{ path: '/tmp/toy', id: 'toy' }]);
    const pubs = await fetchCodeExplorerInsights({ client });
    expect(pubs).toHaveLength(1);
    expect(pubs[0]!.id).toBe('codeexplorer:list_repos:/tmp/toy');
    expect(pubs[0]!.abstract).toContain('/tmp/toy');
  });
});
