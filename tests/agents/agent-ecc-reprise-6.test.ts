import { afterEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { importAgents } from '../../src/skills/agent-importer.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
it.each(['/bin/bash ../payload.txt', '/usr/bin/bash ../payload.txt', 'ｂａｓｈ ../payload.txt', '$(bash ../payload.txt)', 'spawn("rm", ["-rf", "/"])', 'const secret = `REAL_SECRET`;'])('dangerous agent %s is quarantined rather than staged', body => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agent5-')); dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'agents'));
  fs.writeFileSync(path.join(dir, 'agents/probe.md'), `---\nname: probe\ntools: Read, Bash\n---\n${body}\n`);
  for (const dryRun of [true, false]) {
    const destRoot = path.join(dir, 'staged'); const report = importAgents(dir, { source: 'fixture', dryRun, destRoot });
    expect(report.quarantined).toHaveLength(1); expect(report.review).toHaveLength(0);
    expect(fs.existsSync(destRoot)).toBe(false);
  }
});

it.each(['Use Bash only for read-only inspection commands.', 'Reject or flag any Bash command that attempts file mutations.'])('an agent mentioning the Bash tool %s stays disabled in review', body => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agent6-doc-')); dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'agents'));
  fs.writeFileSync(path.join(dir, 'agents/probe.md'), `---\nname: probe\ntools: Read, Bash\n---\n${body}\n`);
  const destRoot = path.join(dir, 'staged'); const report = importAgents(dir, { source: 'fixture', dryRun: false, destRoot });
  expect(report.quarantined).toHaveLength(0); expect(report.review).toHaveLength(1);
  expect(fs.readFileSync(report.review[0]!.destination!, 'utf8')).toContain('disabled: true');
});
