import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SkillRegistry } from '../../src/skills/registry.js';
import { exportSkill, verifySkill } from '../../src/skills/skill-exchange.js';
import { scanAuthoredSkillContent, safetyGateSkill } from '../../src/agent/self-improvement/skill-mutator.js';
import { reprise6Scripts } from '../helpers/ecc-reprise-6-cases.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-consumer5-')); const home = path.join(root, 'home'); fs.mkdirSync(home);
  vi.stubEnv('HOME', home); vi.stubEnv('USERPROFILE', home); vi.stubEnv('CODEBUDDY_HOME', path.join(home, '.codebuddy'));
  vi.stubEnv('CODEBUDDY_SKILL_EXCHANGE', 'true'); vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', 'false');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
async function exercise(body: string, file?: string) {
  const skills = path.join(root, '.codebuddy/skills'); const dir = path.join(skills, 'authored-probe'); fs.mkdirSync(dir, { recursive: true });
  const content = `---\nname: probe\ndescription: Consumer probe\nversion: 1.0.0\n---\n${file ? 'Helper.' : body}\n`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  if (file) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', file), body); }
  const registry = new SkillRegistry({ bundledPath: '', workspacePath: '', managedPath: skills, watchEnabled: false });
  try { await registry.load(); expect(registry.getAllUnified().map(s => s.name)).not.toContain('probe'); }
  finally { registry.stopWatching(); }
  // Exchange packages contain manifests. Recheck the same charge as guidance,
  // without claiming the package format includes a support-script directory.
  if (file) {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content + `\n\`\`\`${path.extname(file).slice(1) || 'shell'}\n${body}\n\`\`\`\n`);
    fs.rmSync(path.join(dir, 'scripts'), { recursive: true, force: true });
  }
  exportSkill('probe', path.join(root, 'packages'));
  expect(() => verifySkill(path.join(root, 'packages/probe'))).toThrow(/firewall/i);
  const authored = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  expect(scanAuthoredSkillContent(authored).safe).toBe(false); expect(safetyGateSkill(authored).ok).toBe(false);
}
it.each(reprise6Scripts)('%s cannot reach registry, signed Exchange or authorship with opt-out', async (_id, file, body) => { await exercise(body, file); });
