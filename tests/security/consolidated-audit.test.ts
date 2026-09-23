import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSecurityCommand, runSecurityAuditCommand } from '../../src/commands/cli/security-command.js';
import { runConsolidatedSecurityAudit } from '../../src/security/consolidated-audit.js';

const dirs: string[] = [];

function workspace(): { profile: string; project: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'security-audit-'));
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
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sandboxReady = { recommended: 'bwrap' as const, reason: 'injected' };

describe('buddy security audit', () => {
  it('passes a profile that has no loose modes, secrets, or skills', () => {
    const { profile, project } = workspace();
    const report = runConsolidatedSecurityAudit({
      profileDir: profile,
      projectDir: project,
      sandbox: sandboxReady,
      env: {},
    });
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
  });

  it('reports stable check ids and does not repeat a plaintext token', () => {
    const { profile, project } = workspace();
    const token = `ghp_${'a'.repeat(36)}`;
    writeFileSync(path.join(profile, 'config.toml'), `token = "${token}"\napi_key = "\${env:EXAMPLE_TOKEN}"\n`, { mode: 0o600 });
    mkdirSync(path.join(project, '.codebuddy'), { recursive: true });
    writeFileSync(path.join(project, '.codebuddy', 'settings.json'), `${JSON.stringify({
      servers: { demo: { command: 'tool', type: 'stdio', enabled: false } },
    })}\n`, { mode: 0o600 });
    writeFileSync(path.join(profile, 'mcp.json'), `${JSON.stringify({
      mcpServers: {
        remote: { url: 'file:///tmp/mcp', enabled: true },
        quiet: { type: 'stdio', command: 'tool', inheritEnv: false, enabled: true },
        off: { type: 'stdio', command: 'tool', enabled: false },
      },
    })}\n`, { mode: 0o600 });
    mkdirSync(path.join(profile, 'skills', 'bad'), { recursive: true });
    writeFileSync(path.join(profile, 'skills', 'bad', 'SKILL.md'), '# bad\neval(input)\n', { mode: 0o600 });
    chmodSync(profile, 0o707);

    const report = runConsolidatedSecurityAudit({
      profileDir: profile,
      projectDir: project,
      env: { CODEBUDDY_NATIVE_SANDBOX: 'true' },
      sandbox: { recommended: 'none', reason: 'no backend' },
    });
    const ids = report.findings.map((item) => item.checkId);
    expect(ids).toContain('profile.directory.world_writable');
    expect(ids).toContain('config.plaintext_secret');
    expect(ids).toContain('mcp.config.servers_key_ignored');
    expect(ids).toContain('mcp.remote.unsafe_url');
    expect(ids).toContain('skills.firewall.quarantine');
    expect(ids).toContain('sandbox.native.unavailable');
    expect(ids).not.toContain('mcp.stdio.inherits_environment');
    const rendered = JSON.stringify(report);
    expect(rendered).not.toContain(token);
    expect(rendered).not.toContain('ghp_');
    expect(report.passed).toBe(false);
  });

  it('flags an enabled stdio server that inherits the process environment', () => {
    const { profile, project } = workspace();
    writeFileSync(path.join(profile, 'mcp.json'), `${JSON.stringify({
      mcpServers: { local: { type: 'stdio', command: 'tool', enabled: true } },
    })}\n`, { mode: 0o600 });
    const report = runConsolidatedSecurityAudit({ profileDir: profile, projectDir: project, env: {}, sandbox: sandboxReady });
    expect(report.findings.map((item) => item.checkId)).toEqual(['mcp.stdio.inherits_environment']);
  });

  it('hides an accepted suppression, keeps it visible, and ignores a suppression without a reason', () => {
    const { profile, project } = workspace();
    chmodSync(profile, 0o707);
    writeFileSync(path.join(profile, 'config.toml'), 'note = "plain"\n', { mode: 0o600 });
    chmodSync(path.join(profile, 'config.toml'), 0o644);
    writeFileSync(path.join(profile, 'settings.json'), `${JSON.stringify({
      security: {
        audit: {
          suppressions: [
            { checkId: 'profile.directory.world_writable', reason: 'shared workstation' },
            { checkId: 'profile.file.loose_permissions', detailIncludes: 'config.toml' },
            { checkId: 'profile.file.loose_permissions', reason: 'reviewed', detailIncludes: 'config.toml' },
          ],
        },
      },
    })}\n`, { mode: 0o600 });
    chmodSync(path.join(profile, 'settings.json'), 0o600);
    const report = runConsolidatedSecurityAudit({ profileDir: profile, projectDir: project, env: {}, sandbox: sandboxReady });
    expect(report.findings.map((item) => item.checkId)).toContain('security.audit.suppressions.active');
    expect(report.findings.map((item) => item.checkId)).toContain('security.audit.suppression.missing_reason');
    expect(report.findings.map((item) => item.checkId)).not.toContain('profile.directory.world_writable');
    expect(report.suppressedFindings.map((item) => item.checkId)).toEqual([
      'profile.directory.world_writable',
      'profile.file.loose_permissions',
    ]);
    expect(report.summary.high).toBe(0);
    expect(report.passed).toBe(true);
  });

  it('tightens only loose modes, after a backup, and leaves file contents unchanged', () => {
    const { profile, project } = workspace();
    const body = 'model = "demo"\n';
    writeFileSync(path.join(profile, 'config.toml'), body, { mode: 0o600 });
    chmodSync(path.join(profile, 'config.toml'), 0o644);
    chmodSync(profile, 0o707);
    const blocked = path.join(profile, 'security-audit-backups');
    writeFileSync(blocked, 'not a directory\n');
    const refused = runConsolidatedSecurityAudit({
      profileDir: profile,
      projectDir: project,
      env: {},
      sandbox: sandboxReady,
      fix: true,
    });
    expect(refused.fixes.some((item) => item.ok)).toBe(false);
    expect(readFileSync(path.join(profile, 'config.toml'), 'utf8')).toBe(body);
    rmSync(blocked);

    const fixed = runConsolidatedSecurityAudit({
      profileDir: profile,
      projectDir: project,
      env: {},
      sandbox: sandboxReady,
      fix: true,
      now: new Date('2026-09-23T12:00:00.000Z'),
    });
    expect(fixed.passed).toBe(true);
    expect(fixed.findings.map((item) => item.checkId)).not.toContain('profile.file.loose_permissions');
    expect(fixed.findings.map((item) => item.checkId)).not.toContain('profile.directory.world_writable');
    expect(fixed.fixes.every((item) => item.ok)).toBe(true);
    expect(readFileSync(path.join(profile, 'config.toml'), 'utf8')).toBe(body);
    const manifest = readFileSync(path.join(profile, 'security-audit-backups', '2026-09-23T12-00-00-000Z', 'manifest.json'), 'utf8');
    expect(manifest).toContain('"modeBefore": "707"');
    expect(manifest).toContain('"modeBefore": "644"');
    expect(manifest).not.toContain(body.trim());
  });

  it('prints JSON from the command and returns a failing status without probing the network', () => {
    const { profile, project } = workspace();
    chmodSync(profile, 0o707);
    const lines: string[] = [];
    let probes = 0;
    const code = runSecurityAuditCommand({ json: true, profileDir: profile, project }, {
      log: (line) => lines.push(line),
      cwd: () => project,
      home: () => profile,
      probe: () => {
        probes += 1;
        return sandboxReady;
      },
    });
    expect(code).toBe(1);
    expect(probes).toBe(1);
    const report = JSON.parse(lines.join('')) as { findings: Array<{ checkId: string }> };
    expect(report.findings.map((item) => item.checkId)).toContain('profile.directory.world_writable');

    const program = new Command();
    registerSecurityCommand(program);
    const security = program.commands.find((command) => command.name() === 'security');
    expect(security?.commands.some((command) => command.name() === 'audit')).toBe(true);
  });
});
