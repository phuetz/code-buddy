/**
 * CLI `buddy backup` — create / verify / list / restore.
 *
 * `--confirm` must be a declared Commander option: the restore handler
 * looks for it in its argv string, but an undeclared flag is rejected
 * before the handler runs (`error: unknown option '--confirm'`).
 */

import type { Command } from 'commander';

export function registerBackupCommand(
  program: Command,
  write: (msg: string) => void = (msg) => {
    process.stdout.write(`${msg}\n`);
  },
): void {
  program
    .command('backup [subcommand] [args...]')
    .description(
      "Manage backups of .codebuddy/ directories (archives default to ~/.codebuddy/backups; use --home-profile for home profile)",
    )
    .option('--only-config', 'Only backup configuration files')
    .option('--no-include-workspace', 'Exclude workspace data')
    .option('--output <path>', 'Custom output directory')
    .option('--confirm', 'Confirm restore overwrite of .codebuddy/')
    .option('--home-profile', 'Backup the home profile (~/.codebuddy) instead of the current project')
    .option('--scope <home|project|both>', 'Backup scope: home profile, current project, or both')
    .option('--dry-run', 'Show what would be backed up without actually writing anything')
    .action(async (
      subcommand: string | undefined,
      args: string[],
      opts: {
        onlyConfig?: boolean;
        includeWorkspace?: boolean;
        output?: string;
        confirm?: boolean;
        homeProfile?: boolean;
        scope?: string;
        dryRun?: boolean;
      },
    ) => {
      const { handleBackup } = await import('../handlers/backup-handlers.js');
      const flags: string[] = [];
      if (opts.onlyConfig) flags.push('--only-config');
      if (opts.includeWorkspace === false) flags.push('--no-include-workspace');
      if (opts.output) flags.push('--output', opts.output);
      if (opts.confirm) flags.push('--confirm');
      if (opts.homeProfile) flags.push('--home-profile');
      if (opts.scope) flags.push('--scope', opts.scope);
      if (opts.dryRun) flags.push('--dry-run');
      const fullArgs = [subcommand || 'list', ...(args || []), ...flags].join(' ');
      const result = await handleBackup(fullArgs);
      if (result.response) write(result.response);
      if (result.exitCode) process.exitCode = result.exitCode;
    });
}
