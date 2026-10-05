import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exportSkill, verifySkill } from '../../src/skills/skill-exchange.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { scanAuthoredSkillContent, safetyGateSkill } from '../../src/agent/self-improvement/skill-mutator.js';
import { logger } from '../../src/utils/logger.js';

let root: string;
let skills: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-consumer-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CODEBUDDY_HOME', path.join(home, '.codebuddy'));
  vi.stubEnv('CODEBUDDY_SKILL_EXCHANGE', 'true');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  skills = path.join(root, '.codebuddy', 'skills');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
function write(body: string) {
  const dir = path.join(skills, 'authored-probe');
  fs.mkdirSync(dir, { recursive: true });
  const content = `---\nname: authored-probe\ndescription: Isolated consumer probe\nversion: 1.0.0\n---\n${body}\n`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return content;
}
describe('real consumers of the skill firewall', () => {
  it.each(['helper.eval(payload)', 'runtime.eval(code)', '$eval(payload)'])('signed Exchange, registry and authored firewall refuse %s', async body => {
    const content = write(body);
    const out = path.join(root, 'packages');
    exportSkill('authored-probe', out);
    expect(() => verifySkill(path.join(out, 'authored-probe'))).toThrow(/firewall.*quarantine/i);
    const registry = new SkillRegistry({ bundledPath: '', workspacePath: '', managedPath: skills, watchEnabled: false });
    const failures: string[] = [];
    registry.on('skill:error', (_file: string, error: Error) => failures.push(error.message));
    try {
      await registry.load();
      expect(registry.getAllUnified().map(skill => skill.name)).not.toContain('authored-probe');
      expect(failures.some(message => message.includes('security scanner'))).toBe(true);
    } finally { registry.stopWatching(); }
    expect(scanAuthoredSkillContent(content)).toMatchObject({ safe: false, verdict: 'quarantine' });
    expect(safetyGateSkill(content).ok).toBe(false);
  });
  it('a benign signed package is verified and loaded by the same real consumers', async () => {
    write('Use targeted tests to validate the change.');
    const out = path.join(root, 'packages');
    exportSkill('authored-probe', out);
    expect(verifySkill(path.join(out, 'authored-probe')).manifest.name).toBe('authored-probe');
    const registry = new SkillRegistry({ bundledPath: '', workspacePath: '', managedPath: skills, watchEnabled: false });
    try {
      await registry.load();
      expect(registry.getAllUnified().map(skill => skill.name)).toContain('authored-probe');
    } finally { registry.stopWatching(); }
  });
});
