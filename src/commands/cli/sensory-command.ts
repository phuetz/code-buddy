/**
 * CLI `buddy sensory status` — read-only inspection of event-driven surveillance.
 *
 * Patterned on `buddy rules …` / `registerBackupCommand`: a thin Commander
 * registration that lazy-imports the collector so `src/index.ts` stays light.
 */

import type { Command } from 'commander';

export function registerSensoryCommand(
  program: Command,
  write: (msg: string) => void = (msg) => {
    process.stdout.write(`${msg}\n`);
  },
): void {
  program
    .command('sensory [action]')
    .description('Inspect event-driven surveillance (read-only) — status')
    .option('--server-url <url>', 'Code Buddy server URL')
    .option('--json', 'machine-readable JSON')
    .action(async (action: string | undefined, options: { json?: boolean; serverUrl?: string }) => {
      const act = (action || 'status').toLowerCase();
      if (act !== 'status') {
        write('Usage: buddy sensory status [--server-url <url>] [--json]');
        process.exitCode = 1;
        return;
      }
      const { collectSensoryStatus, formatSensoryStatus } = await import(
        '../../sensory/sensory-status.js'
      );
      const view = await collectSensoryStatus({ serverUrl: options.serverUrl });
      write(formatSensoryStatus(view, Boolean(options.json)));
    });
}
