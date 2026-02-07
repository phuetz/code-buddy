import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillRegistry } from '../../src/skills/skill-registry.js';

const SKILL_CONTENT = `---
name: test-skill
version: 1.2.0
description: A test skill
author: tester
tags: git, automation
env:
  MY_VAR: hello
  OTHER: world
---

# Test Skill

This skill does testing things.
`;

const MINIMAL_CONTENT = `---
name: minimal
---

Minimal skill.
`;

const BUNDLED_CONTENT = `---
name: bundled-skill
version: 2.0.0
description: A bundled skill
tags: core
---

Bundled.
`;

describe('SkillRegistry', () => {
  let tempDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skill-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    // Create skill directories
    const bundledDir = join(tempDir, '.codebuddy', 'skills', 'bundled');
    const managedDir = join(tempDir, '.codebuddy', 'skills', 'managed');
    const workspaceDir = join(tempDir, '.codebuddy', 'skills', 'workspace');
    mkdirSync(bundledDir, { recursive: true });
    mkdirSync(managedDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });

    registry = new SkillRegistry(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ---- parseFrontmatter ----

  describe('parseFrontmatter', () => {
    it('should extract name, version, description, tags', () => {
      const fm = SkillRegistry.parseFrontmatter(SKILL_CONTENT);
      expect(fm.name).toBe('test-skill');
      expect(fm.version).toBe('1.2.0');
      expect(fm.description).toBe('A test skill');
      expect(fm.author).toBe('tester');
      expect(fm.tags).toEqual(['git', 'automation']);
    });

    it('should handle missing fields', () => {
      const fm = SkillRegistry.parseFrontmatter(MINIMAL_CONTENT);
      expect(fm.name).toBe('minimal');
      expect(fm.version).toBeUndefined();
      expect(fm.description).toBeUndefined();
      expect(fm.tags).toBeUndefined();
      expect(fm.env).toBeUndefined();
    });

    it('should parse env overrides', () => {
      const fm = SkillRegistry.parseFrontmatter(SKILL_CONTENT);
      expect(fm.env).toEqual({ MY_VAR: 'hello', OTHER: 'world' });
    });

    it('should return empty name when no frontmatter', () => {
      const fm = SkillRegistry.parseFrontmatter('No frontmatter here.');
      expect(fm.name).toBe('');
    });
  });

  // ---- install ----

  describe('install', () => {
    it('should create SKILL.md in managed dir', () => {
      const meta = registry.install('test-skill', SKILL_CONTENT);
      expect(meta.name).toBe('test-skill');
      expect(meta.source).toBe('managed');
      expect(meta.version).toBe('1.2.0');
      expect(meta.installedAt).toBeDefined();

      const filePath = join(tempDir, '.codebuddy', 'skills', 'managed', 'test-skill', 'SKILL.md');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  // ---- uninstall ----

  describe('uninstall', () => {
    it('should remove managed skill', () => {
      registry.install('test-skill', SKILL_CONTENT);
      expect(registry.get('test-skill')).toBeDefined();

      const result = registry.uninstall('test-skill');
      expect(result).toBe(true);
      expect(registry.get('test-skill')).toBeUndefined();
    });

    it('should refuse to remove bundled skill', () => {
      // Place a bundled skill
      const bundledSkillDir = join(tempDir, '.codebuddy', 'skills', 'bundled', 'bundled-skill');
      mkdirSync(bundledSkillDir, { recursive: true });
      writeFileSync(join(bundledSkillDir, 'SKILL.md'), BUNDLED_CONTENT);
      registry.scan();

      const result = registry.uninstall('bundled-skill');
      expect(result).toBe(false);
      expect(registry.get('bundled-skill')).toBeDefined();
    });
  });

  // ---- list ----

  describe('list', () => {
    it('should filter by source', () => {
      // Add bundled
      const bundledSkillDir = join(tempDir, '.codebuddy', 'skills', 'bundled', 'bundled-skill');
      mkdirSync(bundledSkillDir, { recursive: true });
      writeFileSync(join(bundledSkillDir, 'SKILL.md'), BUNDLED_CONTENT);

      // Add managed
      registry.install('test-skill', SKILL_CONTENT);
      registry.scan();
      // Re-install after scan to have both
      registry.install('test-skill', SKILL_CONTENT);

      const managed = registry.list('managed');
      const bundled = registry.list('bundled');

      expect(managed.every(s => s.source === 'managed')).toBe(true);
      expect(bundled.every(s => s.source === 'bundled')).toBe(true);
    });

    it('should return all when no filter', () => {
      registry.install('test-skill', SKILL_CONTENT);
      const all = registry.list();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- get ----

  describe('get', () => {
    it('should return skill by name', () => {
      registry.install('test-skill', SKILL_CONTENT);
      const skill = registry.get('test-skill');
      expect(skill).toBeDefined();
      expect(skill!.name).toBe('test-skill');
    });

    it('should return undefined for missing skill', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  // ---- scan ----

  describe('scan', () => {
    it('should find SKILL.md files in all dirs', () => {
      // bundled
      const bundledDir = join(tempDir, '.codebuddy', 'skills', 'bundled', 'b1');
      mkdirSync(bundledDir, { recursive: true });
      writeFileSync(join(bundledDir, 'SKILL.md'), BUNDLED_CONTENT);

      // workspace
      const wsDir = join(tempDir, '.codebuddy', 'skills', 'workspace', 'w1');
      mkdirSync(wsDir, { recursive: true });
      writeFileSync(join(wsDir, 'SKILL.md'), MINIMAL_CONTENT);

      const results = registry.scan();
      expect(results.length).toBe(2);

      const names = results.map(r => r.name);
      expect(names).toContain('bundled-skill');
      expect(names).toContain('minimal');
    });
  });

  // ---- setEnabled ----

  describe('setEnabled', () => {
    it('should toggle enabled flag', () => {
      registry.install('test-skill', SKILL_CONTENT);
      expect(registry.get('test-skill')!.enabled).toBe(true);

      registry.setEnabled('test-skill', false);
      expect(registry.get('test-skill')!.enabled).toBe(false);

      registry.setEnabled('test-skill', true);
      expect(registry.get('test-skill')!.enabled).toBe(true);
    });

    it('should return false for missing skill', () => {
      expect(registry.setEnabled('nope', true)).toBe(false);
    });
  });

  // ---- getContent ----

  describe('getContent', () => {
    it('should return file content', () => {
      registry.install('test-skill', SKILL_CONTENT);
      const content = registry.getContent('test-skill');
      expect(content).toBe(SKILL_CONTENT);
    });

    it('should return null for missing skill', () => {
      expect(registry.getContent('nope')).toBeNull();
    });
  });

  // ---- getEnvOverrides ----

  describe('getEnvOverrides', () => {
    it('should return env map', () => {
      registry.install('test-skill', SKILL_CONTENT);
      const env = registry.getEnvOverrides('test-skill');
      expect(env).toEqual({ MY_VAR: 'hello', OTHER: 'world' });
    });

    it('should return empty object for skill without env', () => {
      registry.install('minimal', MINIMAL_CONTENT);
      const env = registry.getEnvOverrides('minimal');
      expect(env).toEqual({});
    });

    it('should return empty object for missing skill', () => {
      expect(registry.getEnvOverrides('nope')).toEqual({});
    });
  });

  // ---- refresh ----

  describe('refresh', () => {
    it('should re-scan all dirs', () => {
      const bundledDir = join(tempDir, '.codebuddy', 'skills', 'bundled', 'b1');
      mkdirSync(bundledDir, { recursive: true });
      writeFileSync(join(bundledDir, 'SKILL.md'), BUNDLED_CONTENT);

      expect(registry.list().length).toBe(0);
      const results = registry.refresh();
      expect(results.length).toBe(1);
    });
  });
});
