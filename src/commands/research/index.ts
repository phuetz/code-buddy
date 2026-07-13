/**
 * buddy research – Wide Research CLI command
 *
 * Spawns N parallel agent workers to research independent subtopics,
 * then synthesizes a comprehensive report.
 *
 * Usage:
 *   buddy research "quantum computing breakthroughs in 2025"
 *   buddy research "best practices for TypeScript monorepos" --items 100 --concurrency 10
 *   buddy research "competitor analysis for Manus AI" --items 25 --report report.md
 */

import { Command } from 'commander';
import {
  computeWideResearchDefaultOverallTimeoutMs,
  WideResearchOrchestrator,
} from '../../agent/wide-research.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { resolveCommandProvider } from '../llm-provider-resolution.js';
import { addKnowledgeSubcommands } from './knowledge-ingest.js';
import {
  redactWideResearchResult,
  redactWideResearchText,
  resolveWideResearchCheckpointPath,
} from '../../agent/wide-research-checkpoint.js';
import {
  assertWideResearchFilesDistinct,
  writeWideResearchTextAtomic,
  writeWideResearchTextAtomicSync,
} from '../../agent/wide-research-files.js';

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

function parseClampedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum?: number,
): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(minimum, maximum === undefined ? normalized : Math.min(maximum, normalized));
}

