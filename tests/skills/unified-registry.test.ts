/**
 * Tests for Unified Skill Registry
 *
 * Tests the unified skill registry methods: registerLegacySkill and getAllUnified.
 */


// ============================================================================
// Mocks
// ============================================================================

// Mock the parser module since we are testing registry logic, not file parsing

import { SkillRegistry, resetSkillRegistry } from '../../src/skills/registry';
import type { Skill, UnifiedSkill } from '../../src/skills/types';

jest.mock('../../src/skills/parser', () => ({
  parseSkillFile: jest.fn(),
  validateSkill: jest.fn(function() { return { valid: true, errors: [] }; }),
}));

// ============================================================================
// Test Data
// ============================================================================

function createMockSkillMd(name: string, overrides: Partial<Skill> = {}): Skill {
  return {
    metadata: {
      name,
      description: `${name} description`,
      tags: ['test'],
      openclaw: {
        priority: 5,
        triggers: [`trigger-${name}`],
      },
    },
    content: {
      description: `${name} content description`,
      rawMarkdown: `# ${name}\n\nContent here.`,
    },
    sourcePath: `/skills/${name}/SKILL.md`,
    tier: 'workspace',
    loadedAt: new Date('2025-01-01'),
    enabled: true,
    ...overrides,
  };
}

