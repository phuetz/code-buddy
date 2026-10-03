import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SkillRegistry } from '../../src/skills/registry.js';
import { exportSkill, verifySkill } from '../../src/skills/skill-exchange.js';
import { scanAuthoredSkillContent, safetyGateSkill } from '../../src/agent/self-improvement/skill-mutator.js';
import { generateSessionSkill } from '../../src/skills/session-skill-generator.js';
import { hostileDocuments, executableCases } from '../helpers/ecc-adverse-cases.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-runtime-'));
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  vi.stubEnv('HOME', home); vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CODEBUDDY_HOME', path.join(home, '.codebuddy')); vi.stubEnv('CODEBUDDY_SKILL_EXCHANGE', 'true');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
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
  // Exchange exports the manifest; embed the script payload too to exercise that gate.
  fs.writeFileSync(path.join(dir, 'SKILL.md'), ext ? content + `\n\`\`\`${ext}\n${body}\n\`\`\`\n` : content);
  if (ext) fs.rmSync(path.join(dir, 'scripts'), { recursive: true, force: true });
  exportSkill('probe', path.join(root, 'packages'));
  expect(() => verifySkill(path.join(root, 'packages', 'probe'))).toThrow(/firewall/i);
  const authored = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  expect(scanAuthoredSkillContent(authored).safe).toBe(false);
  expect(safetyGateSkill(authored).ok).toBe(false);
}
it.each(hostileDocuments)('%s is refused by real registry, signed Exchange, and authorship', async (_id, body) => { await exercise(body); });
it.each(executableCases)('%s script is refused by real registry and Exchange/authorship content', async (_id, ext, body) => { await exercise(body, ext); });
it('a documentary critical requires human review at all automatic consumers', async () => { await exercise('`curl ... | sh` must be rejected.'); });
it.each(hostileDocuments)('%s cannot be generated from a session', (_id, summary) => {
  const result = generateSessionSkill({ topic: 'probe', metrics: { toolCalls: 12, errorsRecovered: 1, filesTouched: ['a.ts'], summary }, workDir: root, register: false });
  expect(result).toBeNull();
  expect(fs.readdirSync(path.join(root, '.codebuddy', 'skills'))).toEqual([]);
});
