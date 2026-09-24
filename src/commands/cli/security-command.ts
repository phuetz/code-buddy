/**
 * `buddy security audit` — one report over the checks inventoried in
 * src/security/consolidated-audit.ts. The older `security-audit` command
 * stays registered separately.
 *
 * The directory option is `--profile-dir`, not `--profile`. The global
 * pre-parser already owns `--profile <name>` for configuration profiles.
 */

import type { Command } from 'commander';
import { detectNativeSandboxCapabilities, type NativeSandboxCapabilities } from '../../security/native-sandbox.js';
import {
  runConsolidatedSecurityAudit,
  type ConsolidatedAuditReport,
} from '../../security/consolidated-audit.js';
import { getCodeBuddyHome } from '../../utils/codebuddy-home.js';

export interface SecurityAuditCommandOptions {
  fix?: boolean;
  json?: boolean;
  profileDir?: string;
  project?: string;
}

export interface SecurityAuditIo {
  log: (line: string) => void;
  cwd: () => string;
  home: () => string;
  probe: () => Pick<NativeSandboxCapabilities, 'recommended' | 'reason'>;
}

export function formatSecurityAuditText(report: ConsolidatedAuditReport): string {
  const headline = report.status === 'passed'
    ? 'Security audit: passed'
    : report.status === 'passed_with_suppressions'
      ? 'Security audit: passed with suppressions'
      : 'Security audit: failed';
  const lines = [
    headline,
    `Profile: ${report.effectiveProfileDir ?? '(inaccessible)'} (requested ${report.profileDir})`,
    `Project: ${report.effectiveProjectDir ?? '(inaccessible)'} (requested ${report.projectDir})`,
  ];
  for (const item of report.findings) {
    lines.push(`  ${item.severity} ${item.checkId} — ${item.title}. ${item.detail}`);
  }
  if (report.suppressedFindings.length > 0) {
    lines.push(`Suppressed: ${report.suppressedFindings.length}`);
    for (const item of report.suppressedFindings) {
      lines.push(`  ${item.severity} ${item.checkId} — ${item.reason}`);
    }
  }
  for (const fix of report.fixes) {
    lines.push(`  ${fix.ok ? 'fixed' : 'not fixed'} ${fix.checkId} ${fix.subject}: ${fix.message}`);
  }
  for (const limitation of report.limitations) {
    lines.push(`Limitation: ${limitation}`);
  }
  return `${lines.join('\n')}\n`;
}

export function runSecurityAuditCommand(
  options: SecurityAuditCommandOptions,
  io: SecurityAuditIo,
): number {
  const report = runConsolidatedSecurityAudit({
    profileDir: options.profileDir ?? io.home(),
    projectDir: options.project ?? io.cwd(),
    fix: options.fix === true,
    sandbox: io.probe(),
  });
  io.log(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatSecurityAuditText(report));
  return report.passed ? 0 : 1;
}

export function registerSecurityCommand(program: Command): void {
  const security = program
    .command('security')
    .description('Security checks for the local profile and project');

  security
    .command('audit')
    .description('Run the consolidated security audit')
    .option('--fix', 'Tighten loose file modes after writing a mode backup')
    .option('--json', 'Print the report as JSON')
    .option('--profile-dir <dir>', 'Profile directory to audit')
    .option('--project <dir>', 'Project directory')
    .action((options: SecurityAuditCommandOptions) => {
      const code = runSecurityAuditCommand(options, {
        log: (line) => console.log(line),
        cwd: () => process.cwd(),
        home: () => getCodeBuddyHome(),
        probe: () => detectNativeSandboxCapabilities(),
      });
      if (code !== 0) process.exitCode = code;
    });
}
