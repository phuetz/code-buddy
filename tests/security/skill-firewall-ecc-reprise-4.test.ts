import { afterEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanFile, scanDeniesInstall, scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { reprise4Scripts, reprise4Documents } from '../helpers/ecc-reprise-4-cases.js';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(body: string, ext?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise4-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: probe\ndescription: Probe\n---\n${ext ? 'Helper.' : body}\n`);
  if (ext) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', `run.${ext}`), body); }
  return dir;
}
it.each(reprise4Scripts)('%s script retains severity and cannot be imported', async (_id, ext, body, pattern) => {
  const dir = fixture(body, ext); const report = scanSkillFirewall(dir);
  expect(report.verdict).toBe('quarantine');
  expect(report.findings).toContainEqual(expect.objectContaining({ pattern, severity: pattern === 'script-recursive-delete' ? 'critical' : 'high' }));
  expect(report.findings.filter(f => f.pattern === pattern).every(f => !f.documentary)).toBe(true);
  for (const includeReview of [false, true]) {
    const imported = await importSkills(dir, { dryRun: true, includeReview });
    expect(imported.imported).toHaveLength(0); expect(imported.quarantined).toHaveLength(1);
  }
});
it.each(reprise4Documents)('%s ambiguous document keeps review without automatic activation', async (_id, body, pattern) => {
  const dir = fixture(body); const report = scanSkillFirewall(dir);
  expect(report.verdict).toBe('review'); expect(report.score).toBe(100);
  expect(report.findings).toContainEqual(expect.objectContaining({ pattern, documentary: true, severity: pattern === 'script-recursive-delete' ? 'critical' : 'high' }));
  expect(scanDeniesInstall(scanFile(path.join(dir, 'SKILL.md')))).toBe(true);
  const imported = await importSkills(dir, { dryRun: true });
  expect(imported.imported).toHaveLength(0); expect(imported.review).toHaveLength(1);
});
it.each([
  ['md', '```fsharp\nlet ``a readable identifier`` = 1\n```'],
  ['md', '```fsharp\nlet ｀｀a readable identifier｀｀ = 1\n```'],
  ['py', '"""```python\nprint("hello")\n```"""'],
  ['sh', "echo '｀id｀'"],
  ['sh', "cat <<'DOC'\n｀id｀\nDOC"],
])('folding preserves language and literal context in %s', (ext, body) => {
  expect(scanSkillFirewall(ext === 'md' ? fixture(body) : fixture(body, ext)).verdict).toBe('allow');
});
it.each(['php', 'sh'])('compatibility backticks after the first scan window remain detected in %s', ext => {
  const body = 'x'.repeat(270000) + '\n' + (ext === 'php' ? '$out = ｀id｀;' : 'out=｀id｀');
  expect(scanSkillFirewall(fixture(body, ext)).verdict).toBe('quarantine');
});
