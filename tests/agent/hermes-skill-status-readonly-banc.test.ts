import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHermesSkillPackageSummary } from '../../src/agent/hermes-skill-package-summary.js';
import { SkillsHub } from '../../src/skills/hub.js';

let tempDir: string;
function skillContent(name: string, version: string, body: string): string {
  return ['---', `name: ${name}`, `version: ${version}`, `description: ${name} test skill`,
    '---', '', `# ${name}`, '', body].join('\n');
}
beforeEach(async () => { tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-status-readonly-')); });
afterEach(async () => { await fs.rm(tempDir, { recursive: true, force: true }); });

describe('statut Hermes sans écriture dans le projet', () => {
  it('consulte un projet vide sans créer de métadonnées', async () => {
    const summary = buildHermesSkillPackageSummary(tempDir);
    expect(summary.installedCount).toBe(0);
    expect(summary.health.ok).toBe(true);
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('consulte les skills installés sans recréer un cache absent', async () => {
    const cacheDir = path.join(tempDir, '.codebuddy', 'skills-cache');
    const lockfilePath = path.join(tempDir, '.codebuddy', 'skills-lock.json');
    const hub = new SkillsHub({ cacheDir, lockfilePath,
      skillsDir: path.join(tempDir, '.codebuddy', 'skills') });
    await hub.installFromContent('inspection-helper',
      skillContent('inspection-helper', '1.0.0', 'Inspect the repository.'));
    await fs.rm(cacheDir, { recursive: true });
    const before = await fs.readFile(lockfilePath, 'utf8');

    const summary = buildHermesSkillPackageSummary(tempDir);
    expect(summary.installedCount).toBe(1);
    expect(summary.packages[0]).toMatchObject({ name: 'inspection-helper', integrityOk: true });
    expect(await fs.readFile(lockfilePath, 'utf8')).toBe(before);
    await expect(fs.access(cacheDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

});
