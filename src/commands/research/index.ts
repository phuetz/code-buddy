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
import * as fsSync from 'fs';
import path from 'path';
import { getSettingsManager } from '../../utils/settings-manager.js';
import { PROVIDERS } from '../provider.js';

async function runDirectResearch(
  topic: string,
  apiKey: string,
  providerConfig: { model?: string; baseURL?: string },
  timeoutMs: number
): Promise<string> {
  const { CodeBuddyClient } = await import('../../codebuddy/client.js');
  const client = new CodeBuddyClient(apiKey, providerConfig.model, providerConfig.baseURL);

  const response = await Promise.race([
    client.chat([
      {
        role: 'system',
        content:
          'You are a senior research analyst. Produce a concise but complete Markdown research report with: executive summary, key findings, practical recommendations, and known uncertainties.',
      },
      {
        role: 'user',
        content: `Research topic: ${topic}\n\nProvide a structured report in Markdown.`,
      },
    ]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Direct research timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);

  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }
  return `# Research Report: ${topic}\n\nNo content returned by provider.`;
}

function detectReportPathFromArgv(argv: string[]): string | undefined {
  const formatKeywords = new Set(['json', 'text', 'markdown', 'stream-json', 'streaming']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--report' || token === '-f' || token === '--output' || token === '-o') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        continue;
      }
      if (formatKeywords.has(next.toLowerCase())) {
        continue;
      }
      if (/\.[a-z0-9]+$/i.test(next)) {
        return next;
      }
    }
  }
  return undefined;
}

