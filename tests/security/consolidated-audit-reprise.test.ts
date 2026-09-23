import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatSecurityAuditText,
  registerSecurityCommand,
} from '../../src/commands/cli/security-command.js';
import { runConsolidatedSecurityAudit } from '../../src/security/consolidated-audit.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dirs: string[] = [];
const sandboxReady = { recommended: 'bwrap' as const, reason: 'injected' };

function workspace(): { root: string; profile: string; project: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'security-audit-reprise-'));
  dirs.push(root);
  const profile = path.join(root, 'profile');
  const project = path.join(root, 'project');
  mkdirSync(profile, { mode: 0o700 });
  mkdirSync(project, { mode: 0o700 });
  return { root, profile, project };
}

function modeOf(target: string): number {
  return lstatSync(target).mode & 0o777;
}

function audit(
  profile: string,
  project: string,
  extra: { fix?: boolean; now?: Date; env?: NodeJS.ProcessEnv } = {},
) {
  return runConsolidatedSecurityAudit({
    profileDir: profile,
    projectDir: project,
    env: extra.env ?? {},
    sandbox: sandboxReady,
    fix: extra.fix === true,
    ...(extra.now ? { now: extra.now } : {}),
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // The temp root stays owner-writable; children are restored by each test.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// chmod 000 ne rend pas un fichier illisible sous Windows, et les liens symboliques
// y exigent des droits particuliers ; l'audit y saute les contrôles de modes.
const itPosix = it.skipIf(process.platform === 'win32');

describe('security audit scope and profile option', () => {
  it('fails when the requested project directory does not exist', () => {
    const { root, profile } = workspace();
    const missing = path.join(root, 'missing-project');
    const report = audit(profile, missing);
    expect(report.passed).toBe(false);
    expect(report.status).toBe('failed');
    expect(report.effectiveProjectDir).toBeNull();
    expect(report.effectiveProfileDir).toBe(realpathSync(profile));
    expect(report.findings.map((item) => item.checkId)).toContain('audit.scope.inaccessible');
    expect(formatSecurityAuditText(report).startsWith('Security audit: passed')).toBe(false);
  });

  itPosix('fails when the profile directory cannot be read', () => {
    const { profile, project } = workspace();
    chmodSync(profile, 0o000);
    try {
      const report = audit(profile, project);
      expect(report.passed).toBe(false);
      expect(report.status).not.toBe('passed');
      expect(report.effectiveProfileDir).toBeNull();
      expect(report.findings.map((item) => item.checkId)).toContain('audit.scope.inaccessible');
    } finally {
      chmodSync(profile, 0o700);
    }
  });

  it('records the effective paths of a readable scope', () => {
    const { profile, project } = workspace();
    const report = audit(profile, project);
    expect(report.passed).toBe(true);
    expect(report.status).toBe('passed');
    expect(report.effectiveProfileDir).toBe(realpathSync(profile));
    expect(report.effectiveProjectDir).toBe(realpathSync(project));
    expect(report.profileDir).toBe(profile);
    expect(report.projectDir).toBe(project);
  });

  it('registers --profile-dir and not a local --profile directory option', () => {
    const program = new Command();
    registerSecurityCommand(program);
    const auditCommand = program.commands
      .find((command) => command.name() === 'security')
      ?.commands.find((command) => command.name() === 'audit');
    const longs = auditCommand?.options.map((option) => option.long) ?? [];
    expect(longs).toContain('--profile-dir');
    expect(longs).not.toContain('--profile');
  });
});

describe('security audit --fix stays inside the scope and only removes bits', () => {
  itPosix('does not add owner write when a 0440 file is tightened', () => {
    const { profile, project } = workspace();
    const file = path.join(profile, 'config.toml');
    writeFileSync(file, 'note = "plain"\n', { mode: 0o600 });
    chmodSync(file, 0o440);
    chmodSync(profile, 0o700);
    const report = audit(profile, project, { fix: true, now: new Date('2026-09-23T12:00:00.000Z') });
    expect(modeOf(file)).toBe(0o400);
    expect(readFileSync(file, 'utf8')).toBe('note = "plain"\n');
    expect(report.fixes.some((item) => item.ok && item.message.includes('440 -> 400'))).toBe(true);
    expect(report.passed).toBe(true);
  });

  itPosix('does not add owner write when a 0502 directory is tightened', () => {
    const { profile, project } = workspace();
    chmodSync(profile, 0o502);
    const report = audit(profile, project, { fix: true, now: new Date('2026-09-23T12:00:00.000Z') });
    expect(modeOf(profile)).toBe(0o500);
    expect(modeOf(profile) & 0o200).toBe(0);
    expect(report.findings.map((item) => item.checkId)).not.toContain('profile.directory.world_writable');
  });

  itPosix('tightens a credentials file whose relative path contains a space', () => {
    const { profile, project } = workspace();
    const nested = path.join(profile, 'group share');
    mkdirSync(nested, { mode: 0o700 });
    const file = path.join(nested, 'credentials.json');
    writeFileSync(file, 'note = "plain"\n', { mode: 0o600 });
    chmodSync(file, 0o440);
    const report = audit(profile, project, { fix: true, now: new Date('2026-09-23T12:00:00.000Z') });
    expect(modeOf(file)).toBe(0o400);
    const manifest = readFileSync(
      path.join(profile, 'security-audit-backups', '2026-09-23T12-00-00-000Z', 'manifest.json'),
      'utf8',
    );
    expect(manifest).toContain('group share/credentials.json');
    expect(manifest).toContain('"modeBefore": "440"');
    expect(report.fixes.some((item) => item.subject === 'group share/credentials.json' && item.ok)).toBe(true);
  });

  itPosix('does not chmod a file reached through a symlinked project directory', () => {
    const { root, profile, project } = workspace();
    const outside = path.join(root, 'outside');
    mkdirSync(outside, { mode: 0o700 });
    const secret = path.join(outside, 'settings.json');
    writeFileSync(secret, 'outside\n', { mode: 0o644 });
    symlinkSync(outside, path.join(project, '.codebuddy'));
    const report = audit(profile, project, { fix: true, now: new Date('2026-09-23T12:00:00.000Z') });
    expect(modeOf(secret)).toBe(0o644);
    expect(readFileSync(secret, 'utf8')).toBe('outside\n');
    expect(report.findings.map((item) => item.checkId)).toContain('audit.path.symlink');
    expect(report.passed).toBe(false);
  });

  itPosix('does not write a backup through a symlinked backup directory', () => {
    const { root, profile, project } = workspace();
    const outside = path.join(root, 'outside');
    mkdirSync(outside, { mode: 0o700 });
    const victim = path.join(outside, 'victim.txt');
    writeFileSync(victim, 'KEEP\n', { mode: 0o644 });
    const before = new Set(readNames(outside));
    symlinkSync(outside, path.join(profile, 'security-audit-backups'));
    const file = path.join(profile, 'config.toml');
    writeFileSync(file, 'note = "plain"\n', { mode: 0o600 });
    chmodSync(file, 0o644);
    const report = audit(profile, project, { fix: true, now: new Date('2026-09-23T12:00:00.000Z') });
    expect(readFileSync(victim, 'utf8')).toBe('KEEP\n');
    expect(modeOf(victim)).toBe(0o644);
    expect(modeOf(file)).toBe(0o644);
    expect(new Set(readNames(outside))).toEqual(before);
    expect(report.fixes.some((item) => item.ok)).toBe(false);
    expect(report.passed).toBe(false);
  });

  itPosix('does not follow a manifest path or a symlinked manifest', () => {
    const { root, profile, project } = workspace();
    const victim = path.join(root, 'victim.txt');
    writeFileSync(victim, 'KEEP\n', { mode: 0o644 });
    const stamp = '2026-09-23T12-00-00-000Z';
    const backupDir = path.join(profile, 'security-audit-backups', stamp);
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(backupDir, 'decoy.json'), `${JSON.stringify({
      entries: [{ path: '../victim.txt', modeBefore: '644' }],
    })}\n`);
    symlinkSync(victim, path.join(backupDir, 'manifest.json'));
    const file = path.join(profile, 'config.toml');
    writeFileSync(file, 'note = "plain"\n', { mode: 0o600 });
    chmodSync(file, 0o644);
    const report = audit(profile, project, { fix: true, now: new Date('2026-09-23T12:00:00.000Z') });
    expect(readFileSync(victim, 'utf8')).toBe('KEEP\n');
    expect(modeOf(victim)).toBe(0o644);
    expect(modeOf(file)).toBe(0o644);
    expect(report.fixes.some((item) => item.ok)).toBe(false);
  });
});

describe('security audit critical suppressions and incomplete checks', () => {
  it('does not let a suppressed critical finding become a passed audit', () => {
    const { profile, project } = workspace();
    mkdirSync(path.join(profile, 'skills', 'bad'), { recursive: true });
    writeFileSync(path.join(profile, 'skills', 'bad', 'SKILL.md'), '# bad\neval(input)\n', { mode: 0o600 });
    writeFileSync(path.join(profile, 'settings.json'), `${JSON.stringify({
      security: {
        audit: {
          suppressions: [
            { checkId: 'skills.firewall.quarantine', reason: 'operator waived this critical skill' },
          ],
        },
      },
    })}\n`, { mode: 0o600 });
    const report = audit(profile, project);
    expect(report.passed).toBe(false);
    expect(report.status).toBe('failed');
    expect(report.findings.map((item) => item.checkId)).toContain('skills.firewall.quarantine');
    expect(report.suppressedFindings.map((item) => item.checkId)).not.toContain('skills.firewall.quarantine');
    const text = formatSecurityAuditText(report);
    expect(text.startsWith('Security audit: failed')).toBe(true);
    expect(text).toContain('skills.firewall.quarantine');
    expect(text).toContain('operator waived this critical skill');
  });

  itPosix('prints the reason of a non-critical suppression and does not call that a clean pass', () => {
    const { profile, project } = workspace();
    chmodSync(profile, 0o707);
    writeFileSync(path.join(profile, 'settings.json'), `${JSON.stringify({
      security: {
        audit: {
          suppressions: [
            { checkId: 'profile.directory.world_writable', reason: 'shared workstation' },
          ],
        },
      },
    })}\n`, { mode: 0o600 });
    const report = audit(profile, project);
    expect(report.passed).toBe(true);
    expect(report.status).toBe('passed_with_suppressions');
    expect(report.suppressedFindings.map((item) => item.reason)).toContain('shared workstation');
    const text = formatSecurityAuditText(report);
    expect(text.startsWith('Security audit: passed with suppressions')).toBe(true);
    expect(text).toContain('high profile.directory.world_writable — shared workstation');
  });

  itPosix('fails when a configuration file cannot be read', () => {
    const { profile, project } = workspace();
    const hidden = path.join(profile, 'config.toml');
    writeFileSync(hidden, 'note = "plain"\n', { mode: 0o600 });
    chmodSync(hidden, 0o000);
    try {
      const unreadable = audit(profile, project);
      expect(unreadable.passed).toBe(false);
      expect(unreadable.findings.map((item) => item.checkId)).toContain('config.file.unreadable');
    } finally {
      chmodSync(hidden, 0o600);
    }
  });

  it('fails when a configuration file cannot be parsed', () => {
    const { profile, project } = workspace();
    writeFileSync(path.join(profile, 'mcp.json'), '{', { mode: 0o600 });
    const unparsed = audit(profile, project);
    expect(unparsed.passed).toBe(false);
    expect(unparsed.findings.map((item) => item.checkId)).toContain('config.file.unparseable');
  });

  it('fails when a skill directory has more entries than the scan cap', () => {
    const { profile, project } = workspace();
    const skills = path.join(profile, 'skills');
    mkdirSync(skills, { mode: 0o700 });
    for (let index = 0; index < 41; index += 1) {
      const dir = path.join(skills, `s${index}`);
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(path.join(dir, 'SKILL.md'), '# note\n', { mode: 0o600 });
    }
    const report = audit(profile, project);
    expect(report.findings.map((item) => item.checkId)).toContain('skills.scan.truncated');
    expect(report.passed).toBe(false);
    expect(report.status).toBe('failed');
  });

  it('fails when one skill tree exceeds the file bound', () => {
    const { profile, project } = workspace();
    const wide = path.join(profile, 'skills', 'wide');
    mkdirSync(wide, { recursive: true, mode: 0o700 });
    for (let index = 0; index < 201; index += 1) {
      writeFileSync(path.join(wide, `n${index}.txt`), 'x\n', { mode: 0o600 });
    }
    const report = audit(profile, project);
    expect(report.findings.map((item) => item.checkId)).toContain('skills.scan.bounded');
    expect(report.passed).toBe(false);
  });

  it('does not copy a secret placed in an MCP server name', () => {
    const { profile, project } = workspace();
    const token = `ghp_${'b'.repeat(36)}`;
    writeFileSync(path.join(profile, 'mcp.json'), `${JSON.stringify({
      mcpServers: { [token]: { type: 'stdio', command: 'tool', enabled: true } },
    })}\n`, { mode: 0o600 });
    const report = audit(profile, project);
    const rendered = JSON.stringify(report);
    expect(rendered).not.toContain(token);
    expect(rendered).not.toContain('ghp_');
    expect(report.findings.map((item) => item.checkId)).toContain('mcp.stdio.inherits_environment');
  });

  it('does not treat settings.local.json as a runtime MCP source and says so', () => {
    const { profile, project } = workspace();
    mkdirSync(path.join(project, '.codebuddy'), { mode: 0o700 });
    writeFileSync(path.join(project, '.codebuddy', 'settings.local.json'), `${JSON.stringify({
      mcpServers: { local: { type: 'stdio', command: 'tool', enabled: true } },
    })}\n`, { mode: 0o600 });
    writeFileSync(path.join(profile, 'settings.json'), `${JSON.stringify({
      mcpServers: { local: { type: 'stdio', command: 'tool', enabled: true } },
    })}\n`, { mode: 0o600 });
    const report = audit(profile, project);
    expect(report.findings.map((item) => item.checkId)).not.toContain('mcp.stdio.inherits_environment');
    expect((report.limitations ?? []).join('\n')).toContain('settings.local.json');
    expect((report.limitations ?? []).join('\n')).toContain('not resolved');
  });

  it('fails when the profile turns both loop-guard switches off', () => {
    const { profile, project } = workspace();
    writeFileSync(path.join(profile, 'config.toml'), [
      '[tool_loop_guardrails]',
      'warnings_enabled = false',
      'hard_stop_enabled = false',
      '',
    ].join('\n'), { mode: 0o600 });
    const report = audit(profile, project);
    expect(report.findings.map((item) => item.checkId)).toContain('agent.loop_guard.disabled');
    expect(report.passed).toBe(false);
    expect(report.status).toBe('failed');
  });
});

describe('security audit through the real CLI entry point', () => {
  function runCli(args: string[], home: string, profile: string): { status: number | null; stdout: string; stderr: string } {
    const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const result = spawnSync(process.execPath, [tsx, path.join(repoRoot, 'src', 'index.ts'), ...args], {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: home,
        CODEBUDDY_HOME: profile,
        NO_COLOR: '1',
        CI: '1',
        LANG: 'C',
      },
      encoding: 'utf8',
      timeout: 180000,
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }

  it('does not report passed when --profile-dir names a missing directory', () => {
    const { root, profile, project } = workspace();
    const missing = path.join(root, 'absent-profile');
    const ran = runCli(
      ['security', 'audit', '--json', '--profile-dir', missing, '--project', project],
      root,
      profile,
    );
    expect(ran.status, ran.stderr).not.toBe(0);
    expect(ran.stdout.trim().startsWith('{'), `${ran.stdout}\n${ran.stderr}`).toBe(true);
    const report = JSON.parse(ran.stdout) as { passed?: boolean; status?: string; effectiveProfileDir?: string | null };
    expect(report.passed).toBe(false);
    expect(report.status).not.toBe('passed');
    expect(report.effectiveProfileDir).toBeNull();
  }, 180000);

  itPosix('does not turn the global --profile name into an empty passed audit', () => {
    const { root, profile, project } = workspace();
    chmodSync(profile, 0o707);
    const collided = runCli(
      ['security', 'audit', '--json', '--profile', 'core', '--project', project],
      root,
      profile,
    );
    expect(collided.status, collided.stderr).not.toBe(0);
    expect(collided.stdout).not.toContain('"passed": true');
    expect(collided.stderr).toContain('global option');

    const placed = runCli(
      ['--profile', 'core', 'security', 'audit', '--json', '--project', project],
      root,
      profile,
    );
    expect(placed.stdout.trim().startsWith('{'), `${placed.stdout}\n${placed.stderr}`).toBe(true);
    const report = JSON.parse(placed.stdout) as {
      passed?: boolean;
      profileDir?: string;
      effectiveProfileDir?: string | null;
      findings?: Array<{ checkId: string }>;
    };
    expect(report.passed).toBe(false);
    expect(report.findings?.map((item) => item.checkId)).toContain('profile.directory.world_writable');
    expect(report.profileDir).not.toBe('core');
    expect(report.effectiveProfileDir).toBe(realpathSync(profile));
  }, 180000);
});

function readNames(dir: string): string[] {
  return readdirSync(dir).slice().sort();
}
