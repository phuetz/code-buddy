import { afterEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn(async (_q: string, repo?: string) => {
  if (!repo) return "Multiple repos indexed (100). Specify 'repo' parameter.";
  return `graph-hit:${repo}`;
});
const listRepos = vi.fn(async () =>
  JSON.stringify([
    { path: '/unrelated/project', id: 'other' },
    { path: process.cwd(), id: 'clone' },
  ]),
);

vi.mock('../../src/plugins/code-explorer/code-explorer-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/plugins/code-explorer/code-explorer-client.js')>();
  return {
    ...actual,
    getCodeExplorerClient: () => ({
      available: async () => true,
      query,
      listRepos,
      call: async () => '',
      impact: async () => '',
      context: async () => '',
    }),
  };
});

describe('GK35 code_explorer_ask repo resolution', () => {
  afterEach(() => {
    query.mockClear();
    listRepos.mockClear();
  });

  it('queries the indexed graph for cwd instead of failing closed on many repos', async () => {
    const { CodeExplorerTool } = await import('../../src/tools/code-explorer-tool.js');
    const tool = new CodeExplorerTool({ endpoint: '' });
    const result = await tool.ask('where is MCPManager');

    expect(listRepos).toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('where is MCPManager', process.cwd());
    expect(result.notes).toBe(`graph-hit:${process.cwd()}`);
    expect(result.notes).not.toMatch(/Multiple repos indexed/);
  });
});