export function createResearchCommand(): Command {
  const cmd = new Command('research')
    .description('Wide Research: spawn parallel agent workers to research a topic comprehensively')
    .argument('<topic>', 'The topic to research')
    .option('-w, --workers <n>', 'Legacy shorthand: set both items and concurrency (max: 20)')
    .option('--items <n>', 'Total independent research items (default: 5, max: 250)')
    .option('--concurrency <n>', 'Maximum parallel workers per wave (default: 5, max: 20)')
    .option('-r, --rounds <n>', 'Max tool rounds per worker (default: 15)', '15')
    .option('--worker-timeout-ms <n>', 'Per-worker timeout in milliseconds (default: 90000)', '90000')
    .option('--timeout-ms <n>', 'Overall research timeout in milliseconds (default: auto-scaled by waves)')
    .option('-f, --report <file>', 'Save the report to a Markdown file')
    .option('--context <text>', 'Additional context injected into each worker')
    .option('-m, --model <model>', 'Override the model for this research run')
    .option('--wide', 'Force parallel workers even in non-interactive runs (default: direct single-pass)', false)
    .option('--deep', 'Deep Research: deterministic, cited pipeline (plan → search → scrape → dedup → cited synthesis)', false)
    .option('--iterations <n>', 'Deep Research (Phase B) gap-loop rounds: 1 = single round (default, = Phase A), 2-3 iterates research→gap-analysis→re-search until convergence (max 5). Only with --deep', '1')
    .option('--perspectives <n>', 'Deep Research (Phase C, STORM): research the topic from N diversified personas (praticien/sceptique/historique/architecte…) in parallel, then co-write an outline-first cited article. Default 0 = off. Implies --deep. Takes precedence over --iterations. Clamped [2,6]', '0')
    .option('--storm', 'Deep Research (Phase C, STORM) with the default perspective count (4). Alias for --perspectives 4. Implies --deep', false)
    .option('--ckg', 'Deep Research (Phase D): bridge the run to the Collective Knowledge Graph — recall prior collective knowledge (injected as a distinct "Mémoire collective" section) and ingest the deduped sources for cross-run/agent accumulation. Also enabled by CODEBUDDY_COLLECTIVE_MEMORY=true. Rides on --deep; combinable with --iterations/--perspectives', false)
    .option('--checkpoint <file>', 'Persist a resumable Wide Research checkpoint (atomic JSON)')
    .option('--resume <file>', 'Resume a compatible Wide Research checkpoint in place')
    .option('--json', 'Emit one structured Wide Research JSON result (implies --wide)', false)
    .action(async (topic: string, opts, command) => {
      const jsonOutput = Boolean(opts.json);
      const checkpointRequested = typeof opts.checkpoint === 'string';
      const resumeRequested = typeof opts.resume === 'string';
      const durabilityRequested = checkpointRequested || resumeRequested;
      const optionError = checkpointRequested && resumeRequested
        ? 'Use either --checkpoint or --resume, not both.'
        : durabilityRequested && (Boolean(opts.deep) || Boolean(opts.storm) || Number(opts.perspectives) > 0)
          ? '--checkpoint/--resume currently apply to Wide Research only; remove --deep/--storm/--perspectives.'
          : jsonOutput && (Boolean(opts.deep) || Boolean(opts.storm) || Number(opts.perspectives) > 0)
            ? '--json currently emits the Wide Research result; remove --deep/--storm/--perspectives.'
            : null;
      if (optionError) {
        if (jsonOutput) {
          console.log(JSON.stringify({ kind: 'wide_research_run', status: 'failed', error: optionError }));
        } else {
          console.error(`❌ ${optionError}`);
        }
        process.exitCode = 1;
        return;
      }

      // The root program also declares a global `-m, --model`; depending on
      // argv order Commander can bind it there — merge so either wins.
      const modelOverride: string | undefined = opts.model ?? command?.optsWithGlobals?.()?.model;
      const resolved = resolveCommandProvider({ explicitModel: modelOverride });
      if (!resolved) {
        if (jsonOutput) {
          console.log(JSON.stringify({
            kind: 'wide_research_run',
            status: 'failed',
            error: 'No provider available.',
          }));
          process.exitCode = 1;
          return;
        }
        console.error(
          '❌ No provider available — set an API key, run `buddy login`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.',
        );
        process.exit(1);
      }
      const apiKey = resolved.apiKey;
      const providerConfig = {
        model: resolved.model,
        baseURL: resolved.baseURL,
      };

      const legacyWorkers = opts.workers === undefined
        ? undefined
        : parseClampedInteger(opts.workers, 5, 1, 20);
      const items = parseClampedInteger(opts.items, legacyWorkers ?? 5, 1, 250);
      const concurrency = Math.min(
        items,
        parseClampedInteger(opts.concurrency, legacyWorkers ?? 5, 1, 20),
      );
      const maxRoundsPerWorker = parseClampedInteger(opts.rounds, 15, 1);
      const workerTimeoutMs = Math.max(5_000, parseInt(opts.workerTimeoutMs, 10) || 90_000);
      const explicitOverallTimeout = typeof opts.timeoutMs === 'string';
      const overallTimeoutMs = explicitOverallTimeout
        ? Math.max(30_000, parseInt(opts.timeoutMs, 10) || 30_000)
        : computeWideResearchDefaultOverallTimeoutMs({
            items,
            concurrency,
            workerTimeoutMs,
          });
      const hardStopTimeoutMs = overallTimeoutMs + 2_000;
      const argvReportPath = detectReportPathFromArgv(process.argv.slice(2));
      const reportPath: string | undefined = opts.report || argvReportPath;
      let checkpointPath: string | undefined;
      if (durabilityRequested) {
        try {
          checkpointPath = resolveWideResearchCheckpointPath(
            resumeRequested ? opts.resume : opts.checkpoint,
          );
          if (reportPath) {
            await assertWideResearchFilesDistinct(checkpointPath, path.resolve(reportPath));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (jsonOutput) {
            console.log(JSON.stringify({ kind: 'wide_research_run', status: 'failed', error: message }));
          } else {
            console.error(`❌ Checkpoint error: ${message}`);
          }
          process.exitCode = 1;
          return;
        }
      }
      const safeTopic = redactWideResearchText(topic, [apiKey]);

      if (!jsonOutput) {
        console.log(`\n🔬 Wide Research: "${safeTopic}"`);
        console.log(`   Provider: ${resolved.providerLabel} | Model: ${providerConfig.model}`);
        console.log(
          `   Items: ${items}  |  Concurrency: ${concurrency} per wave` +
            `  |  Max rounds per worker: ${maxRoundsPerWorker}`,
        );
        console.log(
          `   Overall timeout: ${Math.ceil(overallTimeoutMs / 60_000)} min` +
            `${explicitOverallTimeout ? ' (user override)' : ' (auto-scaled)'}`,
        );
        if (checkpointPath) {
          console.log(
            resumeRequested
              ? `   Resume checkpoint: ${checkpointPath}`
              : `   Checkpoint: ${checkpointPath}`,
          );
        }
        console.log('─'.repeat(60));
      }

      if (!jsonOutput && !opts.report && reportPath) {
        console.warn(`⚠️ Legacy output flag detected. Use "--report ${reportPath}" for research report files.`);
      }

      // Deep Research (opt-in, Phase A) — deterministic, cited pipeline. Routed
      // FIRST and independently of TTY (it is automation-friendly). Strictly
      // gated: without `--deep`, the Wide/direct paths below run byte-identically.
      const { maybeRunDeepResearch, runDeepResearchCli } = await import('./deep.js');
      // Phase B: --iterations > 1 turns the single Phase-A round into the bounded
      // gap loop. Default '1' ⇒ Phase A byte-identical (the loop delegates).
      const deepRounds = Math.max(1, Math.min(5, parseInt(opts.iterations, 10) || 1));
      // Phase C (STORM): --perspectives N (or --storm ⇒ 4) turns Deep Research
      // into the multi-perspective outline-first pipeline. STORM implies --deep
      // and TAKES PRECEDENCE over --iterations (per-perspective single round).
      const perspectivesN = Math.max(0, Math.min(6, parseInt(opts.perspectives, 10) || 0));
      const stormRequested = Boolean(opts.storm) || perspectivesN > 0;
      const stormPerspectives = stormRequested ? perspectivesN || 4 : undefined;
      const deepEnabled = Boolean(opts.deep) || stormRequested; // STORM implies --deep
      // Phase D (CKG bridge): opt-in via --ckg OR the shared CODEBUDDY_COLLECTIVE_MEMORY
      // gate. Rides on the deep path (inert without --deep). Off ⇒ A/B/C byte-identical.
      const { resolveCkgEnabled } = await import('../../agent/deep-research-ckg.js');
      const ckgEnabled = resolveCkgEnabled({ ckg: Boolean(opts.ckg) });
      const deepHandled = await maybeRunDeepResearch({ deep: deepEnabled }, () =>
        runDeepResearchCli(topic, apiKey, providerConfig, {
          deep: true,
          reportPath,
          providerLabel: resolved.providerLabel,
          deepOptions: { rounds: deepRounds },
          storm: stormRequested,
          perspectives: stormPerspectives,
          ckg: ckgEnabled,
        }),
      );
      if (deepHandled) return;

      // In non-interactive runs (CI/headless), prefer a direct single-pass research call.
      // This avoids long-lived worker handles and makes output deterministic for automation.
      // `--wide` opts back into the parallel-worker mode (a GUI subprocess is
      // non-TTY but may legitimately want the full Manus-style fan-out).
      const forceWide = Boolean(opts.wide) || durabilityRequested || jsonOutput;
      if (!forceWide && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        console.log('ℹ️ Non-interactive mode detected, using direct research mode.');
        try {
          const report = redactWideResearchText(
            await runDirectResearch(topic, apiKey, providerConfig, Math.min(overallTimeoutMs, 120_000)),
            [apiKey],
          );
          const reportContent = [
            `# Research Report: ${safeTopic}`,
            ``,
            `Generated: ${new Date().toISOString()}`,
            `Mode: direct`,
            `Provider: ${resolved.providerLabel}`,
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
          const message = redactWideResearchText(
            err instanceof Error ? err.message : String(err),
            [apiKey],
          );
          if (reportPath) {
            const outputPath = path.resolve(reportPath);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(
              outputPath,
              [
                `# Research Report: ${safeTopic}`,
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

      // CLI path: the agent constructor never ran, so wire the worker factory
      // that lets the orchestrator spawn sub-agents.
      const { ensureResearchWorkerFactory } = await import('./wire-research-worker.js');
      await ensureResearchWorkerFactory();

      const orchestrator = new WideResearchOrchestrator({
        items,
        concurrency,
        maxRoundsPerWorker,
        context: opts.context,
        workerTimeoutMs,
        overallTimeoutMs,
      });

      // A resumable run validates/creates its checkpoint inside research(). Do
      // not overwrite an existing Markdown report with a "Running" placeholder
      // before that validation succeeds. Historical non-durable behavior stays
      // unchanged.
      if (reportPath && !durabilityRequested) {
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
      let researchSettled = false;
      const hardStopTimer = setTimeout(() => {
        if (researchSettled) {
          // A timed-out provider operation outlived the completed CLI result.
          // Keep stdout single-document-safe and terminate silently.
          process.exit(1);
          return;
        }
        try {
          if (reportPath) {
            const outputPath = path.resolve(reportPath);
            const timeoutReport = [
                `# Research Report: ${safeTopic}`,
                '',
                `Generated: ${new Date().toISOString()}`,
                `Status: Timed out after ${overallTimeoutMs}ms`,
                '',
                'The research process exceeded the configured timeout and was terminated.',
              ].join('\n');
            if (durabilityRequested) {
              writeWideResearchTextAtomicSync(outputPath, timeoutReport);
            } else {
              fsSync.mkdirSync(path.dirname(outputPath), { recursive: true });
              fsSync.writeFileSync(outputPath, timeoutReport, 'utf-8');
            }
          }
        } catch {
          // Best effort: if writing fallback report fails, still terminate the hanging process.
        }

        if (jsonOutput) {
          console.log(JSON.stringify({
            kind: 'wide_research_run',
            status: 'failed',
            error: `Research hard-timeout reached (${overallTimeoutMs}ms).`,
            ...(checkpointPath ? { checkpointPath } : {}),
          }));
        } else {
          console.error(`\n❌ Research hard-timeout reached (${overallTimeoutMs}ms). Terminating process.`);
        }
        process.exit(1);
      }, hardStopTimeoutMs);

      // Stream progress events
      if (!jsonOutput) {
        orchestrator.on('progress', (event: { type: string; subtopics?: string[]; workerIndex?: number; subtopic?: string; success?: boolean; successCount?: number; pendingCount?: number; waveIndex?: number; waveCount?: number; itemCount?: number; completedCount?: number }) => {
          switch (event.type) {
            case 'resumed':
              console.log(
                `\n↻ Resume: ${event.successCount ?? 0} worker(s) already successful, ` +
                  `${event.pendingCount ?? 0} pending.`,
              );
              break;
            case 'decomposed':
              console.log(`\n📋 Subtopics (${event.subtopics?.length}):`);
              event.subtopics?.forEach((s, i) =>
                console.log(`  ${i + 1}. ${redactWideResearchText(s, [apiKey])}`),
              );
              console.log('');
              break;
            case 'wave_start':
              console.log(
                `\n🌊 Wave ${event.waveIndex ?? 0}/${event.waveCount ?? 0}` +
                  ` — ${event.itemCount ?? 0} item(s)`,
              );
              break;
            case 'wave_done':
              console.log(
                `  💾 Wave ${event.waveIndex ?? 0}/${event.waveCount ?? 0} checkpointed` +
                  ` — ${event.completedCount ?? 0} successful item(s)`,
              );
              break;
            case 'worker_start':
              console.log(
                `  ▶ [${event.workerIndex! + 1}] Starting: ` +
                  redactWideResearchText(event.subtopic ?? '', [apiKey]),
              );
              break;
            case 'worker_done': {
              const icon = event.success ? '✅' : '❌';
              console.log(
                `  ${icon} [${event.workerIndex! + 1}] Done: ` +
                  redactWideResearchText(event.subtopic ?? '', [apiKey]),
              );
              break;
            }
            case 'aggregating':
              console.log('\n🔗 Aggregating results into final report...');
              break;
          }
        });
      }

      try {
        const result = checkpointPath
          ? await orchestrator.research(topic, apiKey, providerConfig, {
              ...(resumeRequested
                ? { resumePath: checkpointPath }
                : { checkpointPath }),
            })
          : await orchestrator.research(topic, apiKey, providerConfig);
        const safeResult = redactWideResearchResult(result, [apiKey]);
        const totalWorkers = safeResult.subtopics.length;
        const succeededWorkers = Math.min(
          Math.max(0, safeResult.successCount),
          totalWorkers,
        );
        const failedWorkers = totalWorkers - succeededWorkers;
        const runStatus = totalWorkers > 0 && failedWorkers === 0
          ? 'completed'
          : succeededWorkers > 0
            ? 'partial'
            : 'failed';

        if (!jsonOutput) {
          console.log('\n' + '─'.repeat(60));
          if (durabilityRequested && runStatus !== 'completed') {
            console.log(
              runStatus === 'partial'
                ? '⚠️ Research partial — resume is still useful.'
                : '❌ Research workers failed — resume is required.',
            );
          } else {
            console.log(`✅ Research complete!`);
          }
          console.log(`   Workers succeeded: ${succeededWorkers}/${totalWorkers}`);
          console.log(`   Duration: ${(safeResult.durationMs / 1000).toFixed(1)}s`);
        }

        if (reportPath) {
          const reportContent = [
            `# Research Report: ${safeResult.topic}`,
            ``,
            `Generated: ${new Date().toISOString()}`,
            ...(durabilityRequested || jsonOutput ? [`Status: ${runStatus}`] : []),
            `Workers: ${succeededWorkers}/${totalWorkers} succeeded`,
            `Duration: ${(safeResult.durationMs / 1000).toFixed(1)}s`,
            ``,
            `---`,
            ``,
            safeResult.report,
          ].join('\n');

          const outputPath = path.resolve(reportPath);
          if (durabilityRequested) {
            await writeWideResearchTextAtomic(outputPath, reportContent);
          } else {
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, reportContent, 'utf-8');
          }
          if (!jsonOutput) console.log(`\n📄 Report saved: ${reportPath}`);
        } else if (!jsonOutput) {
          console.log('\n' + safeResult.report);
        }
        if (!jsonOutput && checkpointPath) {
          console.log(
            `\n💾 Checkpoint ${runStatus === 'completed' ? 'complete' : 'saved for resume'}: ` +
              checkpointPath,
          );
        }
        if (jsonOutput) {
          console.log(JSON.stringify({
            kind: 'wide_research_run',
            status: runStatus,
            summary: {
              succeeded: succeededWorkers,
              failed: failedWorkers,
              total: totalWorkers,
            },
            resumeAvailable: Boolean(checkpointPath && failedWorkers > 0),
            checkpoint: checkpointPath
              ? { path: checkpointPath, mode: resumeRequested ? 'resumed' : 'created' }
              : null,
            result: safeResult,
          }, null, 2));
        }
        if ((jsonOutput || durabilityRequested) && runStatus !== 'completed') {
          process.exitCode = 1;
        }
      } catch (err) {
        const message = redactWideResearchText(
          err instanceof Error ? err.message : String(err),
          [apiKey],
        );
        if (jsonOutput) {
          console.log(JSON.stringify({
            kind: 'wide_research_run',
            status: 'failed',
            error: message,
            ...(checkpointPath ? { checkpointPath } : {}),
          }));
          process.exitCode = 1;
        } else if (durabilityRequested) {
          console.error(`\n❌ Research checkpoint failed: ${message}`);
          process.exitCode = 1;
        } else {
          console.error(`\n❌ Research failed: ${message}`);
          process.exit(1);
        }
      } finally {
        researchSettled = true;
        if (orchestrator.hasPendingTimedOutOperations?.()) {
          orchestrator.once('timed_out_operations_settled', () => clearTimeout(hardStopTimer));
          hardStopTimer.unref();
        } else {
          clearTimeout(hardStopTimer);
        }
      }
    });

  // `buddy research ingest|recall|stats` — feed/query the collective knowledge graph with
  // real scientific publications (Patrice's vision). Subcommands take precedence over the
  // default <topic> action, so `research "topic"` still runs Wide Research.
  addKnowledgeSubcommands(cmd);

  return cmd;
}
