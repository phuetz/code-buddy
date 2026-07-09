/**
 * `buddy widgets` — inspect, preview and generate inline conversation widgets.
 * Mirrors `buddy improve skills`. Curated widgets are always available; authored
 * ones are generated on the fly and reused (see src/widgets/widget-engine).
 *
 * @module commands/widgets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { logger } from '../utils/logger.js';
import {
  authoredWidgetsDir,
  renderWidgetForData,
  resolveWidgetSource,
} from '../widgets/widget-registry.js';
import { listAuthoredWidgets, keepAuthoredWidget } from '../widgets/widget-engine.js';
import { proposeWidget } from '../widgets/widget-proposer.js';
import { gateWidget } from '../widgets/widget-gate.js';

const CURATED_KINDS = ['weather', 'news', 'stock', 'market', 'bourse'] as const;

/** Built-in sample payloads so `preview` works for curated kinds with no --sample. */
const SAMPLES: Record<string, unknown> = {
  weather: {
    type: 'weather',
    location: 'Paris',
    current: { temperature: 22, feelsLike: 24, condition: 'ensoleillé', humidity: 66, windSpeed: 6 },
    forecast: [
      { day: 'jeu', min: 15, max: 24, condition: 'ensoleillé' },
      { day: 'ven', min: 14, max: 21, condition: 'nuageux' },
    ],
    units: 'metric',
  },
  news: {
    type: 'news',
    title: 'À la une',
    items: [
      { title: 'Un titre d\'actualité', source: 'Le Monde' },
      { title: 'Un autre titre', source: 'AFP' },
    ],
  },
  stock: {
    type: 'stock',
    name: 'Apple Inc.',
    symbol: 'AAPL',
    price: 226.34,
    change: 3.12,
    changePercent: 1.4,
    currency: 'USD',
    open: 223.5,
    high: 227.1,
    low: 222.8,
    previousClose: 223.22,
    volume: 48200000,
    market: 'NASDAQ',
    time: 'Clôture',
  },
  market: {
    type: 'market',
    name: 'CAC 40',
    symbol: 'PX1',
    value: 7654.2,
    change: -42.8,
    changePercent: -0.56,
    high: 7712.0,
    low: 7640.1,
    previousClose: 7697.0,
    market: 'Euronext Paris',
    time: '17:35',
  },
};
SAMPLES.bourse = { ...(SAMPLES.market as object), type: 'bourse' };

function parseSample(raw: string | undefined, kind: string): unknown {
  if (raw && raw.trim()) {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !(parsed as { type?: unknown }).type) {
      (parsed as Record<string, unknown>).type = kind;
    }
    return parsed;
  }
  const s = SAMPLES[kind];
  if (!s) throw new Error(`no built-in sample for "${kind}" — pass --sample '<json>'`);
  return s;
}

export function registerWidgetsCommand(program: Command): void {
  const widgets = program
    .command('widgets')
    .description('Inline conversation widgets: list, preview, and generate (authored) widgets');

  widgets
    .command('list')
    .description('List curated and authored widgets')
    .action(() => {
      logger.info('Curated widgets:');
      for (const k of CURATED_KINDS) logger.info(`  • ${k}`);
      const authored = listAuthoredWidgets();
      logger.info(`\nAuthored widgets (${authored.length}):`);
      if (authored.length === 0) logger.info('  (none yet — generated on demand with CODEBUDDY_WIDGETS=true)');
      for (const k of authored) logger.info(`  • ${k}  (authored-${k}/widget.html)`);
    });

  widgets
    .command('preview <kind>')
    .description('Render a widget to an HTML file and print its path')
    .option('--sample <json>', 'sample data payload (JSON); defaults to a built-in sample for curated kinds')
    .action((kind: string, opts: { sample?: string }) => {
      try {
        const data = parseSample(opts.sample, kind);
        const doc = renderWidgetForData(data);
        if (!doc) {
          logger.error(`No widget renders "${kind}". Curated: ${CURATED_KINDS.join(', ')}; authored: ${listAuthoredWidgets().join(', ') || '(none)'}.`);
          process.exitCode = 1;
          return;
        }
        const dir = authoredWidgetsDir();
        mkdirSync(dir, { recursive: true });
        const out = join(dir, `preview-${kind}.html`);
        writeFileSync(out, doc);
        logger.info(`Preview written: ${out}`);
        logger.info(`Source: ${resolveWidgetSource(kind) ?? 'unknown'}`);
      } catch (e) {
        logger.error(`preview failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
      }
    });

  widgets
    .command('gen <kind>')
    .description('Generate (LLM) an authored widget for a kind, gate it, and keep it if safe')
    .option('--sample <json>', 'sample data payload (JSON) to design against')
    .option('--brief <text>', 'design intention for the proposer')
    .action(async (kind: string, opts: { sample?: string; brief?: string }) => {
      try {
        if (resolveWidgetSource(kind) === 'curated') {
          logger.error(`"${kind}" is a curated widget — authored widgets can never shadow it.`);
          process.exitCode = 1;
          return;
        }
        const data = parseSample(opts.sample, kind);
        logger.info(`Proposing a widget for "${kind}"…`);
        const proposal = await proposeWidget(kind, data, opts.brief);
        if (!proposal) {
          logger.error('No proposal (LLM unavailable or empty). Ensure a provider is configured (buddy login).');
          process.exitCode = 1;
          return;
        }
        const verdict = gateWidget(proposal);
        if (!verdict.accepted) {
          logger.error(`Rejected by gate (${verdict.reason}): ${(verdict.reasons ?? []).join('; ')}`);
          process.exitCode = 1;
          return;
        }
        const kept = keepAuthoredWidget(proposal);
        if (!kept) {
          logger.error('Passed the gate but could not be persisted.');
          process.exitCode = 1;
          return;
        }
        logger.info(`✓ Kept authored-${kind}/widget.html. Preview: buddy widgets preview ${kind}`);
      } catch (e) {
        logger.error(`gen failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
      }
    });
}
