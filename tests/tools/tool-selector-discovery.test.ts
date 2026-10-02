import { describe, expect, it } from 'vitest';
import { getRelevantTools } from '../../src/codebuddy/tools.js';
import { ToolSelector } from '../../src/tools/tool-selector.js';
import type { CodeBuddyTool } from '../../src/codebuddy/client.js';

const tool = (name: string, description: string): CodeBuddyTool => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties: {} } },
});

describe('default tool discovery', () => {
  it('preserves discovery through the public getRelevantTools entry point', async () => {
    const result = await getRelevantTools('Read package.json and search for the version string', { maxTools: 12 });
    expect(result.selectedTools.map(t => t.function.name)).toEqual(expect.arrayContaining(['view_file', 'bash', 'tool_search']));
    expect(result.selectedTools.length).toBeLessThanOrEqual(12);
  });

  it('keeps tool_search available when relevance scores would discard it', () => {
    const result = new ToolSelector().selectTools('Read package.json and search for the version string', [
      tool('view_file', 'Read package.json'), tool('bash', 'Run commands'),
      tool('search', 'Search for version string'), tool('tool_search', 'Discover capabilities'),
    ], { maxTools: 3, minScore: 0.95 });
    expect(result.selectedTools.map(t => t.function.name)).toContain('tool_search');
  });
  it('treats an explicit alwaysInclude as mandatory tools, not an exclusion list', () => {
    const result = new ToolSelector().selectTools('search tools', [
      tool('view_file', 'Read files'), tool('tool_search', 'Search tools'),
    ], { alwaysInclude: ['view_file'], minScore: 0 });
    expect(result.selectedTools.map(t => t.function.name)).toContain('tool_search');
  });

  it('never invents an unavailable discovery tool', () => {
    const selector = new ToolSelector();
    const tools = [tool('view_file', 'Read files')];
    expect(selector.selectTools('Read file', tools).selectedTools.map(t => t.function.name)).toEqual(['view_file']);
  });
});
