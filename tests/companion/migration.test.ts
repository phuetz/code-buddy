import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { refreshCompanionContinuity } from '../../src/companion/continuity.js';
import {
  exportCompanionMigration,
  restoreCompanionMigration,
} from '../../src/companion/migration.js';

const temporaryDirectories: string[] = [];
const passphrase = 'a-long-test-recovery-secret-1234';

function fixture(label: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `codebuddy-migration-${label}-`));
  temporaryDirectories.push(root);
  const cwd = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  const manifestPath = path.join(homeDir, '.codebuddy', 'companion', 'continuity.json');
  fs.mkdirSync(path.join(cwd, '.codebuddy', 'companion'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.codebuddy', 'companion'), { recursive: true });
  return { cwd, homeDir, manifestPath, humanName: 'Patrice' };
}

function initializeSource() {
  const options = fixture('source');
  fs.writeFileSync(path.join(options.cwd, '.codebuddy', 'SOUL.md'), '# Lisa Companion\n\nTruthful and warm');
  fs.writeFileSync(path.join(options.cwd, '.codebuddy', 'BOOT.md'), 'Preserve agency and continuity');
  fs.writeFileSync(path.join(options.cwd, '.codebuddy', 'CODEBUDDY_MEMORY.md'), 'A reviewed memory');
  fs.writeFileSync(path.join(options.cwd, '.codebuddy', 'companion', 'percepts.jsonl'), '{"safe":true}\n');
  fs.writeFileSync(
    path.join(options.homeDir, '.codebuddy', 'companion', 'relationship-state.json'),
    JSON.stringify({ firstSeenAt: 1, celebratedMilestones: [] }),
  );
  refreshCompanionContinuity(options);
  return options;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('companion migration', () => {
  it('exports no sensitive plaintext and verifies through a dry run', () => {
    const source = initializeSource();
    const bundlePath = path.join(source.cwd, 'lisa.cbm');
    const exported = exportCompanionMigration({ ...source, passphrase, bundlePath });
    const raw = fs.readFileSync(bundlePath, 'utf8');

    expect(exported.companionName).toBe('Lisa');
    expect(exported.artifactCount).toBe(6);
    expect(raw).not.toContain('A reviewed memory');
    expect(raw).not.toContain('Truthful and warm');

    const target = fixture('target');
    const verification = restoreCompanionMigration({
      ...target,
      passphrase,
      bundlePath,
    });
    expect(verification.valid).toBe(true);
    expect(verification.applied).toBe(false);
    expect(verification.planned).toHaveLength(6);
    expect(fs.existsSync(path.join(target.cwd, '.codebuddy', 'SOUL.md'))).toBe(false);
  });

  it('restores the same verified lineage on a clean destination', () => {
    const source = initializeSource();
    const bundlePath = path.join(source.cwd, 'lisa.cbm');
    const exported = exportCompanionMigration({ ...source, passphrase, bundlePath });
    const target = fixture('target');

    const restored = restoreCompanionMigration({
      ...target,
      passphrase,
      bundlePath,
      apply: true,
    });

    expect(restored.valid).toBe(true);
    expect(restored.applied).toBe(true);
    expect(restored.lineageId).toBe(exported.lineageId);
    expect(fs.readFileSync(path.join(target.cwd, '.codebuddy', 'SOUL.md'), 'utf8')).toContain('Lisa Companion');
    expect(fs.readFileSync(target.manifestPath, 'utf8')).toContain(exported.lineageId);
  });

  it('rejects a wrong key or tampered ciphertext', () => {
    const source = initializeSource();
    const bundlePath = path.join(source.cwd, 'lisa.cbm');
    exportCompanionMigration({ ...source, passphrase, bundlePath });

    const target = fixture('target');
    const wrongKey = restoreCompanionMigration({
      ...target,
      passphrase: 'another-long-but-incorrect-secret',
      bundlePath,
    });
    expect(wrongKey.valid).toBe(false);

    const envelope = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    fs.writeFileSync(bundlePath, JSON.stringify(envelope));
    const tampered = restoreCompanionMigration({ ...target, passphrase, bundlePath });
    expect(tampered.valid).toBe(false);
  });

  it('requires an explicit overwrite when destination memories differ', () => {
    const source = initializeSource();
    const bundlePath = path.join(source.cwd, 'lisa.cbm');
    exportCompanionMigration({ ...source, passphrase, bundlePath });
    const target = fixture('target');
    const targetSoul = path.join(target.cwd, '.codebuddy', 'SOUL.md');
    fs.writeFileSync(targetSoul, '# Another identity');

    const refused = restoreCompanionMigration({
      ...target,
      passphrase,
      bundlePath,
      apply: true,
    });
    expect(refused.valid).toBe(true);
    expect(refused.applied).toBe(false);
    expect(refused.conflicts).toContain('identity-soul');
    expect(fs.readFileSync(targetSoul, 'utf8')).toBe('# Another identity');

    const accepted = restoreCompanionMigration({
      ...target,
      passphrase,
      bundlePath,
      apply: true,
      overwrite: true,
    });
    expect(accepted.applied).toBe(true);
    expect(fs.readFileSync(targetSoul, 'utf8')).toContain('Lisa Companion');
  });
});
