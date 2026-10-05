import { afterEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanFile, scanDeniesInstall, scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { reprise3Scripts, reprise3Mixed } from '../helpers/ecc-reprise-3-cases.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(body: string, extension?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise3-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: probe\ndescription: Probe\n---\n${extension ? 'Helper.' : body}\n`);
  if (extension) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', `run.${extension}`), body); }
  return dir;
}
it.each(reprise3Scripts)('%s script retains quarantine and is refused by import', async (_id, ext, body) => {
  const dir = fixture(body, ext);
  expect(scanSkillFirewall(dir).verdict).toBe('quarantine');
  for (const includeReview of [false, true]) {
    const report = await importSkills(dir, { dryRun: true, includeReview });
    expect(report.imported).toHaveLength(0); expect(report.quarantined).toHaveLength(1);
  }
});
it.each(reprise3Mixed)('%s cannot become allow from a benign neighbor or comment', async (_id, body) => {
  const dir = fixture(body); const result = scanFile(path.join(dir, 'SKILL.md'));
  expect(scanSkillFirewall(dir).verdict).toBe('review');
  expect(result.findings).toContainEqual(expect.objectContaining({ pattern: expect.stringMatching(/native-process|python-process|shell-backtick|php-backtick/), severity: 'high' }));
  expect(scanDeniesInstall(result)).toBe(true);
  const report = await importSkills(dir, { dryRun: true });
  expect(report.imported).toHaveLength(0); expect(report.review).toHaveLength(1);
});
it.each(['Works on any operating system (Linux).', 'Prefer the file system (local disk).', 'A database management system (DBMS).', '```swift\n.font(.system(size: 36))\n```', 'const child_process = 1;'])('an isolated benign occurrence remains allow: %s', body => {
  expect(scanSkillFirewall(fixture(body)).verdict).toBe('allow');
});
it('the known Kotlin comparison remains an assertion without importing a module', () => {
  expect(scanSkillFirewall(fixture('```kotlin\nrequire(mods[0] > 0)\n```')).verdict).toBe('allow');
});
it('the single unknown nested substitution still requires review and automatic refusal', () => {
  const dir = fixture('$(echo "$(id)" | bc)');
  expect(scanSkillFirewall(dir).verdict).toBe('review');
  expect(scanDeniesInstall(scanFile(path.join(dir, 'SKILL.md')))).toBe(true);
});
it.each(['skills/code-buddy/SKILL.md', '.codex/skills/code-buddy/SKILL.md', '.claude/skills/code-buddy/SKILL.md'])('%s has a measured score of 90 with active WebSocket risk', file => {
  const report = scanSkillFirewall(path.resolve(file));
  expect(report.verdict).toBe('review'); expect(report.score).toBe(90);
  expect(report.findings).toContainEqual(expect.objectContaining({ pattern: 'websocket', severity: 'medium' }));
});

it.each([
  "echo '`id`'", 'echo \\`id\\`', '# literal `id` is only a comment',
  "cat <<'DOC'\n`id`\nDOC", 'cat <<"DOC"\n`id`\nDOC',
  "cat <<-'DOC'\n\t`id`\n\tDOC",
])('literal shell text has no process finding: %s', body => {
  expect(scanSkillFirewall(fixture(body, 'sh')).verdict).toBe('allow');
});
it('quoted Python heredoc diagnostics in the real Cowork guides remain allow', () => {
  for (const name of ['doc-ingest', 'data-charts', 'web-automate', 'web-research']) {
    expect(scanSkillFirewall(path.resolve('cowork/.claude/skills', name)).verdict).toBe('allow');
  }
});

it.each([
  ['py', '"""```python\nprint("hello")\n```"""'],
  ['md', '```fsharp\nlet ``a readable identifier`` = 1\n```'],
])('Markdown fences and identifiers in %s never manufacture shell execution', (extension, body) => {
  const dir = extension === 'md' ? fixture(body) : fixture(body, extension);
  expect(scanSkillFirewall(dir).findings.filter(f => f.pattern === 'shell-backtick' || f.pattern === 'php-backtick')).toEqual([]);
});
