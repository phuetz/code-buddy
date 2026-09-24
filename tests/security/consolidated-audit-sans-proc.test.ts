/**
 * `buddy security audit --fix` on a system without `/proc` (macOS).
 *
 * The CI failure of 2026-09-24 on macOS (`fixed.passed` false in
 * consolidated-audit.test.ts) came from `fdInside()` resolving only
 * `/proc/self/fd/<n>`, which does not exist there: every fix was refused as
 * "open file is outside the audited roots". Here `/proc` is made unreachable
 * so a Linux runner exercises the same path.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ procLookups: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const realpathSync = Object.assign(
    (target: Parameters<typeof actual.realpathSync>[0], options?: Parameters<typeof actual.realpathSync>[1]) => {
      if (String(target).startsWith('/proc/')) {
        probe.procLookups += 1;
        throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${String(target)}'`), { code: 'ENOENT' });
      }
      return actual.realpathSync(target, options);
    },
    { native: actual.realpathSync.native },
  );
  return { ...actual, default: { ...actual, realpathSync }, realpathSync };
});

const { runConsolidatedSecurityAudit } = await import('../../src/security/consolidated-audit.js');

const dirs: string[] = [];

function workspace(): { profile: string; project: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'security-audit-noproc-'));
  dirs.push(root);
  const profile = path.join(root, 'profile');
  const project = path.join(root, 'project');
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  mkdirSync(project, { recursive: true, mode: 0o700 });
  chmodSync(profile, 0o700);
  chmodSync(project, 0o700);
  return { profile, project };
}

afterEach(() => {
  probe.procLookups = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const sandboxReady = { recommended: 'bwrap' as const, reason: 'injected' };
const itPosix = it.skipIf(process.platform === 'win32');

describe('buddy security audit --fix without /proc', () => {
  itPosix('tightens loose modes on darwin, where /proc/self/fd does not exist', () => {
    const { profile, project } = workspace();
    const body = 'model = "demo"\n';
    writeFileSync(path.join(profile, 'config.toml'), body, { mode: 0o600 });
    chmodSync(path.join(profile, 'config.toml'), 0o644);
    chmodSync(profile, 0o707);

    const fixed = runConsolidatedSecurityAudit({
      profileDir: profile,
      projectDir: project,
      env: {},
      sandbox: sandboxReady,
      platform: 'darwin',
      fix: true,
      now: new Date('2026-09-23T12:00:00.000Z'),
    });

    expect(fixed.fixes.map((item) => `${item.subject}: ${item.message}`)).toEqual([
      '.: mode 707 -> 705',
      'config.toml: mode 644 -> 600',
    ]);
    expect(fixed.passed).toBe(true);
    expect(statSync(profile).mode & 0o777).toBe(0o705);
    expect(statSync(path.join(profile, 'config.toml')).mode & 0o777).toBe(0o600);
    expect(readFileSync(path.join(profile, 'config.toml'), 'utf8')).toBe(body);
    const manifest = readFileSync(path.join(profile, 'security-audit-backups', '2026-09-23T12-00-00-000Z', 'manifest.json'), 'utf8');
    expect(manifest).toContain('"modeBefore": "707"');
    expect(manifest).toContain('"modeBefore": "644"');
    expect(probe.procLookups).toBe(0);
  });

  it.skipIf(process.platform !== 'linux')('stays fail-closed on linux when /proc/self/fd cannot be read', () => {
    const { profile, project } = workspace();
    writeFileSync(path.join(profile, 'config.toml'), 'model = "demo"\n', { mode: 0o600 });
    chmodSync(path.join(profile, 'config.toml'), 0o644);

    const refused = runConsolidatedSecurityAudit({
      profileDir: profile,
      projectDir: project,
      env: {},
      sandbox: sandboxReady,
      fix: true,
      now: new Date('2026-09-23T12:00:00.000Z'),
    });

    expect(probe.procLookups).toBeGreaterThan(0);
    expect(refused.passed).toBe(false);
    expect(refused.fixes.map((item) => item.message)).toEqual(['open file is outside the audited roots']);
    expect(statSync(path.join(profile, 'config.toml')).mode & 0o777).toBe(0o644);
  });
});
