import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSkillsHub, resetSkillsHub } from '../../src/skills/hub.js';
import { executeSkillViewTool } from '../../src/tools/skills-inspection-tool.js';

let root: string;
const content = (name: string, description: string) =>
  `---\nname: ${name}\nversion: 1.0.0\ndescription: ${description}\n---\n\n# Checklist\n${description}\n`;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-imported-resolution-'));
  vi.stubEnv('HOME', root);
  vi.stubEnv('USERPROFILE', root);
  vi.stubEnv('CODEBUDDY_HOME', path.join(root, '.codebuddy'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  resetSkillsHub();
  const hub = getSkillsHub({
    skillsDir: path.join(root, '.codebuddy/skills'),
    cacheDir: path.join(root, '.codebuddy/cache'),
    lockfilePath: path.join(root, '.codebuddy/hub-lock.json'),
  });
  await hub.installFromContent('imported-security-review', content('security-review', 'Imported checklist'));
});

afterEach(async () => {
  resetSkillsHub();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

it('resolves an actual hub import by its bare name with integrity evidence', async () => {
  const result = await executeSkillViewTool({ name: 'security-review' });
  expect(result.success, result.error).toBe(true);
  expect(result.data).toMatchObject({
    requestedName: 'security-review', resolvedName: 'imported-security-review', integrityOk: true,
    installed: { name: 'imported-security-review' },
  });
  expect(result.output).toContain('Imported checklist');
});

it('prefers an exact workspace name over an imported hub record', async () => {
  const directory = path.join(root, '.codebuddy/skills/security-review');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'SKILL.md'), content('security-review', 'Workspace checklist'));
  const result = await executeSkillViewTool({ name: 'security-review' });
  expect(result.success, result.error).toBe(true);
  expect(result.output).toContain('Workspace checklist');
  expect(result.output).not.toContain('Imported checklist');
  expect(result.data).not.toHaveProperty('resolvedName');
});

it('keeps a damaged exact hub record visible instead of hiding it behind the alias', async () => {
  const hub = getSkillsHub();
  const installed = await hub.installFromContent('security-review', content('security-review', 'Exact checklist'));
  await fs.writeFile(installed.path, content('security-review', 'Altered checklist'));
  const result = await executeSkillViewTool({ name: 'security-review' });
  expect(result.success, result.error).toBe(true);
  expect(result.data).toMatchObject({ installed: { name: 'security-review' }, integrityOk: false });
  expect(result.data).not.toHaveProperty('resolvedName');
  expect(result.output).not.toContain('Imported checklist');
});

it('does not change an explicitly requested imported name', async () => {
  const result = await executeSkillViewTool({ name: 'imported-security-review' });
  expect(result.success, result.error).toBe(true);
  expect(result.data).toMatchObject({ installed: { name: 'imported-security-review' }, integrityOk: true });
  expect(result.data).not.toHaveProperty('resolvedName');
});