export function createResearchCommand(): Command {
  const cmd = new Command('research')
    .description('Wide Research: spawn parallel agent workers to research a topic comprehensively')
    .argument('<topic>', 'The topic to research')
    .option('-w, --workers <n>', 'Number of parallel research workers (default: 5, max: 20)', '5')
    .option('-r, --rounds <n>', 'Max tool rounds per worker (default: 15)', '15')
    .option('--worker-timeout-ms <n>', 'Per-worker timeout in milliseconds (default: 90000)', '90000')
    .option('--timeout-ms <n>', 'Overall research timeout in milliseconds (default: 300000)', '300000')
    .option('-f, --report <file>', 'Save the report to a Markdown file')
    .option('--context <text>', 'Additional context injected into each worker')
    .action(async (topic: string, opts) => {
      const settingsManager = getSettingsManager();
      const settings = settingsManager.loadUserSettings();
      const currentProviderKey = settings.provider || 'grok';
      const providerInfo = PROVIDERS[currentProviderKey];
      
      let apiKey = process.env[providerInfo?.envVar || ''] || '';
      if (!apiKey && currentProviderKey === 'grok') apiKey = process.env.XAI_API_KEY || '';
      if (!apiKey && currentProviderKey === 'gemini') apiKey = process.env.GOOGLE_API_KEY || '';
      
      if (!apiKey) apiKey = process.env.GROK_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY || '';

      if (!apiKey) {
        console.error('❌ No API key found for the active provider. Set the appropriate environment variable.');
        process.exit(1);
      }

      const providerEnvBaseURL: Record<string, string | undefined> = {
        grok: process.env.GROK_BASE_URL,
        claude: process.env.ANTHROPIC_BASE_URL,
        openai: process.env.OPENAI_BASE_URL,
        gemini: process.env.GEMINI_BASE_URL,
      };

      const providerConfig = {
        model: settingsManager.getCurrentModel() || providerInfo?.defaultModel,
        baseURL: providerEnvBaseURL[currentProviderKey] || providerInfo?.baseURL,
      };

      const workers = Math.min(parseInt(opts.workers, 10) || 5, 20);
      const maxRoundsPerWorker = parseInt(opts.rounds, 10) || 15;
      const workerTimeoutMs = Math.max(5_000, parseInt(opts.workerTimeoutMs, 10) || 90_000);
      const overallTimeoutMs = Math.max(30_000, parseInt(opts.timeoutMs, 10) || 300_000);
      const hardStopTimeoutMs = overallTimeoutMs + 2_000;
      const argvReportPath = detectReportPathFromArgv(process.argv.slice(2));
      const reportPath: string | undefined = opts.report || argvReportPath;

      console.log(`\n🔬 Wide Research: "${topic}"`);
      console.log(`   Provider: ${providerInfo?.name || currentProviderKey} | Model: ${providerConfig.model}`);
      console.log(`   Workers: ${workers}  |  Max rounds per worker: ${maxRoundsPerWorker}`);
      console.log('─'.repeat(60));

      if (!opts.report && reportPath) {
        console.warn(`⚠️ Legacy output flag detected. Use "--report ${reportPath}" for research report files.`);
      }

      // In non-interactive runs (CI/headless), prefer a direct single-pass research call.
      // This avoids long-lived worker handles and makes output deterministic for automation.
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log('ℹ️ Non-interactive mode detected, using direct research mode.');
        try {
          const report = await runDirectResearch(topic, apiKey, providerConfig, Math.min(overallTimeoutMs, 120_000));
          const reportContent = [
            `# Research Report: ${topic}`,
            ``,
            `Generated: ${new Date().toISOString()}`,
            `Mode: direct`,
            `Provider: ${providerInfo?.name || currentProviderKey}`,
            `Model: ${providerConfig.model || 'default'}`,
            ``,
            `---`,
            ``,
            report,
          ].join('\n');

          if (reportPath) {
            const outputPath = path.resolve(reportPath);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, reportContent, 'utf-8');
            console.log(`\n📄 Report saved: ${reportPath}`);
          } else {
            console.log('\n' + report);
          }
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (reportPath) {
            const outputPath = path.resolve(reportPath);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(
              outputPath,
              [
                `# Research Report: ${topic}`,
                ``,
                `Generated: ${new Date().toISOString()}`,
                `Mode: direct`,
                `Status: failed`,
                ``,
                `Error: ${message}`,
              ].join('\n'),
              'utf-8'
            );
            console.log(`\n📄 Report saved (failure fallback): ${reportPath}`);
          }
          throw err;
        }
      }

      const orchestrator = new WideResearchOrchestrator({
        workers,
        maxRoundsPerWorker,
        context: opts.context,
        workerTimeoutMs,
        overallTimeoutMs,
      });

      if (reportPath) {
        const outputPath = path.resolve(reportPath);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(
          outputPath,
          [
            `# Research Report: ${topic}`,
            '',
            `Generated: ${new Date().toISOString()}`,
            'Status: Running...',
            '',
            'The research process is in progress. This file will be updated on completion.',
          ].join('\n'),
          'utf-8'
        );
      }

      // Hard-stop guard: avoid hanging forever because of dangling I/O handles in workers.
      const hardStopTimer = setTimeout(() => {
        try {
          if (reportPath) {
            const outputPath = path.resolve(reportPath);
            fsSync.mkdirSync(path.dirname(outputPath), { recursive: true });
            fsSync.writeFileSync(
              outputPath,
              [
                `# Research Report: ${topic}`,
                '',
                `Generated: ${new Date().toISOString()}`,
                `Status: Timed out after ${overallTimeoutMs}ms`,
                '',
                'The research process exceeded the configured timeout and was terminated.',
              ].join('\n'),
              'utf-8'
            );
          }
        } catch {
          // Best effort: if writing fallback report fails, still terminate the hanging process.
        }

        console.error(`\n❌ Research hard-timeout reached (${overallTimeoutMs}ms). Terminating process.`);
        process.exit(1);
      }, hardStopTimeoutMs);

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
        const result = await orchestrator.research(topic, apiKey, providerConfig);

        console.log('\n' + '─'.repeat(60));
        console.log(`✅ Research complete!`);
        console.log(`   Workers succeeded: ${result.successCount}/${result.subtopics.length}`);
        console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

        if (reportPath) {
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

          await fs.writeFile(reportPath, reportContent, 'utf-8');
          console.log(`\n📄 Report saved: ${reportPath}`);
        } else {
          console.log('\n' + result.report);
        }
      } catch (err) {
        console.error(`\n❌ Research failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      } finally {
        clearTimeout(hardStopTimer);
      }
    });

  return cmd;
}
