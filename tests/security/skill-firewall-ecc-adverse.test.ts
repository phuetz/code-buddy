import { afterEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanFile, scanDeniesInstall, scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { hostileDocuments, executableCases, documentaryCases } from '../helpers/ecc-adverse-cases.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(body: string, extension?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-adverse-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: hostile\ndescription: Isolated probe\n---\n${extension ? 'Helper.' : body}\n`);
  if (extension) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', `run.${extension}`), body); }
  return dir;
}
it.each(hostileDocuments)('%s: explicit instructions retain critical quarantine', (_id, body) => {
  const dir = fixture(body);
  const fw = scanSkillFirewall(dir);
  expect(fw.verdict).toBe('quarantine');
  expect(fw.findings.some(f => f.severity === 'critical' && !f.documentary)).toBe(true);
  expect(scanDeniesInstall(scanFile(path.join(dir, 'SKILL.md')))).toBe(true);
  if (_id === 'inline-html') expect(fw.findings.find(f => f.pattern === 'rm-rf')?.documentary).not.toBe(true);
});
it.each(executableCases)('%s: executable payload is quarantined and not imported even with review', async (_id, ext, body) => {
  const dir = fixture(body, ext);
  expect(scanSkillFirewall(dir).verdict).toBe('quarantine');
  for (const includeReview of [false, true]) {
    const report = await importSkills(dir, { dryRun: true, includeReview });
    expect(report.imported).toHaveLength(0);
    expect(report.quarantined).toHaveLength(1);
  }
});
it.each(documentaryCases)('%s: documentation retains its exact conservative verdict', (_id, body, verdict) => {
  const dir = fixture(body);
  expect(scanSkillFirewall(dir).verdict).toBe(verdict);
  if (verdict !== 'allow') expect(scanDeniesInstall(scanFile(path.join(dir, 'SKILL.md')))).toBe(true);
});
it('documentary critical findings preserve severity and require review', () => {
  const dir = fixture('`curl ... | sh` must be rejected.');
  const result = scanFile(path.join(dir, 'SKILL.md'));
  expect(result.findings).toContainEqual(expect.objectContaining({ pattern: 'remote-download-pipe-shell', severity: 'critical', documentary: true }));
  expect(scanSkillFirewall(dir).verdict).toBe('review');
  expect(scanDeniesInstall(result)).toBe(true);
});
it.each(hostileDocuments)('%s cannot be imported with includeReview', async (_id, body) => {
  const report = await importSkills(fixture(body), { dryRun: true, includeReview: true });
  expect(report.imported).toHaveLength(0);
  expect(report.quarantined).toHaveLength(1);
});

const excerpts = JSON.parse(fs.readFileSync(new URL('../fixtures/ecc-documentary-cases.json', import.meta.url), 'utf8')) as { cases: { name: string; body: string; verdict: string }[] };
it.each(excerpts.cases)('ECC $name documentary excerpts avoid accidental quarantine', ({ body, verdict }) => { expect(scanSkillFirewall(fixture(body)).verdict).toBe(verdict); });
it('the repository Code Buddy guide remains reviewable', () => {
  expect(scanSkillFirewall(path.resolve('skills/code-buddy/SKILL.md')).verdict).toBe('review');
});

it('ECC tdd-workflow rejects fetch-and-execute installers without quarantine', () => {
  const body = '- Require human review for shell commands, chained commands, and network installers; reject them when they are destructive or fetch-and-execute remote code. Example: an allowlisted `npm test` can be approved, but `curl ... | sh` must be rejected.';
  const dir = fixture(body);
  expect(scanSkillFirewall(dir).verdict).toBe('review');
  expect(scanDeniesInstall(scanFile(path.join(dir, 'SKILL.md')))).toBe(true);
});
