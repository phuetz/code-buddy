import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchConnectorContent,
  type ConnectorMcpClient,
} from '../../src/research/connector-source.js';

function stubClient(
  toolNames: string[],
  callTool: ConnectorMcpClient['callTool'],
): ConnectorMcpClient {
  return {
    getTools: () => toolNames.map((name) => ({
      name,
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    })),
    callTool,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('connector-source — personal MCP connector content → CKG discoveries', () => {
  it('maps connector search results to publications', async () => {
    vi.stubEnv('NOTION_API_KEY', 'test-token');
    const callTool = vi.fn(async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: 'response-1',
          results: [
            {
              id: 'page-1',
              title: 'Roadmap',
              content: 'Q3 priorities and milestones.',
              url: 'https://notion.so/page-1',
            },
            {
              id: 'page-2',
              title: 'Architecture',
              content: 'Service boundaries and ownership.',
            },
          ],
        }),
      }],
    }));
    const client = stubClient(['mcp__notion__search'], callTool);

    const publications = await fetchConnectorContent('notion', { query: 'roadmap', client });

    expect(publications).toHaveLength(2);
    expect(publications[0]).toMatchObject({
      id: 'notion:search:page-1',
      title: 'Roadmap',
      abstract: 'Q3 priorities and milestones.',
      source: 'notion',
      url: 'https://notion.so/page-1',
    });
    expect(callTool).toHaveBeenCalledWith('mcp__notion__search', { query: 'roadmap' });
  });

  it('returns [] when the connector is not configured', async () => {
    vi.stubEnv('NOTION_API_KEY', '');
    const callTool = vi.fn(async () => ({ content: [] }));
    const client = stubClient(['mcp__notion__search'], callTool);

    await expect(fetchConnectorContent('notion', { query: 'x', client })).resolves.toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('returns [] when the connector call fails', async () => {
    vi.stubEnv('NOTION_API_KEY', 'test-token');
    const client = stubClient(
      ['mcp__notion__search'],
      vi.fn(async () => {
        throw new Error('connector unavailable');
      }),
    );

    await expect(fetchConnectorContent('notion', { query: 'x', client })).resolves.toEqual([]);
  });

  it('never invokes a mutating connector tool', async () => {
    vi.stubEnv('NOTION_API_KEY', 'test-token');
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: '[{"id":"page-1","title":"Safe","content":"Read only"}]' }],
    }));
    const client = stubClient(
      ['mcp__notion__update_page', 'mcp__notion__search_and_upsert', 'mcp__notion__notion_search'],
      callTool,
    );

    await fetchConnectorContent('notion', { query: 'safe', client });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('mcp__notion__notion_search', { query: 'safe' });
  });
});
