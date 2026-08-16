/** `buddy cost` — read-only cost dashboard over persisted session JSON. */

import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import {
  aggregateCostReport,
  parseCostSince,
  type CostBreakdown,
  type CostGroupBy,
  type CostPricing,
  type CostPricingResolver,
  type CostReport,
  type CostSessionEntry,
} from '../analytics/cost-report.js';
import { getModelPricing } from '../config/model-pricing.js';
import { logger } from '../utils/logger.js';

export interface CostCommandOptions {
  last?: boolean;
  session?: string;
  since?: string;
  by: CostGroupBy;
  json?: boolean;
}

export interface SavedCostSessions {
  sessions: CostSessionEntry[];
  warnings: string[];
}

export interface CostCommandDependencies {
  sessionsDirectory?: string;
  loadSessions?: () => Promise<SavedCostSessions | readonly CostSessionEntry[]>;
  now?: () => Date;
  resolvePricing?: CostPricingResolver;
  stdout?: (message: string) => void;
}

const UNMETERED_PROVIDERS = new Set([
  'agy-cli',
  'chatgpt',
  'chatgpt-oauth',
  'copilot',
  'gemini-cli',
  'lemonade',
  'lmstudio',
  'ollama',
  'vllm',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function sessionId(entry: CostSessionEntry): string | undefined {
  for (const key of ['id', 'sessionId', 'session_id']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function sessionCandidates(value: unknown): CostSessionEntry[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  const nested = value.sessions;
  if (Array.isArray(nested)) return nested.filter(isRecord);
  if (isRecord(nested)) return Object.values(nested).filter(isRecord);

  return sessionId(value) ? [value] : [];
}

/** Read all recognized JSON session shapes without creating or changing files. */
export async function readSavedCostSessions(directory: string): Promise<SavedCostSessions> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return { sessions: [], warnings: [] };
    return {
      sessions: [],
      warnings: [
        `Impossible de lire le dossier des sessions : ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const sessions = new Map<string, { entry: CostSessionEntry; priority: number }>();
  const warnings: string[] = [];
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of jsonFiles) {
    const filePath = path.join(directory, entry.name);
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const candidates = sessionCandidates(parsed);
      const isLegacyContainer = isRecord(parsed) && 'sessions' in parsed;
      if (candidates.length === 0) {
        // `sessions.json` can legitimately be an empty legacy container.
        if (!(isRecord(parsed) && ('sessions' in parsed || 'messages' in parsed))) {
          warnings.push(`Format de session ignoré : ${entry.name}`);
        }
        continue;
      }
      candidates.forEach((candidate, index) => {
        const id = sessionId(candidate) ?? `${entry.name}#${index}`;
        // A dedicated per-session file is authoritative over a legacy
        // container regardless of filename ordering.
        const priority = isLegacyContainer ? 0 : 1;
        const existing = sessions.get(id);
        if (!existing || priority >= existing.priority) {
          sessions.set(id, { entry: candidate, priority });
        }
      });
    } catch (error) {
      warnings.push(
        `Session illisible ignorée (${entry.name}) : ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return { sessions: [...sessions.values()].map(({ entry }) => entry), warnings };
}

function parseGroupBy(value: string): CostGroupBy {
  if (value === 'model' || value === 'provider' || value === 'day') return value;
  throw new InvalidArgumentError('`--by` doit valoir `model`, `provider` ou `day`.');
}

function validateSince(value: string): string {
  try {
    parseCostSince(value);
    return value;
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
}

function timestampNumber(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function latestSessionTimestamp(entry: CostSessionEntry): number {
  const metadata = isRecord(entry.metadata) ? entry.metadata : undefined;
  for (const record of [entry, metadata]) {
    if (!record) continue;
    for (const key of [
      'lastAccessedAt',
      'last_accessed_at',
      'updatedAt',
      'updated_at',
      'createdAt',
      'created_at',
    ]) {
      const value = timestampNumber(record[key]);
      if (value !== undefined) return value;
    }
  }
  return Number.NEGATIVE_INFINITY;
}

function selectSessions(
  sessions: readonly CostSessionEntry[],
  options: CostCommandOptions
): CostSessionEntry[] {
  if (options.last && options.session) {
    throw new Error('`--last` et `--session` sont incompatibles.');
  }
  if (options.session) {
    const requested = options.session.trim();
    const match = sessions.find((entry) => sessionId(entry) === requested);
    if (!match) throw new Error(`Session introuvable : ${requested}`);
    return [match];
  }
  if (options.last) {
    const latest = [...sessions].sort(
      (left, right) => latestSessionTimestamp(right) - latestSessionTimestamp(left)
    )[0];
    return latest ? [latest] : [];
  }
  return [...sessions];
}

/** Reuse the canonical model registry and preserve known flat-fee/local routes. */
export function resolveCostPricing(model: string, provider: string): CostPricing {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = model.toLowerCase();
  if (
    UNMETERED_PROVIDERS.has(normalizedProvider) ||
    normalizedModel === 'openrouter/free' ||
    normalizedModel.endsWith(':free')
  ) {
    return { inputPerMillion: 0, outputPerMillion: 0 };
  }
  return getModelPricing(model);
}

function formatUsd(value: number): string {
  if (value === 0) return '$0.0000';
  if (Math.abs(value) < 0.0001) return `$${value.toFixed(6)}`;
  if (Math.abs(value) < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatInteger(count)} ${count === 1 ? singular : pluralForm}`;
}

function qualityLabel(breakdown: CostBreakdown): string {
  const labels: string[] = [];
  if (breakdown.estimatedTurns > 0)
    labels.push(`${formatInteger(breakdown.estimatedTurns)} estimé(s)`);
  if (breakdown.unknownCostTurns > 0) {
    labels.push(`${formatInteger(breakdown.unknownCostTurns)} inconnu(s)`);
  }
  return labels.length > 0 ? labels.join(', ') : 'stocké';
}

function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0))
  );
  const numericColumns = new Set([1, 2, 3, 4, 5]);
  const renderRow = (row: readonly string[]): string =>
    row
      .map((cell, column) =>
        numericColumns.has(column)
          ? cell.padStart(widths[column] ?? cell.length)
          : cell.padEnd(widths[column] ?? cell.length)
      )
      .join('  ')
      .trimEnd();
  return [
    renderRow(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(renderRow),
  ].join('\n');
}

function selectedBreakdown(
  report: CostReport,
  groupBy: CostGroupBy
): Record<string, CostBreakdown> {
  if (groupBy === 'provider') return report.byProvider;
  if (groupBy === 'day') return report.byDay;
  return report.byModel;
}

/** Render the default aligned, human-readable dashboard. */
export function formatCostReport(report: CostReport, groupBy: CostGroupBy = 'model'): string {
  if (report.sessions === 0) {
    return 'Aucune session sauvegardée ne correspond aux filtres.';
  }

  const lines = [
    'Code Buddy — tableau de bord des dépenses',
    '='.repeat(42),
    `Période       : ${report.since ? `depuis ${report.since}` : 'toutes les sessions'}`,
    `Sessions      : ${formatInteger(report.sessions)}`,
    `Tours         : ${formatInteger(report.turns)}`,
    `Coût total    : ${formatUsd(report.totalCost)}`,
    `Tokens        : ${formatInteger(report.tokens.input)} in / ${formatInteger(report.tokens.output)} out`,
    `Coût moyen    : ${formatUsd(report.averageCostPerTurn)} / tour`,
  ];

  if (report.tokens.unattributed > 0) {
    lines.push(`Tokens non ventilés : ${formatInteger(report.tokens.unattributed)}`);
  }
  if (report.estimatedTurns > 0) {
    lines.push(
      `Coût estimé  : ${formatUsd(report.estimatedCost)} (${plural(
        report.estimatedTurns,
        'tour',
        'tours'
      )})`
    );
  }
  if (report.unknownCostSessions > 0) {
    lines.push(
      `Coût inconnu : ${plural(report.unknownCostTurns, 'tour', 'tours')} dans ${plural(
        report.unknownCostSessions,
        'session',
        'sessions'
      )}`
    );
  }

  const labels: Record<CostGroupBy, string> = {
    model: 'Modèle',
    provider: 'Provider',
    day: 'Jour',
  };
  const breakdown = selectedBreakdown(report, groupBy);
  const rows = Object.entries(breakdown).map(([key, value]) => [
    key,
    formatUsd(value.cost),
    formatInteger(value.tokens.input),
    formatInteger(value.tokens.output),
    formatInteger(value.turns),
    formatUsd(value.averageCostPerTurn),
    qualityLabel(value),
  ]);

  if (rows.length > 0) {
    lines.push(
      '',
      `Ventilation par ${groupBy === 'day' ? 'jour' : groupBy === 'provider' ? 'provider' : 'modèle'}`,
      renderTable(
        [labels[groupBy], 'Coût', 'Tokens in', 'Tokens out', 'Tours', 'Moy./tour', 'Qualité'],
        rows
      )
    );
  }
  return lines.join('\n');
}

function normalizeLoadedSessions(
  value: SavedCostSessions | readonly CostSessionEntry[]
): SavedCostSessions {
  return Array.isArray(value)
    ? { sessions: [...value], warnings: [] }
    : (value as SavedCostSessions);
}

export function createCostCommand(dependencies: CostCommandDependencies = {}): Command {
  return new Command('cost')
    .description('Afficher les dépenses agrégées depuis les sessions sauvegardées (read-only)')
    .option('--last', 'Limiter le rapport à la session la plus récente', false)
    .option('--session <id>', 'Limiter le rapport à un ID de session')
    .option('--since <7d|YYYY-MM-DD>', 'Limiter les tours à une période', validateSince)
    .option('--by <model|provider|day>', 'Ventilation du tableau', parseGroupBy, 'model')
    .option('--json', 'Produire un JSON lisible par machine', false)
    .action(async (options: CostCommandOptions) => {
      const sessionsDirectory =
        dependencies.sessionsDirectory ??
        process.env.CODEBUDDY_SESSIONS_DIR ??
        path.join(os.homedir(), '.codebuddy', 'sessions');
      const loaded = normalizeLoadedSessions(
        await (dependencies.loadSessions
          ? dependencies.loadSessions()
          : readSavedCostSessions(sessionsDirectory))
      );
      for (const warning of loaded.warnings) logger.warn(`[cost] ${warning}`);

      const selected = selectSessions(loaded.sessions, options);
      const now = dependencies.now?.() ?? new Date();
      const report = aggregateCostReport(selected, {
        now,
        since: options.since,
        resolvePricing: dependencies.resolvePricing ?? resolveCostPricing,
      });
      const write =
        dependencies.stdout ?? ((message: string) => process.stdout.write(`${message}\n`));

      if (options.json) {
        const payload = {
          ...report,
          groupBy: options.by,
          ...(report.sessions === 0
            ? { message: 'Aucune session sauvegardée ne correspond aux filtres.' }
            : {}),
        };
        write(JSON.stringify(payload, null, 2));
        return;
      }
      write(formatCostReport(report, options.by));
    });
}
