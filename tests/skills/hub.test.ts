/**
 * Tests for SkillsHub
 *
 * Tests search, install/uninstall, lockfile management,
 * checksum computation, version comparison, publish, and sync.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SkillsHub,
  resetSkillsHub,
  getSkillsHub,
  computeChecksum,
  compareSemver,
  parseSemver,
} from '../../src/skills/hub';
import type { HubConfig, InstalledSkill, HubSkill } from '../../src/skills/hub';

// ============================================================================
// Mock fetch globally
// ============================================================================

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock the parser module to avoid needing valid full SKILL.md parsing
jest.mock('../../src/skills/parser', () => ({
  parseSkillFile: jest.fn((content: string, sourcePath: string, tier: string) => {
    // Simple extraction from frontmatter
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const yaml = require('yaml');
    const parsed = match ? yaml.parse(match[1]) : {};
    return {
      metadata: {
        name: parsed.name || 'unknown',
        description: parsed.description || '',
        version: parsed.version,
        author: parsed.author,
        tags: parsed.tags || [],
      },
      content: { description: '', rawMarkdown: content },
      sourcePath,
      tier,
      loadedAt: new Date(),
      enabled: true,
    };
  }),
  validateSkill: jest.fn(() => ({ valid: true, errors: [] })),
}));

// ============================================================================
// Test Data
// ============================================================================

const VALID_SKILL_CONTENT = `---
name: test-skill
version: 1.0.0
description: A test skill for unit tests
author: tester
tags:
  - testing
  - automation
---

# Test Skill

This skill does testing things.
`;

const SKILL_V2_CONTENT = `---
name: test-skill
version: 2.0.0
description: A test skill updated
author: tester
tags:
  - testing
  - automation
---

# Test Skill v2

Updated content.
`;

const ANOTHER_SKILL_CONTENT = `---
name: another-skill
version: 0.5.0
description: Another skill for testing
author: dev
tags:
  - utilities
---

# Another Skill

Utility skill.
`;

const PUBLISH_SKILL_CONTENT = `---
name: publish-skill
version: 3.0.0
description: Skill ready to publish
author: publisher
tags:
  - production
---

# Publish Skill

Ready for prime time.
`;

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
  const dir = join(tmpdir(), `hub-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTestConfig(tempDir: string): Partial<HubConfig> {
  return {
    registryUrl: 'https://test-hub.example.com/api/v1',
    cacheDir: join(tempDir, 'cache'),
    skillsDir: join(tempDir, 'skills'),
    lockfilePath: join(tempDir, 'lock.json'),
    autoUpdate: false,
    checkIntervalMs: 60000,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SkillsHub', () => {
  let tempDir: string;
  let hub: SkillsHub;
  let config: Partial<HubConfig>;

  beforeEach(() => {
    tempDir = createTempDir();
    config = createTestConfig(tempDir);
    hub = new SkillsHub(config);
    mockFetch.mockReset();
  });

  afterEach(() => {
    hub.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
    resetSkillsHub();
  });

  // ==========================================================================
  // Checksum Computation
  // ==========================================================================

  describe('computeChecksum', () => {
    it('should compute consistent SHA-256 checksums', () => {
      const content = 'Hello, World!';
      const hash1 = computeChecksum(content);
      const hash2 = computeChecksum(content);
      expect(hash1).toBe(hash2);
    });

    it('should produce different checksums for different content', () => {
      const hash1 = computeChecksum('content A');
      const hash2 = computeChecksum('content B');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce a 64-character hex string', () => {
      const hash = computeChecksum('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should handle empty string', () => {
      const hash = computeChecksum('');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ==========================================================================
  // Version Comparison
  // ==========================================================================

  describe('parseSemver', () => {
    it('should parse valid semver strings', () => {
      expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
      expect(parseSemver('0.0.1')).toEqual([0, 0, 1]);
      expect(parseSemver('10.20.30')).toEqual([10, 20, 30]);
    });

    it('should handle semver with prerelease suffix', () => {
      expect(parseSemver('1.2.3-beta.1')).toEqual([1, 2, 3]);
    });

    it('should return [0,0,0] for invalid input', () => {
      expect(parseSemver('invalid')).toEqual([0, 0, 0]);
      expect(parseSemver('')).toEqual([0, 0, 0]);
      expect(parseSemver('1.2')).toEqual([0, 0, 0]);
    });
  });

  describe('compareSemver', () => {
    it('should return 0 for equal versions', () => {
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
      expect(compareSemver('0.0.0', '0.0.0')).toBe(0);
    });

    it('should return 1 when a > b', () => {
      expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
      expect(compareSemver('1.1.0', '1.0.0')).toBe(1);
      expect(compareSemver('1.0.1', '1.0.0')).toBe(1);
    });

    it('should return -1 when a < b', () => {
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    });

    it('should compare major version first', () => {
      expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    });

    it('should compare minor version second', () => {
      expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    });

    it('should compare patch version last', () => {
      expect(compareSemver('1.0.2', '1.0.1')).toBe(1);
    });
  });

  // ==========================================================================
  // Search
  // ==========================================================================

  describe('search', () => {
    it('should search from local cache when remote fails', async () => {
      // Setup: write a local cache file
      const cacheFile = join(config.cacheDir!, 'registry-cache.json');
      mkdirSync(config.cacheDir!, { recursive: true });

      const cachedSkills: HubSkill[] = [
        {
          name: 'cached-skill',
          version: '1.0.0',
          description: 'A cached skill',
          author: 'cache-author',
          tags: ['test'],
          downloads: 100,
          stars: 50,
          updatedAt: new Date().toISOString(),
          checksum: computeChecksum('cached'),
          size: 100,
        },
      ];
      writeFileSync(cacheFile, JSON.stringify({ skills: cachedSkills }), 'utf-8');

      // Mock fetch to fail
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await hub.search('cached');
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('cached-skill');
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('should filter by tags', async () => {
      const cacheFile = join(config.cacheDir!, 'registry-cache.json');
      mkdirSync(config.cacheDir!, { recursive: true });

      const skills: HubSkill[] = [
        {
          name: 'skill-a',
          version: '1.0.0',
          description: 'Skill A',
          author: 'a',
          tags: ['git', 'workflow'],
          downloads: 50,
          stars: 10,
          updatedAt: new Date().toISOString(),
          checksum: 'abc',
          size: 100,
        },
        {
          name: 'skill-b',
          version: '1.0.0',
          description: 'Skill B',
          author: 'b',
          tags: ['docker', 'devops'],
          downloads: 80,
          stars: 20,
          updatedAt: new Date().toISOString(),
          checksum: 'def',
          size: 200,
        },
      ];
      writeFileSync(cacheFile, JSON.stringify({ skills }), 'utf-8');
      mockFetch.mockRejectedValue(new Error('offline'));

      const result = await hub.search('skill', { tags: ['docker'] });
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('skill-b');
    });

    it('should paginate results', async () => {
      const cacheFile = join(config.cacheDir!, 'registry-cache.json');
      mkdirSync(config.cacheDir!, { recursive: true });

      const skills: HubSkill[] = Array.from({ length: 5 }, (_, i) => ({
        name: `skill-${i}`,
        version: '1.0.0',
        description: `Skill ${i}`,
        author: 'author',
        tags: ['test'],
        downloads: i * 10,
        stars: i,
        updatedAt: new Date().toISOString(),
        checksum: `check-${i}`,
        size: 100,
      }));
      writeFileSync(cacheFile, JSON.stringify({ skills }), 'utf-8');
      mockFetch.mockRejectedValue(new Error('offline'));

      const page1 = await hub.search('skill', { page: 1, pageSize: 2 });
      expect(page1.skills).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(2);

      const page2 = await hub.search('skill', { page: 2, pageSize: 2 });
      expect(page2.skills).toHaveLength(2);
      expect(page2.page).toBe(2);
    });

    it('should return results from remote fetch', async () => {
      const remoteSkills: HubSkill[] = [
        {
          name: 'remote-skill',
          version: '2.0.0',
          description: 'A remote skill',
          author: 'remote-author',
          tags: ['remote'],
          downloads: 200,
          stars: 100,
          updatedAt: new Date().toISOString(),
          checksum: 'remote-check',
          size: 500,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: remoteSkills }),
      });

      const result = await hub.search('remote');
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('remote-skill');
    });

    it('should return empty result for no matches', async () => {
      mockFetch.mockRejectedValue(new Error('offline'));

      const result = await hub.search('nonexistent');
      expect(result.skills).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ==========================================================================
  // Install / Uninstall
  // ==========================================================================

  describe('install', () => {
    it('should install a skill from local content', async () => {
      const installed = await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      expect(installed.name).toBe('test-skill');
      expect(installed.version).toBe('1.0.0');
      expect(installed.source).toBe('local');
      expect(installed.checksum).toBe(computeChecksum(VALID_SKILL_CONTENT));
      expect(installed.path).toContain('test-skill');
      expect(installed.installedAt).toBeGreaterThan(0);

      // Verify file written
      expect(existsSync(installed.path)).toBe(true);
      const content = readFileSync(installed.path, 'utf-8');
      expect(content).toBe(VALID_SKILL_CONTENT);
    });

    it('should update lockfile on install', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      const lockfile = hub.getLockfile();
      expect(lockfile.skills['test-skill']).toBeDefined();
      expect(lockfile.skills['test-skill'].version).toBe('1.0.0');
      expect(lockfile.skills['test-skill'].checksum).toBe(computeChecksum(VALID_SKILL_CONTENT));
    });

    it('should persist lockfile to disk', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      // Read lockfile from disk
      const raw = readFileSync(config.lockfilePath!, 'utf-8');
      const lockfile = JSON.parse(raw);
      expect(lockfile.skills['test-skill']).toBeDefined();
      expect(lockfile.version).toBe(1);
    });

    it('should reject invalid skill names', async () => {
      await expect(
        hub.installFromContent('../traversal', VALID_SKILL_CONTENT)
      ).rejects.toThrow('Invalid skill name');

      await expect(
        hub.installFromContent('path/traversal', VALID_SKILL_CONTENT)
      ).rejects.toThrow('Invalid skill name');
    });

    it('should emit skill:installed event', async () => {
      const handler = jest.fn();
      hub.on('skill:installed', handler);

      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-skill',
          version: '1.0.0',
        })
      );
    });

    it('should overwrite existing skill on reinstall', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);
      const installed2 = await hub.installFromContent('test-skill', SKILL_V2_CONTENT);

      expect(installed2.version).toBe('2.0.0');
      expect(installed2.checksum).toBe(computeChecksum(SKILL_V2_CONTENT));

      const lockfile = hub.getLockfile();
      expect(lockfile.skills['test-skill'].version).toBe('2.0.0');
    });

    it('should install from hub with successful fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => VALID_SKILL_CONTENT,
      });

      const installed = await hub.install('test-skill');
      expect(installed.name).toBe('test-skill');
      expect(installed.version).toBe('1.0.0');
      expect(installed.source).toBe('hub');
    });

    it('should throw when fetch fails and no cache exists', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(hub.install('nonexistent')).rejects.toThrow('Failed to fetch skill');
    });
  });

  describe('uninstall', () => {
    it('should remove installed skill', async () => {
      const installed = await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      const result = await hub.uninstall('test-skill');
      expect(result).toBe(true);

      // Verify removed from disk
      expect(existsSync(installed.path)).toBe(false);

      // Verify removed from lockfile
      const lockfile = hub.getLockfile();
      expect(lockfile.skills['test-skill']).toBeUndefined();
    });

    it('should return false for non-installed skill', async () => {
      const result = await hub.uninstall('nonexistent');
      expect(result).toBe(false);
    });

    it('should emit skill:removed event', async () => {
      const handler = jest.fn();
      hub.on('skill:removed', handler);

      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);
      await hub.uninstall('test-skill');

      expect(handler).toHaveBeenCalledWith('test-skill');
    });

    it('should handle uninstall when skill dir already deleted', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      // Manually remove the directory
      const skillDir = join(config.skillsDir!, 'test-skill');
      rmSync(skillDir, { recursive: true, force: true });

      // Should still succeed (removes from lockfile)
      const result = await hub.uninstall('test-skill');
      expect(result).toBe(true);

      const lockfile = hub.getLockfile();
      expect(lockfile.skills['test-skill']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Lockfile Management
  // ==========================================================================

  describe('lockfile management', () => {
    it('should create empty lockfile on first use', () => {
      const lockfile = hub.getLockfile();
      expect(lockfile.version).toBe(1);
      expect(Object.keys(lockfile.skills)).toHaveLength(0);
    });

    it('should persist across hub instances', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);
      hub.shutdown();

      // Create new hub instance with same config
      const hub2 = new SkillsHub(config);
      const lockfile = hub2.getLockfile();
      expect(lockfile.skills['test-skill']).toBeDefined();
      expect(lockfile.skills['test-skill'].version).toBe('1.0.0');
      hub2.shutdown();
    });

    it('should track multiple installed skills', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);
      await hub.installFromContent('another-skill', ANOTHER_SKILL_CONTENT);

      const lockfile = hub.getLockfile();
      expect(Object.keys(lockfile.skills)).toHaveLength(2);
      expect(lockfile.skills['test-skill']).toBeDefined();
      expect(lockfile.skills['another-skill']).toBeDefined();
    });

    it('should handle corrupted lockfile gracefully', () => {
      // Write invalid JSON to lockfile
      mkdirSync(join(tempDir), { recursive: true });
      writeFileSync(config.lockfilePath!, 'not-json{{{', 'utf-8');

      const hub2 = new SkillsHub(config);
      const lockfile = hub2.getLockfile();
      expect(lockfile.version).toBe(1);
      expect(Object.keys(lockfile.skills)).toHaveLength(0);
      hub2.shutdown();
    });

    it('should update lockfile timestamp on write', async () => {
      const before = new Date().toISOString();
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);
      const after = new Date().toISOString();

      const lockfile = hub.getLockfile();
      expect(lockfile.updatedAt >= before).toBe(true);
      expect(lockfile.updatedAt <= after).toBe(true);
    });
  });

  // ==========================================================================
  // Sync
  // ==========================================================================

  describe('sync', () => {
    it('should remove orphaned lockfile entries', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      // Manually delete the skill file
      const skillDir = join(config.skillsDir!, 'test-skill');
      rmSync(skillDir, { recursive: true, force: true });

      const result = await hub.sync();
      expect(result.removed).toContain('test-skill');
      expect(hub.getLockfile().skills['test-skill']).toBeUndefined();
    });

    it('should detect checksum mismatches', async () => {
      const installed = await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      // Modify the file on disk
      writeFileSync(installed.path, SKILL_V2_CONTENT, 'utf-8');

      const result = await hub.sync();
      expect(result.mismatched).toContain('test-skill');

      // Lockfile should be updated with new checksum
      const lockfile = hub.getLockfile();
      expect(lockfile.skills['test-skill'].checksum).toBe(computeChecksum(SKILL_V2_CONTENT));
    });

    it('should report nothing for clean state', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      const result = await hub.sync();
      expect(result.removed).toHaveLength(0);
      expect(result.mismatched).toHaveLength(0);
      expect(result.updated).toHaveLength(0);
    });
  });

  // ==========================================================================
  // List & Info
  // ==========================================================================

  describe('list', () => {
    it('should return empty list when nothing installed', () => {
      const skills = hub.list();
      expect(skills).toHaveLength(0);
    });

    it('should return all installed skills', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);
      await hub.installFromContent('another-skill', ANOTHER_SKILL_CONTENT);

      const skills = hub.list();
      expect(skills).toHaveLength(2);

      const names = skills.map(s => s.name);
      expect(names).toContain('test-skill');
      expect(names).toContain('another-skill');
    });
  });

  describe('info', () => {
    it('should return null for non-installed skill', () => {
      expect(hub.info('nonexistent')).toBeNull();
    });

    it('should return skill info with integrity check', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      const info = hub.info('test-skill');
      expect(info).not.toBeNull();
      expect(info!.installed.name).toBe('test-skill');
      expect(info!.content).toBe(VALID_SKILL_CONTENT);
      expect(info!.integrityOk).toBe(true);
    });

    it('should detect integrity failure when file modified', async () => {
      const installed = await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      // Modify file on disk
      writeFileSync(installed.path, 'modified content', 'utf-8');

      const info = hub.info('test-skill');
      expect(info).not.toBeNull();
      expect(info!.integrityOk).toBe(false);
    });
  });

  // ==========================================================================
  // Publish
  // ==========================================================================

  describe('publish', () => {
    it('should prepare a skill for publishing from file', async () => {
      // Create a skill file
      const skillDir = join(tempDir, 'publish-test');
      mkdirSync(skillDir, { recursive: true });
      const skillFile = join(skillDir, 'SKILL.md');
      writeFileSync(skillFile, PUBLISH_SKILL_CONTENT, 'utf-8');

      const hubSkill = await hub.publish(skillFile);

      expect(hubSkill.name).toBe('publish-skill');
      expect(hubSkill.version).toBe('3.0.0');
      expect(hubSkill.description).toBe('Skill ready to publish');
      expect(hubSkill.author).toBe('publisher');
      expect(hubSkill.tags).toEqual(['production']);
      expect(hubSkill.checksum).toBe(computeChecksum(PUBLISH_SKILL_CONTENT));
      expect(hubSkill.size).toBe(Buffer.byteLength(PUBLISH_SKILL_CONTENT, 'utf-8'));
      expect(hubSkill.downloads).toBe(0);
      expect(hubSkill.stars).toBe(0);
    });

    it('should publish from directory containing SKILL.md', async () => {
      const skillDir = join(tempDir, 'publish-dir');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), PUBLISH_SKILL_CONTENT, 'utf-8');

      const hubSkill = await hub.publish(skillDir);
      expect(hubSkill.name).toBe('publish-skill');
    });

    it('should emit skill:published event', async () => {
      const handler = jest.fn();
      hub.on('skill:published', handler);

      const skillFile = join(tempDir, 'pub-event.md');
      writeFileSync(skillFile, PUBLISH_SKILL_CONTENT, 'utf-8');

      await hub.publish(skillFile);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'publish-skill' })
      );
    });

    it('should throw for nonexistent path', async () => {
      await expect(hub.publish('/nonexistent/path')).rejects.toThrow(/Skill file not found|No SKILL\.md found/);
    });

    it('should throw for directory without SKILL.md', async () => {
      const emptyDir = join(tempDir, 'empty-dir');
      mkdirSync(emptyDir, { recursive: true });

      await expect(hub.publish(emptyDir)).rejects.toThrow('No SKILL.md found');
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('singleton', () => {
    it('should return the same instance', () => {
      resetSkillsHub();
      const hub1 = getSkillsHub(config);
      const hub2 = getSkillsHub();
      expect(hub1).toBe(hub2);
      resetSkillsHub();
    });

    it('should create a new instance after reset', () => {
      resetSkillsHub();
      const hub1 = getSkillsHub(config);
      resetSkillsHub();
      const hub2 = getSkillsHub(config);
      expect(hub1).not.toBe(hub2);
      resetSkillsHub();
    });
  });

  // ==========================================================================
  // Update
  // ==========================================================================

  describe('update', () => {
    it('should return empty array when no skills installed', async () => {
      const result = await hub.update();
      expect(result).toHaveLength(0);
    });

    it('should skip skills not found on hub', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      // Mock hub info fetch to return null
      mockFetch.mockRejectedValue(new Error('not found'));

      const result = await hub.update('test-skill');
      expect(result).toHaveLength(0);
    });

    it('should skip skills already at latest version', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      // Mock hub to return same version
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'test-skill',
          version: '1.0.0',
          description: 'test',
          author: 'test',
          tags: [],
          downloads: 0,
          stars: 0,
          updatedAt: new Date().toISOString(),
          checksum: 'abc',
          size: 100,
        }),
      });

      const result = await hub.update('test-skill');
      expect(result).toHaveLength(0);
    });

    it('should update skill when newer version available', async () => {
      await hub.installFromContent('test-skill', VALID_SKILL_CONTENT);

      // Mock hub info with newer version
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'test-skill',
          version: '2.0.0',
          description: 'test updated',
          author: 'test',
          tags: [],
          downloads: 0,
          stars: 0,
          updatedAt: new Date().toISOString(),
          checksum: 'abc',
          size: 100,
        }),
      });

      // Mock fetch for download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => SKILL_V2_CONTENT,
      });

      const result = await hub.update('test-skill');
      expect(result).toHaveLength(1);
      expect(result[0].version).toBe('2.0.0');
    });
  });

  // ==========================================================================
  // Config
  // ==========================================================================

  describe('getConfig', () => {
    it('should return hub configuration', () => {
      const hubConfig = hub.getConfig();
      expect(hubConfig.registryUrl).toBe('https://test-hub.example.com/api/v1');
      expect(hubConfig.autoUpdate).toBe(false);
    });

    it('should return a copy (not mutable)', () => {
      const config1 = hub.getConfig();
      const config2 = hub.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });
});
