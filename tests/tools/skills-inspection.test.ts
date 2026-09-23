import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executeSkillsListTool, executeSkillViewTool } from '../../src/tools/skills-inspection-tool';
import { SkillManageExecuteTool } from '../../src/tools/registry/skills-inspection-tools';
import { CreateSkillExecuteTool } from '../../src/tools/registry/knowledge-tools';
import { SkillDiscoveryExecuteTool } from '../../src/tools/registry/misc-tools';

describe('Skill Tools', () => {
  let tempHome: string;
  let tempWorkspace: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-skill-home-'));
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-skill-workspace-'));
    
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('USERPROFILE', tempHome);
    vi.stubEnv('CODEBUDDY_HOME', path.join(tempHome, '.codebuddy'));
    
    originalCwd = process.cwd;
    process.cwd = () => tempWorkspace;

    fs.mkdirSync(path.join(tempWorkspace, '.codebuddy', 'skills', 'dummy-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, '.codebuddy', 'skills', 'dummy-skill', 'SKILL.md'), '---\nname: dummy-skill\ndescription: Just a dummy skill\n---\n# Dummy\nIt does nothing.');
    
    fs.mkdirSync(path.join(tempHome, '.codebuddy', 'skills', 'global-dummy'), { recursive: true });
    fs.writeFileSync(path.join(tempHome, '.codebuddy', 'skills', 'global-dummy', 'SKILL.md'), '---\nname: global-dummy\ndescription: Global skill\n---\n# Global\nIt does nothing globally.');
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.unstubAllEnvs();
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it('skills_list should list skills', async () => {
    const result = await executeSkillsListTool({});
    expect(result.success).toBe(true);
    expect(result.output).toContain('dummy-skill');
  });

  it('skill_view should view a skill', async () => {
    const result = await executeSkillViewTool({ name: 'dummy-skill', include_content: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Just a dummy skill');
    expect(result.output).toContain('It does nothing.');
  });
  
  it('create_skill should create a new skill', async () => {
    const tool = new CreateSkillExecuteTool();
    const result = await tool.execute({
      name: 'new-test-skill',
      description: 'A newly created skill',
      body: '# Test\nThis is a test skill.',
    }, { cwd: tempWorkspace, tools: [], options: {} } as never);
    expect(result.success).toBe(true);
    
    const listResult = await executeSkillsListTool({});
    expect(listResult.output).toContain('new-test-skill');
  });
  
  it('skill_manage should manage skills (list)', async () => {
    const tool = new SkillManageExecuteTool();
    const result = await tool.execute({
      action: 'list'
    });
    expect(result.success).toBe(true);
    expect((result as any).output).toContain('dummy-skill');
  });

  it('skill_manage delete removes a workspace skill that is not in the hub lockfile', async () => {
    const skillFile = path.join(tempWorkspace, '.codebuddy', 'skills', 'dummy-skill', 'SKILL.md');
    const tool = new SkillManageExecuteTool();
    const refused = await tool.execute({ action: 'delete', name: 'dummy-skill' });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain('approved_by is required');
    expect(fs.existsSync(skillFile)).toBe(true);

    const removed = await tool.execute({
      action: 'delete',
      name: 'dummy-skill',
      approved_by: 'lot13',
    });
    expect(removed.success).toBe(true);
    expect(removed.error).toBeUndefined();
    expect(fs.existsSync(skillFile)).toBe(false);

    const listed = await tool.execute({ action: 'list' });
    expect(listed.success).toBe(true);
    expect(listed.output).not.toContain('dummy-skill');
  });
  
  it('skill_discover should discover skills', async () => {
    const tool = new SkillDiscoveryExecuteTool();
    const result = await tool.execute({
      query: 'test',
    });
    expect(result.success).toBe(true);
  });
});
