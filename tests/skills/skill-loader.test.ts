/**
 * Skill Loader Tests
 */

import * as path from 'path';
import * as os from 'os';
import fs from 'fs-extra';
import {
  SkillLoader,
  getSkillLoader,
  resetSkillLoader,
  DEFAULT_SKILL_LOADER_CONFIG,
  type LoadedSkill,
  type SkillSource,
} from '../../src/skills/skill-loader.js';

describe('SkillLoader', () => {
  const testBaseDir = path.join(os.tmpdir(), 'codebuddy-test-skills');
  const testGlobalDir = path.join(testBaseDir, 'global');
  const testProjectDir = path.join(testBaseDir, 'project');

  beforeEach(async () => {
    resetSkillLoader();
    await fs.remove(testBaseDir);
    await fs.ensureDir(testGlobalDir);
    await fs.ensureDir(testProjectDir);
  });

  afterEach(async () => {
    resetSkillLoader();
    await fs.remove(testBaseDir);
  });

  /**
   * Helper to create a test skill
   */
  async function createTestSkill(
    dir: string,
    name: string,
    options: {
      description?: string;
      triggers?: string[];
      tools?: string[];
      model?: string;
      priority?: number;
      autoActivate?: boolean;
      agents?: string[];
    } = {}
  ): Promise<void> {
    const skillDir = path.join(dir, name);
    await fs.ensureDir(skillDir);

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${options.description || `Test skill ${name}`}`,
      `triggers: ${JSON.stringify(options.triggers || [`/${name}`])}`,
    ];

    if (options.tools) {
      frontmatter.push(`tools: ${JSON.stringify(options.tools)}`);
    }
    if (options.model) {
      frontmatter.push(`model: ${options.model}`);
    }
    if (options.priority !== undefined) {
      frontmatter.push(`priority: ${options.priority}`);
    }
    if (options.autoActivate !== undefined) {
      frontmatter.push(`autoActivate: ${options.autoActivate}`);
    }
    if (options.agents) {
      frontmatter.push(`agents: ${JSON.stringify(options.agents)}`);
    }

    frontmatter.push('---');
    frontmatter.push('');
    frontmatter.push(`This is the system prompt for ${name}.`);

    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      frontmatter.join('\n')
    );
  }

  describe('constructor', () => {
    it('should use default config', () => {
      const loader = new SkillLoader();
      expect(loader).toBeInstanceOf(SkillLoader);
    });

    it('should accept custom config', () => {
      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
        loadGlobal: false,
      });
      expect(loader).toBeInstanceOf(SkillLoader);
    });
  });

  describe('loadFromDirectory', () => {
    it('should load skills from directory', async () => {
      await createTestSkill(testGlobalDir, 'test-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      const skills = await loader.loadFromDirectory(testGlobalDir, 'global');

      expect(skills.length).toBe(1);
      expect(skills[0].name).toBe('test-skill');
      expect(skills[0].source).toBe('global');
      expect(skills[0].triggers).toContain('/test-skill');
    });

    it('should return empty array for non-existent directory', async () => {
      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      const skills = await loader.loadFromDirectory('/non/existent/path', 'global');

      expect(skills).toEqual([]);
    });

    it('should skip directories without SKILL.md', async () => {
      await fs.ensureDir(path.join(testGlobalDir, 'not-a-skill'));
      await createTestSkill(testGlobalDir, 'valid-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      const skills = await loader.loadFromDirectory(testGlobalDir, 'global');

      expect(skills.length).toBe(1);
      expect(skills[0].name).toBe('valid-skill');
    });

    it('should parse all frontmatter fields', async () => {
      await createTestSkill(testGlobalDir, 'full-skill', {
        description: 'A fully configured skill',
        triggers: ['/full', '/complete'],
        tools: ['read_file', 'write_file'],
        model: 'gpt-4',
        priority: 10,
        autoActivate: true,
      });

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      const skills = await loader.loadFromDirectory(testGlobalDir, 'global');

      expect(skills.length).toBe(1);
      const skill = skills[0];
      expect(skill.description).toBe('A fully configured skill');
      expect(skill.triggers).toContain('/full');
      expect(skill.triggers).toContain('/complete');
      expect(skill.tools).toContain('read_file');
      expect(skill.tools).toContain('write_file');
      expect(skill.model).toBe('gpt-4');
      expect(skill.priority).toBe(10);
      expect(skill.autoActivate).toBe(true);
    });
  });

  describe('loadAll', () => {
    it('should load from both global and project directories', async () => {
      await createTestSkill(testGlobalDir, 'global-skill');
      await createTestSkill(testProjectDir, 'project-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      const skills = await loader.loadAll();

      expect(skills.length).toBe(2);
      expect(skills.some(s => s.name === 'global-skill')).toBe(true);
      expect(skills.some(s => s.name === 'project-skill')).toBe(true);
    });

    it('should allow project skills to override global skills', async () => {
      await createTestSkill(testGlobalDir, 'shared-skill', {
        description: 'Global version',
      });
      await createTestSkill(testProjectDir, 'shared-skill', {
        description: 'Project version',
      });

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
        mergeDuplicates: true,
      });

      const skills = await loader.loadAll();

      // Should have only one version
      const sharedSkills = skills.filter(s => s.name === 'shared-skill');
      expect(sharedSkills.length).toBe(1);
      expect(sharedSkills[0].source).toBe('project');
      expect(sharedSkills[0].description).toBe('Project version');
    });

    it('should respect loadGlobal config', async () => {
      await createTestSkill(testGlobalDir, 'global-skill');
      await createTestSkill(testProjectDir, 'project-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
        loadGlobal: false,
      });

      const skills = await loader.loadAll();

      expect(skills.length).toBe(1);
      expect(skills[0].name).toBe('project-skill');
    });

    it('should respect loadProject config', async () => {
      await createTestSkill(testGlobalDir, 'global-skill');
      await createTestSkill(testProjectDir, 'project-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
        loadProject: false,
      });

      const skills = await loader.loadAll();

      expect(skills.length).toBe(1);
      expect(skills[0].name).toBe('global-skill');
    });
  });

  describe('agent-specific skills', () => {
    it('should load agent-specific skills', async () => {
      const agentDir = path.join(testBaseDir, 'agent-skills');
      await createTestSkill(agentDir, 'agent-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      loader.registerAgentSkillsDir('test-agent', agentDir);
      const skills = await loader.loadAll();

      expect(skills.some(s => s.name === 'agent-skill')).toBe(true);
      const agentSkill = skills.find(s => s.name === 'agent-skill');
      expect(agentSkill?.source).toBe('agent');
      expect(agentSkill?.agentId).toBe('test-agent');
    });

    it('should filter skills by allowed agents', async () => {
      const agentDir = path.join(testBaseDir, 'agent-skills');
      await createTestSkill(agentDir, 'restricted-skill', {
        agents: ['allowed-agent'],
      });

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      // Register for a non-allowed agent
      loader.registerAgentSkillsDir('other-agent', agentDir);
      const skills = await loader.loadAll();

      // Skill should not be loaded for other-agent
      expect(skills.some(s => s.name === 'restricted-skill')).toBe(false);
    });

    it('should allow skill when agent is in allowed list', async () => {
      const agentDir = path.join(testBaseDir, 'agent-skills');
      await createTestSkill(agentDir, 'restricted-skill', {
        agents: ['allowed-agent', 'test-agent'],
      });

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      loader.registerAgentSkillsDir('test-agent', agentDir);
      const skills = await loader.loadAll();

      expect(skills.some(s => s.name === 'restricted-skill')).toBe(true);
    });

    it('should unregister agent skills directory', async () => {
      const agentDir = path.join(testBaseDir, 'agent-skills');
      await createTestSkill(agentDir, 'agent-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      loader.registerAgentSkillsDir('test-agent', agentDir);
      await loader.loadAll();

      expect(loader.getSkill('agent-skill')).toBeDefined();

      loader.unregisterAgentSkillsDir('test-agent');

      expect(loader.getSkill('agent-skill')).toBeUndefined();
    });
  });

  describe('getSkills', () => {
    it('should return all loaded skills', async () => {
      await createTestSkill(testGlobalDir, 'skill-1');
      await createTestSkill(testGlobalDir, 'skill-2');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      await loader.loadAll();
      const skills = loader.getSkills();

      expect(skills.length).toBe(2);
    });
  });

  describe('getSkill', () => {
    it('should return skill by name', async () => {
      await createTestSkill(testGlobalDir, 'my-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      await loader.loadAll();
      const skill = loader.getSkill('my-skill');

      expect(skill).toBeDefined();
      expect(skill?.name).toBe('my-skill');
    });

    it('should return undefined for non-existent skill', async () => {
      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      await loader.loadAll();
      const skill = loader.getSkill('non-existent');

      expect(skill).toBeUndefined();
    });
  });

  describe('getSkillsForAgent', () => {
    it('should return global, project, and agent-specific skills', async () => {
      const agentDir = path.join(testBaseDir, 'agent-skills');
      await createTestSkill(testGlobalDir, 'global-skill');
      await createTestSkill(testProjectDir, 'project-skill');
      await createTestSkill(agentDir, 'agent-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      loader.registerAgentSkillsDir('my-agent', agentDir);
      await loader.loadAll();

      const skills = loader.getSkillsForAgent('my-agent');

      expect(skills.length).toBe(3);
    });

    it('should not return other agents skills', async () => {
      const agent1Dir = path.join(testBaseDir, 'agent1-skills');
      const agent2Dir = path.join(testBaseDir, 'agent2-skills');
      await createTestSkill(agent1Dir, 'agent1-skill');
      await createTestSkill(agent2Dir, 'agent2-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      loader.registerAgentSkillsDir('agent-1', agent1Dir);
      loader.registerAgentSkillsDir('agent-2', agent2Dir);
      await loader.loadAll();

      const skills = loader.getSkillsForAgent('agent-1');

      expect(skills.some(s => s.name === 'agent1-skill')).toBe(true);
      expect(skills.some(s => s.name === 'agent2-skill')).toBe(false);
    });
  });

  describe('getSkillsBySource', () => {
    it('should filter skills by source', async () => {
      await createTestSkill(testGlobalDir, 'global-skill');
      await createTestSkill(testProjectDir, 'project-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      await loader.loadAll();

      const globalSkills = loader.getSkillsBySource('global');
      const projectSkills = loader.getSkillsBySource('project');

      expect(globalSkills.length).toBe(1);
      expect(globalSkills[0].name).toBe('global-skill');
      expect(projectSkills.length).toBe(1);
      expect(projectSkills[0].name).toBe('project-skill');
    });
  });

  describe('filterSkillsByCapabilities', () => {
    it('should filter skills by allowed tools', async () => {
      await createTestSkill(testGlobalDir, 'read-skill', {
        tools: ['read_file'],
      });
      await createTestSkill(testGlobalDir, 'write-skill', {
        tools: ['write_file'],
      });
      await createTestSkill(testGlobalDir, 'both-skill', {
        tools: ['read_file', 'write_file'],
      });

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      await loader.loadAll();
      const allSkills = loader.getSkills();

      const filtered = loader.filterSkillsByCapabilities(allSkills, ['read_file']);

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('read-skill');
    });

    it('should include skills without tool restrictions', async () => {
      await createTestSkill(testGlobalDir, 'unrestricted-skill');
      await createTestSkill(testGlobalDir, 'restricted-skill', {
        tools: ['special_tool'],
      });

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      await loader.loadAll();
      const allSkills = loader.getSkills();

      const filtered = loader.filterSkillsByCapabilities(allSkills, ['read_file']);

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('unrestricted-skill');
    });

    it('should return all skills when allowedTools is empty', async () => {
      await createTestSkill(testGlobalDir, 'skill-1', { tools: ['tool1'] });
      await createTestSkill(testGlobalDir, 'skill-2', { tools: ['tool2'] });

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      await loader.loadAll();
      const allSkills = loader.getSkills();

      const filtered = loader.filterSkillsByCapabilities(allSkills, []);

      expect(filtered.length).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      const agentDir = path.join(testBaseDir, 'agent-skills');
      await createTestSkill(testGlobalDir, 'global-skill-1');
      await createTestSkill(testGlobalDir, 'global-skill-2');
      await createTestSkill(testProjectDir, 'project-skill');
      await createTestSkill(agentDir, 'agent-skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      loader.registerAgentSkillsDir('my-agent', agentDir);
      await loader.loadAll();

      const stats = loader.getStats();

      expect(stats.total).toBe(4);
      expect(stats.bySource.global).toBe(2);
      expect(stats.bySource.project).toBe(1);
      expect(stats.bySource.agent).toBe(1);
      expect(stats.byAgent['my-agent']).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all loaded skills', async () => {
      await createTestSkill(testGlobalDir, 'skill');

      const loader = new SkillLoader({
        globalDir: testGlobalDir,
        projectDir: testProjectDir,
      });

      await loader.loadAll();
      expect(loader.getSkills().length).toBe(1);

      loader.clear();
      expect(loader.getSkills().length).toBe(0);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const loader1 = getSkillLoader();
      const loader2 = getSkillLoader();

      expect(loader1).toBe(loader2);
    });

    it('should reset instance', () => {
      const loader1 = getSkillLoader();
      resetSkillLoader();
      const loader2 = getSkillLoader();

      expect(loader1).not.toBe(loader2);
    });
  });

  describe('DEFAULT_SKILL_LOADER_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_SKILL_LOADER_CONFIG.loadGlobal).toBe(true);
      expect(DEFAULT_SKILL_LOADER_CONFIG.loadProject).toBe(true);
      expect(DEFAULT_SKILL_LOADER_CONFIG.mergeDuplicates).toBe(true);
      expect(DEFAULT_SKILL_LOADER_CONFIG.globalDir).toContain('.codebuddy');
      expect(DEFAULT_SKILL_LOADER_CONFIG.projectDir).toContain('.codebuddy');
    });
  });
});
