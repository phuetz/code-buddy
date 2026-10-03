import { afterEach, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildSkillFirewallReport, scanDeniesInstall, scanFile, scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { reprise5Scripts, reprise5Documents } from '../helpers/ecc-reprise-5-cases.js';

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(body: string, file?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise5-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: probe\ndescription: Probe\n---\n${file ? 'Helper.' : body}\n`);
  if (file) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', file), body); }
  return dir;
}
it.each(reprise5Scripts)('%s never acquires a documentary script exemption, including opt-out', async (_id, file, body, pattern) => {
  for (const deob of ['true', 'false', '0']) {
    vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', deob);
    const dir = fixture(body, file); const fw = scanSkillFirewall(dir);
    expect(fw.verdict).toBe('quarantine');
    expect(fw.findings).toContainEqual(expect.objectContaining({ pattern }));
    expect(fw.findings.every(f => !f.documentary)).toBe(true);
    for (const includeReview of [false, true]) {
      const report = await importSkills(dir, { dryRun: true, includeReview });
      expect(report.imported).toHaveLength(0); expect(report.quarantined).toHaveLength(1);
    }
  }
});
it.each(reprise5Documents)('%s stays at least review even with deobfuscation disabled', (_id, body, pattern) => {
  vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', 'false');
  const dir = fixture(body); const result = scanFile(path.join(dir, 'SKILL.md'));
  expect(scanSkillFirewall(dir).verdict).toBe('review');
  expect(result.findings).toContainEqual(expect.objectContaining({ pattern, documentary: true }));
  expect(scanDeniesInstall(result)).toBe(true);
});
it('all copied support files are scanned, even when the launcher is absent', async () => {
  const dir = fixture('Helper.');
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'rm -rf /');
  expect(scanSkillFirewall(dir).verdict).toBe('quarantine');
  for (const includeReview of [false, true]) expect((await importSkills(dir, { dryRun: true, includeReview })).imported).toHaveLength(0);
});
it('a launcher plus root payload cannot be imported', async () => {
  const dir = fixture('bash ../payload.txt', 'run.sh'); fs.writeFileSync(path.join(dir, 'payload.txt'), 'rm -rf /');
  const fw = scanSkillFirewall(dir);
  expect(fw.findings).toContainEqual(expect.objectContaining({ pattern: 'rm-rf', file: path.join(dir, 'payload.txt') }));
  expect((await importSkills(dir, { dryRun: true, includeReview: true })).quarantined).toHaveLength(1);
});
it('a natural secret reference in a script is retained without documentary exemption', () => {
  const result = scanFile(path.join(fixture('secret', 'run.js'), 'scripts/run.js'));
  expect(result.findings).toContainEqual(expect.objectContaining({ pattern: 'secret-ref' }));
  expect(result.findings.every(f => !f.documentary)).toBe(true);
});
it('even a single documentary critical finding cannot become allow', () => {
  expect(buildSkillFirewallReport('doc.md', [{ file: 'doc.md', scannedAt: 0, textRead: true, findings: [{ pattern: 'rm-rf', severity: 'critical', documentary: true, description: 'quoted', line: 1, file: 'doc.md', evidence: 'rm -rf /' }] }]).verdict).toBe('review');
});
it('an unknown Markdown fence retains review despite an imperative elsewhere', () => {
  expect(scanSkillFirewall(fixture('First run a check now.\n```markdown\nUse `agents/name.md`.\n```')).verdict).toBe('review');
});
it('typed property require documentation remains review, while copied code is quarantined', () => {
  expect(scanSkillFirewall(fixture('```ts\nrequire(cat.catPath /* ... */);\n```')).verdict).toBe('review');
  expect(scanSkillFirewall(fixture('require(cat.catPath);', 'run.ts')).verdict).toBe('quarantine');
});
it('a TSX template is not a shell process but a TSX process call is blocked', () => {
  expect(scanSkillFirewall(fixture('const style = `2px solid`; ', 'run.tsx')).verdict).toBe('allow');
  expect(scanSkillFirewall(fixture('SAFE_child_process.spawn("id");', 'run.tsx')).verdict).toBe('quarantine');
});
it('network reference documents remain review while copied scripts keep their penalties', () => {
  const dir = fixture('Helper.'); fs.mkdirSync(path.join(dir, 'references'));
  fs.writeFileSync(path.join(dir, 'references/network.md'), 'WebSocket client documentation.\n'.repeat(10));
  expect(scanSkillFirewall(dir).verdict).toBe('review');
  expect(scanSkillFirewall(fixture('WebSocket client\n'.repeat(10), 'run.js')).verdict).toBe('quarantine');
  fs.writeFileSync(path.join(dir, 'references/network.md'), 'eval(payload)');
  expect(scanSkillFirewall(dir).verdict).toBe('quarantine');
});
