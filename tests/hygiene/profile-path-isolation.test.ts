import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Import before changing HOME/cwd: defaults must be resolved by each instance.
import { HistoryManager } from '../../src/utils/history-manager.js';
import { AuthProfileManager } from '../../src/auth/profile-manager.js';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';
import { SkillLoader } from '../../src/skills/skill-loader.js';

let home: string;
let cwd: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'cb-profile-isolation-'));
  cwd = process.cwd();
  process.chdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  process.chdir(cwd);
  await rm(home, { recursive: true, force: true });
});
describe('profile paths after module import', () => {
  it('writes history into the current home', async () => {
    new HistoryManager().add('profile isolation example');
    expect(await readFile(join(home, '.codebuddy/history.json'), 'utf8')).toContain('profile isolation example');
  });
  it('persists auth state into the current home', async () => {
    new AuthProfileManager().shutdown();
    expect(JSON.parse(await readFile(join(home, '.codebuddy/auth-profiles.json'), 'utf8')).cooldowns).toEqual({});
  });
  it('writes user memory into the current home', async () => {
    const memory = new PersistentMemoryManager();
    await memory.initialize();
    await memory.remember('preferred-language', 'French', { scope: 'user', category: 'preferences' });
    expect(await readFile(join(home, '.codebuddy/memory.md'), 'utf8')).toContain('French');
  });
  it('discovers skills from the current project instead of the import-time directory', async () => {
    const dir = join(home, '.codebuddy/skills/isolated-skill');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), '---\nname: isolated-skill\ndescription: Isolated project skill\ntriggers: [isolated]\n---\nUse local files.');
    const skills = await new SkillLoader({ loadGlobal: false }).loadAll();
    expect(skills.map(skill => skill.name)).toContain('isolated-skill');
  });
});
