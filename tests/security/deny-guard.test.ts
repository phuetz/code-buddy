/**
 * User deny rules (Hermes parity: block even under YOLO) — real store file,
 * real pattern matcher, wired through the REAL shared command validator that
 * both bash paths (buffered + streaming) run unconditionally.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkUserDenyRules, resetDenyGuardCache } from '../../src/security/bash-allowlist/deny-guard.js';
import { validateCommand } from '../../src/tools/bash/command-validator.js';

let home: string;

function writeStore(patterns: unknown[]): void {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'exec-approvals.json'), JSON.stringify({ patterns }), 'utf-8');
  resetDenyGuardCache();
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'deny-guard-'));
  process.env.CODEBUDDY_HOME = home;
  resetDenyGuardCache();
});

afterEach(() => {
  delete process.env.CODEBUDDY_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  resetDenyGuardCache();
});

describe('checkUserDenyRules', () => {
  it('denies on an enabled deny pattern (prefix)', () => {
    writeStore([
      { id: '1', pattern: 'git push --force', type: 'prefix', decision: 'deny', enabled: true, description: 'jamais de force-push' },
    ]);
    expect(checkUserDenyRules('git push --force origin main')).toMatchObject({
      denied: true,
      pattern: 'git push --force',
      description: 'jamais de force-push',
    });
    expect(checkUserDenyRules('git push origin main').denied).toBe(false);
  });

  it('ignores disabled patterns, allow patterns and a missing store', () => {
    writeStore([
      { id: '1', pattern: 'rm -rf', type: 'prefix', decision: 'deny', enabled: false },
      { id: '2', pattern: 'npm test', type: 'prefix', decision: 'allow', enabled: true },
    ]);
    expect(checkUserDenyRules('rm -rf /tmp/x').denied).toBe(false);
    expect(checkUserDenyRules('npm test').denied).toBe(false);
    fs.rmSync(path.join(home, 'exec-approvals.json'));
    resetDenyGuardCache();
    expect(checkUserDenyRules('anything').denied).toBe(false);
  });

  it('fails open on a corrupt store', () => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'exec-approvals.json'), '{not json', 'utf-8');
    resetDenyGuardCache();
    expect(checkUserDenyRules('ls').denied).toBe(false);
  });

  it('picks up store edits without a restart (mtime reload)', () => {
    writeStore([]);
    expect(checkUserDenyRules('docker system prune').denied).toBe(false);
    // Ensure a different mtime even on coarse filesystems.
    const file = path.join(home, 'exec-approvals.json');
    fs.writeFileSync(file, JSON.stringify({ patterns: [
      { id: '1', pattern: 'docker system prune', type: 'prefix', decision: 'deny', enabled: true },
    ] }), 'utf-8');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(checkUserDenyRules('docker system prune -af').denied).toBe(true);
  });

  it('applies cwd-scoped deny rules only inside their project', () => {
    const projectA = path.join(home, 'project-a');
    const projectB = path.join(home, 'project-b');
    writeStore([
      {
        id: 'scoped',
        pattern: 'custom-deploy',
        type: 'prefix',
        decision: 'deny',
        enabled: true,
        cwd: projectA,
      },
    ]);

    expect(checkUserDenyRules('custom-deploy production', projectA).denied).toBe(true);
    expect(checkUserDenyRules('custom-deploy production', projectB).denied).toBe(false);
  });
});

describe('validateCommand integration (the seam both bash paths run)', () => {
  it('a user deny rule is a hard validation failure with an actionable reason', () => {
    writeStore([
      { id: '1', pattern: 'git push --force', type: 'prefix', decision: 'deny', enabled: true },
    ]);
    const verdict = validateCommand('git push --force origin main');
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('Blocked by user deny rule');
    expect(verdict.reason).toContain('/allowlist');
  });

  it('normal commands still pass validation', () => {
    writeStore([]);
    expect(validateCommand('echo hello').valid).toBe(true);
  });
});
