/**
 * buddy research – Wide Research CLI command
 *
 * Spawns N parallel agent workers to research independent subtopics,
 * then synthesizes a comprehensive report.
 *
 * Usage:
 *   buddy research "quantum computing breakthroughs in 2025"
 *   buddy research "best practices for TypeScript monorepos" --workers 8
 *   buddy research "competitor analysis for Manus AI" --workers 5 --output report.md
 */

import { Command } from 'commander';
import { WideResearchOrchestrator } from '../../agent/wide-research.js';
import * as fs from 'fs/promises';

export function createResearchCommand(): Command {
  const cmd = new Command('research')
    .description('Wide Research: spawn parallel agent workers to research a topic comprehensively')
    .argument('<topic>', 'The topic to research')
    .option('-w, --workers <n>', 'Number of parallel research workers (default: 5, max: 20)', '5')
    .option('-r, --rounds <n>', 'Max tool rounds per worker (default: 15)', '15')
    .option('-o, --output <file>', 'Save the report to a Markdown file')
    .option('--context <text>', 'Additional context injected into each worker')
    .action(async (topic: string, opts) => {
      const apiKey = process.env.GROK_API_KEY || process.env.ANTHROPIC_API_KEY || '';

      if (!apiKey) {
        console.error('❌ No API key found. Set GROK_API_KEY or ANTHROPIC_API_KEY.');
        process.exit(1);
      }

      const workers = Math.min(parseInt(opts.workers, 10) || 5, 20);
      const maxRoundsPerWorker = parseInt(opts.rounds, 10) || 15;

      console.log(`\n🔬 Wide Research: "${topic}"`);
      console.log(`   Workers: ${workers}  |  Max rounds per worker: ${maxRoundsPerWorker}`);
      console.log('─'.repeat(60));

      const orchestrator = new WideResearchOrchestrator({
        workers,
        maxRoundsPerWorker,
        context: opts.context,
      });

      // Stream progress events
      orchestrator.on('progress', (event: { type: string; subtopics?: string[]; workerIndex?: number; subtopic?: string; success?: boolean }) => {
        switch (event.type) {
          case 'decomposed':
            console.log(`\n📋 Subtopics (${event.subtopics?.length}):`);
            event.subtopics?.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
            console.log('');
            break;
          case 'worker_start':
            console.log(`  ▶ [${event.workerIndex! + 1}] Starting: ${event.subtopic}`);
            break;
          case 'worker_done':
            const icon = event.success ? '✅' : '❌';
            console.log(`  ${icon} [${event.workerIndex! + 1}] Done: ${event.subtopic}`);
            break;
          case 'aggregating':
            console.log('\n🔗 Aggregating results into final report...');
            break;
        }
      });

      try {
        const result = await orchestrator.research(topic, apiKey);

        console.log('\n' + '─'.repeat(60));
        console.log(`✅ Research complete!`);
        console.log(`   Workers succeeded: ${result.successCount}/${result.subtopics.length}`);
        console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

        if (opts.output) {
          const reportContent = [
            `# Research Report: ${topic}`,
            ``,
            `Generated: ${new Date().toISOString()}`,
            `Workers: ${result.successCount}/${result.subtopics.length} succeeded`,
            `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
            ``,
            `---`,
            ``,
            result.report,
          ].join('\n');

          await fs.writeFile(opts.output, reportContent, 'utf-8');
          console.log(`\n📄 Report saved: ${opts.output}`);
        } else {
          console.log('\n' + result.report);
        }
      } catch (err) {
        console.error(`\n❌ Research failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  return cmd;
}
