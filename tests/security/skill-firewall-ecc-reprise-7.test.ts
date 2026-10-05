import { afterEach, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { reprise7Scripts } from '../helpers/ecc-reprise-7-cases.js';
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(body: string, file?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise7-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: probe\ndescription: Probe\n---\n${file ? 'Helper.' : body}\n`);
  if (file) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', file), body); }
  return dir;
}
it.each(reprise7Scripts)('%s remains quarantined for every decoding setting and import mode', async (_id, body) => {
  for (const deob of ['true', 'false', '0']) {
    vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', deob);
    const dir = fixture(body, 'run.sh'); const fw = scanSkillFirewall(dir);
    expect(fw.verdict).toBe('quarantine');
    expect(fw.findings).toContainEqual(expect.objectContaining({ pattern: 'shell-interpreter', severity: 'high' }));
    expect(fw.findings.every(f => !f.documentary)).toBe(true);
    for (const includeReview of [false, true]) {
      const report = await importSkills(dir, { dryRun: true, includeReview });
      expect(report.imported).toHaveLength(0); expect(report.quarantined).toHaveLength(1);
    }
  }
});
it.each(['/bin/bash -- ../payload.txt', '$(bash -- ../payload.txt)', 'ｂａｓｈ -- ../payload.txt', 'Use Bash only; /bin/bash -- ../payload.txt'])('documented %s never becomes allow', body => {
  for (const deob of ['true', 'false', '0']) {
    vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', deob);
    expect(scanSkillFirewall(fixture(body)).verdict).toBe('review');
  }
});
it.each(['true', 'false', '0'])('one folded launcher produces one high finding at %s', deob => {
  vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', deob);
  const fw = scanSkillFirewall(fixture('ｂａｓｈ ../payload.txt', 'run.sh'));
  expect(fw.findings.filter(f => f.pattern === 'shell-interpreter')).toHaveLength(1);
  expect(fw.score).toBe(76); expect(fw.verdict).toBe('quarantine');
});
it.each(['for i, sh in enumerate(shots):', 'for sh in shots:', 'for i, bash in enumerate(shots):'])('a real Python binding %s is not a launcher', body => {
  for (const deob of ['true', 'false', '0']) {
    vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', deob);
    expect(scanSkillFirewall(fixture(body + '\n    pass', 'run.py')).verdict).toBe('allow');
    expect(scanSkillFirewall(fixture(body, 'run.sh')).verdict).toBe('quarantine');
    expect(scanSkillFirewall(fixture(body + '\n    os.system("id")', 'run.py')).verdict).toBe('quarantine');
  }
});
it('a Python loop never exempts another launcher on the same line', () => {
  expect(scanSkillFirewall(fixture('for i, sh in enumerate("/bin/bash -- ../payload.txt"):', 'run.py')).verdict).toBe('quarantine');
});
it.each(['${bash -- ../payload.txt}', 'secret', 'const style = `2px solid`;'])('inert script control %s is retained', body => {
  expect(scanSkillFirewall(fixture(body, 'run.js')).verdict).toBe('allow');
});
it('tool frontmatter is not converted into a command across its separator', () => {
  expect(scanSkillFirewall(fixture('Helper.\n')).verdict).toBe('allow');
  const dir = fixture('Helper.'); fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: probe\ntools: Read, Bash\n---\nHelper.');
  expect(scanSkillFirewall(dir).verdict).toBe('allow');
});

it('extended decoding still refuses previously unseen obfuscated launchers', () => {
  vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', 'true');
  const fw = scanSkillFirewall(fixture('bash<!-- marker --> -e ../payload.txt', 'run.sh'));
  expect(fw.verdict).toBe('quarantine');
  expect(fw.findings).toContainEqual(expect.objectContaining({ pattern: 'shell-interpreter', severity: 'high' }));
});
