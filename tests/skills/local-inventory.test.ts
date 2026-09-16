import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SkillsHub, getSkillsHub, resetSkillsHub } from '../../src/skills/hub.js';
import { executeSkillsListTool, executeSkillViewTool } from '../../src/tools/skills-inspection-tool.js';

let home: string;
let originalCwd: string;
const content = (name: string) => `---\nname: ${name}\ndescription: Useful local instructions\nversion: 1.0.0\n---\n# Instructions\nReview code carefully.\n`;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'cb-inventory-'));
  originalCwd = process.cwd();
  process.chdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  resetSkillsHub();
});
afterEach(async () => {
  resetSkillsHub();
  vi.unstubAllEnvs();
  process.chdir(originalCwd);
  await rm(home, { recursive: true, force: true });
});

describe('local skill inventory', () => {
  it('resolves the home at construction, even when the module was imported earlier', async () => {
    const hub = new SkillsHub();
    await hub.installFromContent('isolated-helper', content('isolated-helper'));
    expect(JSON.parse(await readFile(join(home, '.codebuddy/hub/lock.json'), 'utf-8')).skills['isolated-helper']).toBeDefined();
  });

  it('exposes bundled and built-in skills with an empty hub and reads their instructions', async () => {
    const result = await executeSkillsListTool({});
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output!);
    expect(payload.availableSkills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'git-commit', source: 'bundled', available: true }),
      expect.objectContaining({ name: 'react-specialist', source: 'builtin', available: true }),
    ]));
    expect(payload.count).toBe(0);
    const viewed = await executeSkillViewTool({ name: 'git-commit' });
    expect(viewed.success).toBe(true);
    expect(JSON.parse(viewed.output!).content).toContain('name: git-commit');
    expect(JSON.parse((await executeSkillViewTool({ name: 'react-specialist', include_content: false })).output!).content).toBeUndefined();
  });

  it('separates broken hub records, respects disables, and includes workspace skills', async () => {
    const hub = getSkillsHub();
    await hub.installFromContent('healthy-helper', content('healthy-helper'));
    await hub.installFromContent('tampered-helper', content('tampered-helper'));
    await writeFile(hub.info('tampered-helper')!.installed.path, 'tampered');
    hub.setEnabled('missing-helper', true, { path: join(home, 'gone', 'SKILL.md') });
    hub.setEnabled('git-commit', false, { path: join(home, 'disabled', 'SKILL.md') });
    const dir = join(home, '.codebuddy/skills/workspace-helper');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), content('workspace-helper'));
    const before = await readFile(join(home, '.codebuddy/hub/lock.json'), 'utf-8');
    const payload = JSON.parse((await executeSkillsListTool({})).output!);
    expect(payload.availableSkills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'healthy-helper', description: 'Useful local instructions' }),
      expect.objectContaining({ name: 'workspace-helper', source: 'workspace' }),
    ]));
    expect(payload.availableSkills.map((s: {name: string}) => s.name)).not.toEqual(expect.arrayContaining(['git-commit']));
    expect(payload.unavailableSkills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'missing-helper', reason: 'missing-file' }),
      expect.objectContaining({ name: 'tampered-helper', reason: 'integrity-mismatch' }),
      expect.objectContaining({ name: 'git-commit', reason: 'disabled' }),
    ]));
    expect(await readFile(join(home, '.codebuddy/hub/lock.json'), 'utf-8')).toBe(before);
  });
});
