/**
 * Skill Discovery Tool Tests
 */

import { vi } from 'vitest';
import { SkillDiscoveryTool } from '../../src/tools/skill-discovery-tool.js';

const mockHub = vi.hoisted(() => ({
  search: vi.fn(),
  install: vi.fn(),
}));

const mockRegistry = vi.hoisted(() => ({
  reloadAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/skills/hub.js', () => {
  return {
    getSkillsHub: vi.fn(() => mockHub),
  };
});

vi.mock('../../src/skills/registry.js', () => ({
  getSkillRegistry: vi.fn(() => mockRegistry),
}));

describe('SkillDiscoveryTool', () => {
  let tool: SkillDiscoveryTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHub.search.mockReset();
    mockHub.install.mockReset();
    mockRegistry.reloadAll.mockReset();
    mockRegistry.reloadAll.mockResolvedValue(undefined);
    tool = new SkillDiscoveryTool();
  });

  it('should return error when query is empty', async () => {
    const result = await tool.execute({ query: '' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('query is required');
  });

  it('should return error when query is missing', async () => {
    const result = await tool.execute({ query: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('query is required');
  });

  it('should search for skills and return results', async () => {
    mockHub.search.mockResolvedValue({
      skills: [
        {
          name: 'email-triage',
          version: '1.0.0',
          description: 'Triage email messages',
          tags: ['email', 'productivity'],
          downloads: 150,
          stars: 12,
        },
        {
          name: 'email-compose',
          version: '0.5.0',
          description: 'Compose email messages',
          tags: ['email'],
          downloads: 80,
          stars: 5,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 5,
    });

    const result = await tool.execute({ query: 'email triage' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Found 2 skill(s)');
    expect(result.output).toContain('email-triage');
    expect(result.output).toContain('email-compose');
    expect(mockHub.search).toHaveBeenCalledWith('email triage', { tags: undefined, pageSize: 5 });
  });

  it('should handle no results', async () => {
    mockHub.search.mockResolvedValue({
      skills: [],
      total: 0,
      page: 1,
      pageSize: 5,
    });

    const result = await tool.execute({ query: 'nonexistent' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('No skills found');
  });

  it('should filter by tags', async () => {
    mockHub.search.mockResolvedValue({
      skills: [],
      total: 0,
      page: 1,
      pageSize: 5,
    });

    await tool.execute({ query: 'test', tags: ['automation'] });
    expect(mockHub.search).toHaveBeenCalledWith('test', { tags: ['automation'], pageSize: 5 });
  });

  it('should respect limit parameter', async () => {
    mockHub.search.mockResolvedValue({
      skills: [],
      total: 0,
      page: 1,
      pageSize: 3,
    });

    await tool.execute({ query: 'test', limit: 3 });
    expect(mockHub.search).toHaveBeenCalledWith('test', { tags: undefined, pageSize: 3 });
  });

  it('should auto-install top result when auto_install is true', async () => {
    mockHub.search.mockResolvedValue({
      skills: [
        {
          name: 'deploy-tool',
          version: '2.0.0',
          description: 'Deploy applications',
          tags: ['deploy'],
          downloads: 500,
          stars: 30,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 5,
    });

    mockHub.install.mockResolvedValue({
      name: 'deploy-tool',
      version: '2.0.0',
      installedAt: Date.now(),
      source: 'hub',
      checksum: 'abc123',
      path: '/tmp/skills/deploy-tool/SKILL.md',
    });

    const result = await tool.execute({ query: 'deploy', auto_install: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Auto-installed: deploy-tool v2.0.0');
    expect(result.output).toContain('Tool registry refreshed');
    expect(mockHub.install).toHaveBeenCalledWith('deploy-tool', '2.0.0');
  });

  it('should handle install failure gracefully', async () => {
    mockHub.search.mockResolvedValue({
      skills: [
        {
          name: 'broken-skill',
          version: '1.0.0',
          description: 'Broken',
          tags: [],
          downloads: 0,
          stars: 0,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 5,
    });

    mockHub.install.mockRejectedValue(new Error('Network timeout'));

    const result = await tool.execute({ query: 'broken', auto_install: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Failed to auto-install broken-skill');
    expect(result.output).toContain('Network timeout');
  });

  it('should not auto-install when auto_install is false', async () => {
    mockHub.search.mockResolvedValue({
      skills: [
        {
          name: 'some-skill',
          version: '1.0.0',
          description: 'Some skill',
          tags: [],
          downloads: 10,
          stars: 1,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 5,
    });

    const result = await tool.execute({ query: 'some', auto_install: false });
    expect(result.success).toBe(true);
    expect(mockHub.install).not.toHaveBeenCalled();
  });

  it('should handle search error', async () => {
    mockHub.search.mockRejectedValue(new Error('Hub unavailable'));

    const result = await tool.execute({ query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Skill discovery failed');
    expect(result.error).toContain('Hub unavailable');
  });
});
