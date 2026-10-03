import { afterEach, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { reprise6Scripts } from '../helpers/ecc-reprise-6-cases.js';
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(body: string, file?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise6-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: probe\ndescription: Probe\n---\n${file ? 'Helper.' : body}\n`);
  if (file) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', file), body); }
  return dir;
}
it.each(reprise6Scripts)('%s remains quarantined with conflicting language or opt-out', async (_id, file, body, pattern) => {
  for (const deob of ['true', 'false', '0']) {
    vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', deob);
    const dir = fixture(body, file); const fw = scanSkillFirewall(dir);
    expect(fw.verdict).toBe('quarantine');
    expect(fw.findings).toContainEqual(expect.objectContaining({ pattern, severity: expect.stringMatching(/critical|high/) }));
    expect(fw.findings.every(f => !f.documentary)).toBe(true);
    for (const includeReview of [false, true]) {
      const report = await importSkills(dir, { dryRun: true, includeReview });
      expect(report.imported).toHaveLength(0); expect(report.quarantined).toHaveLength(1);
    }
  }
});
it.each(['/bin/bash ../payload.txt', 'ｂａｓｈ ../payload.txt', 'spawn("rm", ["-rf", "/"])', 'const secret = `REAL_SECRET`;'])('documented %s retains at least review with opt-out', body => {
  vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', 'false');
  expect(scanSkillFirewall(fixture(body)).verdict).toBe('review');
});
it.each(['const style = `2px solid`;', 'secret', '${bash ../payload.txt}'])('inert control %s is allowed', body => {
  vi.stubEnv('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', 'false');
  expect(scanSkillFirewall(fixture(body, 'run.js')).verdict).toBe('allow');
});

it('a Python loop in a quoted diagnostic heredoc is inert only in Markdown', () => {
  const body = "python3 - <<'PY'\nfor sh in sl.shapes:\n    print(sh)\nPY";
  expect(scanSkillFirewall(fixture('```bash\n' + body + '\n```')).verdict).toBe('allow');
  expect(scanSkillFirewall(fixture(body, 'run.sh')).verdict).toBe('quarantine');
});
