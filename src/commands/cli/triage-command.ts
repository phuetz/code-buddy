/**
 * buddy triage — write a local, redacted support bundle (src/doctor/triage.ts).
 *
 * Never sends anything and never launches an agent: the command to hand the
 * prompt to a local agent is printed for the user to review and run.
 */

import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function buddyVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [join(here, '..', '..', '..', 'package.json'), join(here, '..', '..', 'package.json')]) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (pkg.version && pkg.name?.includes('buddy')) return pkg.version;
      } catch { /* try next */ }
    }
  } catch { /* fall through */ }
  return 'unknown';
}

export function registerTriageCommand(program: Command): void {
  program
    .command('triage')
    .description('Write a local redacted support bundle and a ≤ 8 KiB prompt (no network, launches nothing)')
    .option('--json', 'Print a JSON summary on stdout')
    .option('--out <dir>', 'Parent directory for the bundle (default ~/.codebuddy/triage)')
    .option('--log-lines <n>', 'Maximum log lines to include', '200')
    .action(async (options: { json?: boolean; out?: string; logLines?: string }) => {
      const { writeTriageBundle } = await import('../../doctor/triage.js');
      const directory = (program.opts() as { directory?: string }).directory;
      const cwd = resolve(process.cwd(), directory || process.cwd());
      const logLines = Math.max(0, Math.min(2000, Number.parseInt(options.logLines ?? '200', 10) || 0));
      try {
        const result = await writeTriageBundle({
          cwd,
          ...(options.out ? { outParent: resolve(process.cwd(), options.out) } : {}),
          logLines,
          buddyVersion: buddyVersion(),
        });
        if (options.json) {
          console.log(JSON.stringify({
            dir: result.dir,
            files: { json: result.jsonPath, prompt: result.promptPath },
            promptBytes: result.promptBytes,
            redactions: result.redactions,
            withheld: result.withheld,
            networkUsed: false,
            agentLaunched: false,
            suggestedCommand: result.suggestedCommand,
          }, null, 2));
          return;
        }
        console.log('\nCode Buddy triage (local only — nothing was sent, no agent was started)\n');
        console.log(`  Bundle     : ${result.dir}`);
        console.log(`  Prompt     : ${result.promptPath} (${result.promptBytes} bytes)`);
        console.log(`  Redactions : ${result.redactions}`);
        if (result.withheld.length > 0) console.log(`  Withheld   : ${result.withheld.join(', ')} (secret scan still matched)`);
        console.log('\nReview prompt.md, then hand it to a local agent yourself:');
        console.log(`  ${result.suggestedCommand}\n`);
      } catch (error) {
        console.error(`triage failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });
}
