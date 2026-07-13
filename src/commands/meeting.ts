/** `buddy meeting notes` — local-first meeting intelligence CLI. */

import { basename } from 'path';
import { Command } from 'commander';
import {
  generateMeetingNotes,
  writeMeetingOutputReports,
  type MeetingOutputTargets,
} from '../meeting/index.js';
import { logger } from '../utils/logger.js';

export interface MeetingCommandDependencies {
  generate?: typeof generateMeetingNotes;
}

export { resolveMeetingOutputTargets } from '../meeting/output.js';

export function createMeetingCommand(deps: MeetingCommandDependencies = {}): Command {
  const command = new Command('meeting')
    .description('Turn a local transcript, audio, or video file into grounded meeting notes');

  command
    .command('notes')
    .description('Extract summary, decisions, actions, questions, evidence, and timestamped transcript')
    .argument('<input>', 'Local transcript (.txt/.md/.srt/.vtt/.json), audio, or video file')
    .option('-o, --output <prefix>', 'Write both <prefix>.md and <prefix>.json (or use an existing directory)')
    .option('--json', 'Print JSON to stdout instead of Markdown')
    .option('-l, --language <language>', 'Analysis and report language', 'fr')
    .option('--ai', 'Enrich with the configured LLM (sends a bounded transcript excerpt to that provider)')
    .option('--no-ai', 'Compatibility alias for the local deterministic default')
    .option('--force', 'Replace existing report files (never enabled for the agent tool)', false)
    .action(async (input: string, options: { output?: string; json?: boolean; language: string; ai: boolean; force: boolean }) => {
      const generate = deps.generate ?? generateMeetingNotes;
      const result = await generate(
        { kind: 'file', path: input },
        { language: options.language, useAI: options.ai === true },
      );

      if (options.output) {
        const targets: MeetingOutputTargets = await writeMeetingOutputReports(
          options.output,
          result,
          { overwrite: options.force },
        );
        logger.info(`[meeting] reports written: ${basename(targets.markdown)}, ${basename(targets.json)}`);
      }
      process.stdout.write(`${options.json ? result.json : result.markdown}\n`);
    });

  return command;
}
