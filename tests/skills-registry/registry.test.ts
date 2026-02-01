/**
 * Skills Registry Tests
 */

import {
  SkillsRegistry,
  getSkillsRegistry,
  resetSkillsRegistry,
  type SkillSearchResult,
  type InstalledSkill,
} from '../../src/skills-registry/index.js';

describe('Skills Registry', () => {
  let registry: SkillsRegistry;

  beforeEach(() => {
    resetSkillsRegistry();
    registry = new SkillsRegistry();
  });

  afterEach(() => {
    registry.shutdown();
    resetSkillsRegistry();
  });

  describe('Search & Discovery', () => {
    it('should search for skills', async () => {
      const results = await registry.search('git');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name.includes('git'))).toBe(true);
    });

    it('should search by keyword', async () => {
      const results = await registry.search('test');

      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by category', async () => {
      const results = await registry.search('', { category: 'development' });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.category === 'development')).toBe(true);
    });

    it('should filter by verified status', async () => {
      const verified = await registry.search('', { verified: true });
      const unverified = await registry.search('', { verified: false });

      expect(verified.every(r => r.verified === true)).toBe(true);
      expect(unverified.every(r => r.verified === false)).toBe(true);
    });

    it('should support pagination', async () => {
      const page1 = await registry.search('', { limit: 2, offset: 0 });
      const page2 = await registry.search('', { limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });

    it('should cache search results', async () => {
      const results1 = await registry.search('git');
      const results2 = await registry.search('git');

      expect(results1).toEqual(results2);
    });

    it('should emit search-complete event', async () => {
      const events: SkillSearchResult[][] = [];
      registry.on('search-complete', (results) => events.push(results));

      await registry.search('git');

      expect(events.length).toBe(1);
    });
  });

  describe('Skill Details', () => {
    it('should get skill details', async () => {
      const details = await registry.getSkillDetails('@codebuddy/git-workflow');

      expect(details).not.toBeNull();
      expect(details?.name).toBe('@codebuddy/git-workflow');
    });

    it('should return null for unknown skill', async () => {
      const details = await registry.getSkillDetails('@unknown/skill');

      expect(details).toBeNull();
    });

    it('should get skill versions', async () => {
      const versions = await registry.getVersions('@codebuddy/git-workflow');

      expect(versions.length).toBeGreaterThan(0);
      expect(versions[0].version).toBeDefined();
      expect(versions[0].downloadUrl).toBeDefined();
    });

    it('should return empty versions for unknown skill', async () => {
      const versions = await registry.getVersions('@unknown/skill');

      expect(versions.length).toBe(0);
    });
  });

  describe('Featured Skills', () => {
    it('should get featured skills', async () => {
      const featured = await registry.getFeatured();

      expect(featured.length).toBeGreaterThan(0);
      expect(featured.every(s => s.verified)).toBe(true);
    });

    it('should sort by downloads', async () => {
      const featured = await registry.getFeatured();

      for (let i = 1; i < featured.length; i++) {
        expect(featured[i - 1].downloads).toBeGreaterThanOrEqual(featured[i].downloads);
      }
    });
  });

  describe('By Category', () => {
    it('should get skills by category', async () => {
      const skills = await registry.getByCategory('security');

      expect(skills.length).toBeGreaterThan(0);
      expect(skills.every(s => s.category === 'security')).toBe(true);
    });
  });

  describe('Installation', () => {
    it('should install a skill', async () => {
      const installed = await registry.install('@codebuddy/git-workflow');

      expect(installed.manifest.name).toBe('@codebuddy/git-workflow');
      expect(installed.enabled).toBe(true);
      expect(registry.isInstalled('@codebuddy/git-workflow')).toBe(true);
    });

    it('should emit skill-install event', async () => {
      const events: InstalledSkill[] = [];
      registry.on('skill-install', (skill) => events.push(skill));

      await registry.install('@codebuddy/git-workflow');

      expect(events.length).toBe(1);
    });

    it('should not allow duplicate installation', async () => {
      await registry.install('@codebuddy/git-workflow');

      await expect(
        registry.install('@codebuddy/git-workflow')
      ).rejects.toThrow('already installed');
    });

    it('should fail for unknown skill', async () => {
      await expect(
        registry.install('@unknown/skill')
      ).rejects.toThrow('not found');
    });

    it('should block unverified skills when configured', async () => {
      registry.updateConfig({ allowUnverified: false });

      await expect(
        registry.install('@community/slack-notifier')
      ).rejects.toThrow('not verified');
    });

    it('should install specific version', async () => {
      const installed = await registry.install('@codebuddy/git-workflow', '1.0.0');

      expect(installed.manifest.version).toBe('1.0.0');
    });
  });

  describe('Uninstallation', () => {
    it('should uninstall a skill', async () => {
      await registry.install('@codebuddy/git-workflow');
      const result = await registry.uninstall('@codebuddy/git-workflow');

      expect(result).toBe(true);
      expect(registry.isInstalled('@codebuddy/git-workflow')).toBe(false);
    });

    it('should emit skill-uninstall event', async () => {
      const events: string[] = [];
      registry.on('skill-uninstall', (name) => events.push(name));

      await registry.install('@codebuddy/git-workflow');
      await registry.uninstall('@codebuddy/git-workflow');

      expect(events).toContain('@codebuddy/git-workflow');
    });

    it('should return false for uninstalled skill', async () => {
      const result = await registry.uninstall('@codebuddy/git-workflow');

      expect(result).toBe(false);
    });
  });

  describe('Updates', () => {
    it('should update a skill', async () => {
      await registry.install('@codebuddy/git-workflow', '1.0.0');
      const updated = await registry.update('@codebuddy/git-workflow');

      expect(updated).not.toBeNull();
      expect(updated?.manifest.version).not.toBe('1.0.0');
    });

    it('should emit skill-update event', async () => {
      const events: Array<{ skill: InstalledSkill; oldVersion: string }> = [];
      registry.on('skill-update', (skill, oldVersion) => {
        events.push({ skill, oldVersion });
      });

      await registry.install('@codebuddy/git-workflow', '1.0.0');
      await registry.update('@codebuddy/git-workflow');

      expect(events.length).toBe(1);
      expect(events[0].oldVersion).toBe('1.0.0');
    });

    it('should return null for uninstalled skill', async () => {
      const result = await registry.update('@codebuddy/git-workflow');

      expect(result).toBeNull();
    });

    it('should update all skills', async () => {
      await registry.install('@codebuddy/git-workflow', '1.0.0');
      await registry.install('@codebuddy/code-review', '1.0.0');

      const updated = await registry.updateAll();

      expect(updated.length).toBe(2);
    });
  });

  describe('Installed Skills Management', () => {
    beforeEach(async () => {
      await registry.install('@codebuddy/git-workflow');
      await registry.install('@codebuddy/code-review');
    });

    it('should get installed skills', () => {
      const installed = registry.getInstalled();

      expect(installed.length).toBe(2);
    });

    it('should get installed skill by name', () => {
      const skill = registry.getInstalledSkill('@codebuddy/git-workflow');

      expect(skill).toBeDefined();
      expect(skill?.manifest.name).toBe('@codebuddy/git-workflow');
    });

    it('should enable skill', () => {
      registry.disable('@codebuddy/git-workflow');
      const result = registry.enable('@codebuddy/git-workflow');

      expect(result).toBe(true);
      expect(registry.getInstalledSkill('@codebuddy/git-workflow')?.enabled).toBe(true);
    });

    it('should disable skill', () => {
      const result = registry.disable('@codebuddy/git-workflow');

      expect(result).toBe(true);
      expect(registry.getInstalledSkill('@codebuddy/git-workflow')?.enabled).toBe(false);
    });

    it('should emit enable/disable events', () => {
      const events: string[] = [];
      registry.on('skill-enable', (name) => events.push(`enable:${name}`));
      registry.on('skill-disable', (name) => events.push(`disable:${name}`));

      registry.disable('@codebuddy/git-workflow');
      registry.enable('@codebuddy/git-workflow');

      expect(events).toContain('disable:@codebuddy/git-workflow');
      expect(events).toContain('enable:@codebuddy/git-workflow');
    });

    it('should get enabled skills', () => {
      registry.disable('@codebuddy/git-workflow');

      const enabled = registry.getEnabled();

      expect(enabled.length).toBe(1);
      expect(enabled[0].manifest.name).toBe('@codebuddy/code-review');
    });

    it('should configure skill', () => {
      const result = registry.configure('@codebuddy/git-workflow', {
        autoCommit: true,
        branch: 'main',
      });

      expect(result).toBe(true);
      expect(registry.getInstalledSkill('@codebuddy/git-workflow')?.config).toEqual({
        autoCommit: true,
        branch: 'main',
      });
    });
  });

  describe('Update Checking', () => {
    it('should check for updates', async () => {
      await registry.install('@codebuddy/git-workflow', '1.0.0');

      const updates = await registry.checkForUpdates();

      expect(updates.length).toBe(1);
      expect(updates[0].name).toBe('@codebuddy/git-workflow');
      expect(updates[0].current).toBe('1.0.0');
    });

    it('should emit update-available event', async () => {
      const events: Array<{ name: string; current: string; latest: string }> = [];
      registry.on('update-available', (name, current, latest) => {
        events.push({ name, current, latest });
      });

      await registry.install('@codebuddy/git-workflow', '1.0.0');
      await registry.checkForUpdates();

      expect(events.length).toBe(1);
    });

    it('should start auto-update checking', () => {
      registry.startAutoUpdateCheck();

      expect(registry.getStats().isAutoUpdating).toBe(true);

      registry.stopAutoUpdateCheck();
    });

    it('should stop auto-update checking', () => {
      registry.startAutoUpdateCheck();
      registry.stopAutoUpdateCheck();

      expect(registry.getStats().isAutoUpdating).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should get configuration', () => {
      const config = registry.getConfig();

      expect(config.registryUrl).toBeDefined();
      expect(config.installDir).toBeDefined();
    });

    it('should update configuration', () => {
      registry.updateConfig({ allowUnverified: false });

      expect(registry.getConfig().allowUnverified).toBe(false);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', async () => {
      await registry.search('git');

      registry.clearCache();

      expect(registry.getStats().cacheEntries).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should return stats', async () => {
      await registry.install('@codebuddy/git-workflow');
      registry.disable('@codebuddy/git-workflow');
      await registry.search('test');

      const stats = registry.getStats();

      expect(stats.installedCount).toBe(1);
      expect(stats.enabledCount).toBe(0);
      expect(stats.cacheEntries).toBeGreaterThan(0);
    });
  });
});

describe('Singleton', () => {
  beforeEach(() => {
    resetSkillsRegistry();
  });

  afterEach(() => {
    resetSkillsRegistry();
  });

  it('should return same instance', () => {
    const registry1 = getSkillsRegistry();
    const registry2 = getSkillsRegistry();

    expect(registry1).toBe(registry2);
  });

  it('should reset instance', () => {
    const registry1 = getSkillsRegistry();
    resetSkillsRegistry();
    const registry2 = getSkillsRegistry();

    expect(registry1).not.toBe(registry2);
  });
});
