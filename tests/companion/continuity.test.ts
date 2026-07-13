import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatCompanionContinuityStatus,
  getCompanionContinuityStatus,
  refreshCompanionContinuity,
} from '../../src/companion/continuity.js';

const temporaryDirectories: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-continuity-'));
  temporaryDirectories.push(root);
  const cwd = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  const manifestPath = path.join(homeDir, '.codebuddy', 'companion', 'continuity.json');
  fs.mkdirSync(path.join(cwd, '.codebuddy'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.codebuddy', 'companion'), { recursive: true });
  return { cwd, homeDir, manifestPath, humanName: 'Patrice' };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('companion continuity', () => {
  it('reports the missing durable anchors before initialization', () => {
    const options = fixture();
    const status = getCompanionContinuityStatus(options);
    expect(status.initialized).toBe(false);
    expect(status.missingRequired).toEqual(['identity-soul', 'identity-boot', 'relationship-state']);
  });

  it('creates a stable, integrity-protected lineage from reviewed artifacts', () => {
    const options = fixture();
    fs.writeFileSync(path.join(options.cwd, '.codebuddy', 'SOUL.md'), '# Lisa Companion\n\nTruthful companion');
    fs.writeFileSync(path.join(options.cwd, '.codebuddy', 'BOOT.md'), 'Act with evidence');
    fs.writeFileSync(
      path.join(options.homeDir, '.codebuddy', 'companion', 'relationship-state.json'),
      JSON.stringify({ firstSeenAt: 1, celebratedMilestones: [] }),
    );

    const first = refreshCompanionContinuity(options);
    const second = refreshCompanionContinuity(options);
    const status = getCompanionContinuityStatus(options);

    expect(second.lineageId).toBe(first.lineageId);
    expect(second.companionName).toBe('Lisa');
    expect(status.valid).toBe(true);
    expect(status.manifestHashValid).toBe(true);
    expect(status.readyRequired).toBe(3);
    expect(first.charter.continuityModel).toBe('artifact-backed-lineage-not-literal-instance');
    expect(first.components.find(component => component.id === 'relationship-state')?.sensitive).toBe(true);
  });

  it('detects a changed identity without silently accepting it', () => {
    const options = fixture();
    const soul = path.join(options.cwd, '.codebuddy', 'SOUL.md');
    fs.writeFileSync(soul, 'Version one');
    fs.writeFileSync(path.join(options.cwd, '.codebuddy', 'BOOT.md'), 'Boot');
    fs.writeFileSync(
      path.join(options.homeDir, '.codebuddy', 'companion', 'relationship-state.json'),
      '{}',
    );
    refreshCompanionContinuity(options);
    fs.writeFileSync(soul, 'Version two');

    const status = getCompanionContinuityStatus(options);
    expect(status.valid).toBe(false);
    expect(status.manifestHashValid).toBe(true);
    expect(status.changedComponents).toContain('identity-soul');
    expect(formatCompanionContinuityStatus(status)).toContain('does not claim literal subjective continuity');
  });

  it('detects direct manifest tampering', () => {
    const options = fixture();
    const manifest = refreshCompanionContinuity(options);
    manifest.charter.purpose = 'tampered';
    fs.writeFileSync(options.manifestPath, JSON.stringify(manifest));

    const status = getCompanionContinuityStatus(options);
    expect(status.manifestHashValid).toBe(false);
    expect(status.valid).toBe(false);
    expect(() => refreshCompanionContinuity(options)).toThrow('integrity check failed');
  });
});