function createMockLegacySkill(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    description: `${name} legacy description`,
    triggers: [`legacy-trigger-${name}`, 'common-trigger'],
    systemPrompt: `You are the ${name} expert.`,
    tools: ['view_file', 'search'],
    priority: 8,
    autoActivate: true,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SkillRegistry - Unified Methods', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    resetSkillRegistry();
    registry = new SkillRegistry({
      workspacePath: '',
      managedPath: '',
      bundledPath: '',
      watchEnabled: false,
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  // ==========================================================================
  // registerLegacySkill
  // ==========================================================================

  describe('registerLegacySkill', () => {
    it('should register a legacy skill and make it retrievable by name', () => {
      const legacy = createMockLegacySkill('typescript-expert');

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('typescript-expert');
      expect(retrieved).toBeDefined();
      expect(retrieved!.metadata.name).toBe('typescript-expert');
      expect(retrieved!.metadata.description).toBe('typescript-expert legacy description');
    });

    it('should convert legacy triggers to openclaw triggers', () => {
      const legacy = createMockLegacySkill('react-specialist', {
        triggers: ['react', 'component', 'hook'],
      });

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('react-specialist');
      expect(retrieved!.metadata.openclaw?.triggers).toEqual(['react', 'component', 'hook']);
    });

    it('should convert legacy tools to requirements', () => {
      const legacy = createMockLegacySkill('api-designer', {
        tools: ['bash', 'view_file'],
      });

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('api-designer');
      expect(retrieved!.metadata.requires?.tools).toEqual(['bash', 'view_file']);
    });

    it('should use the systemPrompt as content description', () => {
      const legacy = createMockLegacySkill('test-skill', {
        systemPrompt: 'You are an expert tester.',
      });

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('test-skill');
      expect(retrieved!.content.description).toBe('You are an expert tester.');
      expect(retrieved!.content.rawMarkdown).toBe('You are an expert tester.');
    });

    it('should set sourcePath with legacy:// prefix', () => {
      const legacy = createMockLegacySkill('devops');

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('devops');
      expect(retrieved!.sourcePath).toBe('legacy://devops');
    });

    it('should default to workspace tier', () => {
      const legacy = createMockLegacySkill('test-skill');

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('test-skill');
      expect(retrieved!.tier).toBe('workspace');
    });

    it('should respect custom tier parameter', () => {
      const legacy = createMockLegacySkill('bundled-skill');

      registry.registerLegacySkill(legacy, 'bundled');

      const retrieved = registry.get('bundled-skill');
      expect(retrieved!.tier).toBe('bundled');
    });

    it('should set enabled to true by default', () => {
      const legacy = createMockLegacySkill('enabled-skill');

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('enabled-skill');
      expect(retrieved!.enabled).toBe(true);
    });

    it('should convert triggers to tags (capped at 10)', () => {
      const legacy = createMockLegacySkill('many-triggers', {
        triggers: Array.from({ length: 15 }, (_, i) => `trigger-${i}`),
      });

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('many-triggers');
      expect(retrieved!.metadata.tags).toHaveLength(10);
    });

    it('should overwrite existing skill of the same name', () => {
      const legacy1 = createMockLegacySkill('duplicate', {
        description: 'First version',
      });
      const legacy2 = createMockLegacySkill('duplicate', {
        description: 'Second version',
      });

      registry.registerLegacySkill(legacy1);
      registry.registerLegacySkill(legacy2);

      const retrieved = registry.get('duplicate');
      expect(retrieved!.metadata.description).toBe('Second version');
    });

    it('should increment skill count', () => {
      expect(registry.count).toBe(0);

      registry.registerLegacySkill(createMockLegacySkill('skill-1'));
      expect(registry.count).toBe(1);

      registry.registerLegacySkill(createMockLegacySkill('skill-2'));
      expect(registry.count).toBe(2);
    });

    it('should emit skill:loaded event', () => {
      const loadedHandler = jest.fn();
      registry.on('skill:loaded', loadedHandler);

      registry.registerLegacySkill(createMockLegacySkill('event-skill'));

      expect(loadedHandler).toHaveBeenCalledTimes(1);
      expect(loadedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ name: 'event-skill' }),
        })
      );
    });

    it('should handle legacy skill with no tools gracefully', () => {
      const legacy = createMockLegacySkill('no-tools', { tools: undefined });

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('no-tools');
      expect(retrieved).toBeDefined();
      expect(retrieved!.metadata.requires).toBeUndefined();
    });

    it('should handle legacy skill with empty description', () => {
      const legacy = createMockLegacySkill('empty-desc', { description: '' });

      registry.registerLegacySkill(legacy);

      const retrieved = registry.get('empty-desc');
      expect(retrieved!.metadata.description).toBe('');
    });
  });

  // ==========================================================================
  // getAllUnified
  // ==========================================================================

  describe('getAllUnified', () => {
    it('should return empty array when no skills registered', () => {
      const unified = registry.getAllUnified();

      expect(unified).toEqual([]);
    });

    it('should return unified representations of registered legacy skills', () => {
      registry.registerLegacySkill(createMockLegacySkill('ts-expert'));
      registry.registerLegacySkill(createMockLegacySkill('react-expert'));

      const unified = registry.getAllUnified();

      expect(unified).toHaveLength(2);
      expect(unified.map(u => u.name)).toContain('ts-expert');
      expect(unified.map(u => u.name)).toContain('react-expert');
    });

    it('should return skills with source set to skillmd', () => {
      registry.registerLegacySkill(createMockLegacySkill('test-skill'));

      const unified = registry.getAllUnified();

      // All skills in the registry are stored as SKILL.md format internally,
      // so the unified adapter sets source to 'skillmd'
      expect(unified[0].source).toBe('skillmd');
    });

    it('should return each unified skill with expected properties', () => {
      registry.registerLegacySkill(createMockLegacySkill('detailed-skill', {
        description: 'Detailed description',
        triggers: ['detail', 'verbose'],
        priority: 10,
      }));

      const unified = registry.getAllUnified();

      expect(unified).toHaveLength(1);
      const skill = unified[0];
      expect(skill.name).toBe('detailed-skill');
      expect(skill.description).toBe('Detailed description');
      expect(skill.enabled).toBe(true);
      expect(skill.priority).toBe(10);
      expect(skill.triggers).toEqual(['detail', 'verbose']);
    });

    it('should include skills from multiple registrations', () => {
      // Register several legacy skills
      registry.registerLegacySkill(createMockLegacySkill('skill-a'));
      registry.registerLegacySkill(createMockLegacySkill('skill-b'));
      registry.registerLegacySkill(createMockLegacySkill('skill-c'));

      const unified = registry.getAllUnified();

      expect(unified).toHaveLength(3);
      const names = unified.map(u => u.name).sort();
      expect(names).toEqual(['skill-a', 'skill-b', 'skill-c']);
    });

    it('should reflect disabled state', () => {
      registry.registerLegacySkill(createMockLegacySkill('disable-me'));
      registry.disable('disable-me');

      const unified = registry.getAllUnified();

      expect(unified).toHaveLength(1);
      expect(unified[0].enabled).toBe(false);
    });

    it('should not include unloaded skills', () => {
      registry.registerLegacySkill(createMockLegacySkill('keep'));
      registry.registerLegacySkill(createMockLegacySkill('remove'));
      registry.unload('remove');

      const unified = registry.getAllUnified();

      expect(unified).toHaveLength(1);
      expect(unified[0].name).toBe('keep');
    });

    it('should preserve originalSkillMd reference', () => {
      registry.registerLegacySkill(createMockLegacySkill('with-ref'));

      const unified = registry.getAllUnified();

      expect(unified[0].originalSkillMd).toBeDefined();
      expect(unified[0].originalSkillMd!.metadata.name).toBe('with-ref');
    });
  });

  // ==========================================================================
  // Integration: legacy skills in search
  // ==========================================================================

  describe('legacy skills in search', () => {
    it('should find registered legacy skills via search', () => {
      registry.registerLegacySkill(createMockLegacySkill('typescript-expert', {
        triggers: ['typescript', 'type error'],
        description: 'Expert TypeScript developer',
      }));

      const matches = registry.search({ query: 'typescript', limit: 5 });

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skill.metadata.name).toBe('typescript-expert');
    });

    it('should find legacy skills via findBestMatch', () => {
      registry.registerLegacySkill(createMockLegacySkill('react-specialist', {
        triggers: ['react', 'component'],
        description: 'React specialist',
      }));

      const match = registry.findBestMatch('react');

      expect(match).not.toBeNull();
      expect(match!.skill.metadata.name).toBe('react-specialist');
    });

    it('should include legacy skill tags in getTags', () => {
      registry.registerLegacySkill(createMockLegacySkill('tagged-skill', {
        triggers: ['alpha', 'beta', 'gamma'],
      }));

      const tags = registry.getTags();

      expect(tags).toContain('alpha');
      expect(tags).toContain('beta');
      expect(tags).toContain('gamma');
    });

    it('should list legacy skills with tier filter', () => {
      registry.registerLegacySkill(createMockLegacySkill('ws-skill'), 'workspace');
      registry.registerLegacySkill(createMockLegacySkill('bundled-skill'), 'bundled');

      const workspaceSkills = registry.list({ tier: 'workspace' });
      const bundledSkills = registry.list({ tier: 'bundled' });

      expect(workspaceSkills).toHaveLength(1);
      expect(workspaceSkills[0].metadata.name).toBe('ws-skill');
      expect(bundledSkills).toHaveLength(1);
      expect(bundledSkills[0].metadata.name).toBe('bundled-skill');
    });
  });

  // ==========================================================================
  // Management operations on legacy skills
  // ==========================================================================

  describe('management of legacy skills', () => {
    it('should enable/disable a registered legacy skill', () => {
      registry.registerLegacySkill(createMockLegacySkill('toggle-skill'));

      expect(registry.get('toggle-skill')!.enabled).toBe(true);

      registry.disable('toggle-skill');
      expect(registry.get('toggle-skill')!.enabled).toBe(false);

      registry.enable('toggle-skill');
      expect(registry.get('toggle-skill')!.enabled).toBe(true);
    });

    it('should unload a registered legacy skill', () => {
      registry.registerLegacySkill(createMockLegacySkill('unload-me'));
      expect(registry.count).toBe(1);

      const result = registry.unload('unload-me');
      expect(result).toBe(true);
      expect(registry.count).toBe(0);
      expect(registry.get('unload-me')).toBeUndefined();
    });
  });
});
