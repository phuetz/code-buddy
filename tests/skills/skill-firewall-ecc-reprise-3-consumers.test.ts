import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SkillRegistry } from '../../src/skills/registry.js';
import { exportSkill, verifySkill } from '../../src/skills/skill-exchange.js';
import { scanAuthoredSkillContent, safetyGateSkill } from '../../src/agent/self-improvement/skill-mutator.js';
import { generateSessionSkill } from '../../src/skills/session-skill-generator.js';
import { reprise3Scripts, reprise3Mixed } from '../helpers/ecc-reprise-3-cases.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-consumer3-')); const home = path.join(root, 'home'); fs.mkdirSync(home);
  vi.stubEnv('HOME', home); vi.stubEnv('USERPROFILE', home); vi.stubEnv('CODEBUDDY_HOME', path.join(home, '.codebuddy'));
  vi.stubEnv('CODEBUDDY_SKILL_EXCHANGE', 'true'); vi.spyOn(process, 'cwd').mockReturnValue(root);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
async function exercise(body: string, ext?: string) {
  const skills = path.join(root, '.codebuddy', 'skills'); const dir = path.join(skills, 'authored-probe'); fs.mkdirSync(dir, { recursive: true });
  const content = `---\nname: probe\ndescription: Consumer probe\nversion: 1.0.0\n---\n${ext ? 'Helper.' : body}\n`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  if (ext) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', `run.${ext}`), body); }
  const registry = new SkillRegistry({ bundledPath: '', workspacePath: '', managedPath: skills, watchEnabled: false });
  try { await registry.load(); expect(registry.getAllUnified().map(s => s.name)).not.toContain('probe'); }
  finally { registry.stopWatching(); }
  if (ext) { fs.writeFileSync(path.join(dir, 'SKILL.md'), content + `\n\`\`\`${ext}\n${body}\n\`\`\`\n`); fs.rmSync(path.join(dir, 'scripts'), { recursive: true, force: true }); }
  exportSkill('probe', path.join(root, 'packages'));
  expect(() => verifySkill(path.join(root, 'packages', 'probe'))).toThrow(/firewall/i);
  const authored = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  expect(scanAuthoredSkillContent(authored).safe).toBe(false); expect(safetyGateSkill(authored).ok).toBe(false);
}
it.each(reprise3Scripts)('%s script cannot reach registry, signed Exchange or authorship', async (_id, ext, body) => { await exercise(body, ext); });
it.each(reprise3Mixed)('%s mixed content cannot reach registry, signed Exchange or authorship', async (_id, body) => { await exercise(body); });
it.each(reprise3Mixed)('%s mixed content cannot become an automatically generated session skill', (_id, summary) => {
  const result = generateSessionSkill({ topic: 'probe', metrics: { toolCalls: 12, errorsRecovered: 1, filesTouched: ['a.ts'], summary }, workDir: root, register: false });
  expect(result).toBeNull(); expect(fs.readdirSync(path.join(root, '.codebuddy', 'skills'))).toEqual([]);
});
