import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';

interface Options { config: string; timeout: string; json?: boolean }

export function registerFleetCollaborationCommands(fleet: Command): void {
  const run = async (options: Options, goal?: string) => {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const { parseCollaborationConfig, runCollaboration } = await import('../../fleet/collaboration.js');
      const config = parseCollaborationConfig(JSON.parse(await readFile(options.config, 'utf8')));
      const report = await runCollaboration(config, {
        goal, timeoutMs: Number(options.timeout), signal: controller.signal,
        onProgress: options.json ? undefined : message => { process.stderr.write(`${message}\n`); },
      });
      if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        process.stdout.write(`Fleet: ${report.status}\n`);
        for (const peer of report.peers) {
          process.stdout.write(`\n${peer.id} — ${peer.status}${peer.model ? ` (${peer.model})` : ''}\n${peer.error ?? peer.text ?? 'Authenticated and ready for peer.chat'}\n`);
        }
        if (report.synthesis) process.stdout.write(`\nSynthesis (${report.synthesis.peer})\n${report.synthesis.text}\n`);
        if (report.synthesisError) process.stdout.write(`\nSynthesis: ${report.synthesisError}\n`);
      }
      if (report.status !== 'complete') process.exitCode = 1;
    } catch (error) {
      // Syntax errors can quote raw configuration, which may contain misplaced secrets.
      const message = error instanceof SyntaxError ? 'Invalid fleet JSON configuration' : error instanceof Error ? error.message : 'Fleet operation failed';
      if (options.json) process.stdout.write(`${JSON.stringify({ status: 'failed', error: message })}\n`);
      else process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  };
  fleet.command('check')
    .description('Verify authenticated peers and chat readiness without calling an LLM')
    .requiredOption('--config <file>', 'Fleet JSON configuration (token environment variable names only)')
    .option('--timeout <ms>', 'Per-request timeout, 1000–300000 ms', '10000')
    .option('--json', 'Structured report')
    .action((options: Options) => run(options));
  fleet.command('collaborate <goal>')
    .description('Collect parallel peer reviews, then synthesize them (no remote file edits)')
    .requiredOption('--config <file>', 'Fleet JSON configuration (2–8 peers)')
    .option('--timeout <ms>', 'Per-request timeout, 1000–300000 ms', '120000')
    .option('--json', 'Structured report')
    .action((goal: string, options: Options) => run(options, goal));
}
