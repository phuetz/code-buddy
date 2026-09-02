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
    .description('Manage .codebuddy/ backups (create, verify, list, restore)')
    .option('--only-config', 'Only backup configuration files')
    .option('--no-include-workspace', 'Exclude workspace data')
    .option('--output <path>', 'Custom output directory')
    .option('--confirm', 'Confirm restore overwrite of .codebuddy/')
    .action(async (
      subcommand: string | undefined,
      args: string[],
      opts: {
        onlyConfig?: boolean;
        includeWorkspace?: boolean;
        output?: string;
        confirm?: boolean;
      },
    ) => {
      const { handleBackup } = await import('../handlers/backup-handlers.js');
      const flags: string[] = [];
      if (opts.onlyConfig) flags.push('--only-config');
      if (opts.includeWorkspace === false) flags.push('--no-include-workspace');
      if (opts.output) flags.push('--output', opts.output);
      if (opts.confirm) flags.push('--confirm');
      const fullArgs = [subcommand || 'list', ...(args || []), ...flags].join(' ');
      const result = await handleBackup(fullArgs);
      if (result.response) write(result.response);
      if (result.exitCode) process.exitCode = result.exitCode;
    });
}
