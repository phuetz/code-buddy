/**
 * `buddy policy check|repair` — constats, puis réparation qui ne fait que restreindre.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';

import { assessPolicy, repairPolicy, type PolicyCycleReport } from '../../config/policy-cycle.js';
import { parseTOML, resolveUserConfigFile } from '../../config/toml-config.js';

function readUserDocument(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  return parseTOML(readFileSync(file, 'utf8'));
}

function emit(report: PolicyCycleReport, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: report.ok,
      source: report.source,
      application: report.application,
      domains: report.domains,
      findings: report.findings,
      repairs: report.repairs,
      errors: report.errors,
    }, null, 2)}\n`);
    return;
  }
  const lines = [
    `ok: ${report.ok ? 'true' : 'false'}`,
    `application: ${report.application}`,
  ];
  for (const domain of report.domains) {
    lines.push(`domaine ${domain.domain}: ${domain.application}`);
  }
  if (report.source) lines.push(`source: ${report.source}`);
  for (const finding of report.findings) lines.push(`${finding.kind} ${finding.id}: ${finding.message}`);
  for (const repair of report.repairs) lines.push(`repair ${repair.key}`);
  for (const error of report.errors) lines.push(`error: ${error}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function registerPolicyCommand(program: Command): void {
  const policy = program
    .command('policy')
    .description('Constats et réparation des politiques par domaine. Une politique ne fait que restreindre.');

  const paths = () => ({
    systemPath: '/etc/codebuddy/managed-settings.json',
    userPath: join(homedir(), '.codebuddy', 'managed-settings.json'),
    userConfig: readUserDocument(resolveUserConfigFile()),
  });

  policy
    .command('check')
    .description('Liste les écarts entre la configuration et la politique')
    .option('--json', 'Rapport JSON')
    .action(async (opts: { json?: boolean }) => {
      const report = assessPolicy(paths());
      emit(report, opts.json === true);
      if (!report.ok) process.exitCode = 1;
    });

  policy
    .command('repair')
    .description('Restreint la configuration utilisateur. N\'élargit rien et n\'écrit pas la politique.')
    .option('--dry-run', 'Montrer les restrictions sans écrire')
    .option('--json', 'Rapport JSON')
    .action(async (opts: { dryRun?: boolean; json?: boolean }) => {
      const report = await repairPolicy({ ...paths(), dryRun: opts.dryRun === true });
      emit(report, opts.json === true);
      if (report.errors.length > 0 || (opts.dryRun === true && report.repairs.length > 0)) {
        process.exitCode = 1;
      }
    });
}
