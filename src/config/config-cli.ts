/**
 * Commandes `buddy config` hors session : set, patch, unset, schema.
 * La mutation reste dans config-mutator. Ce module ne fait que le contrat
 * de rapport `ok` / `operations` / `checks` / `errors`.
 */

import {
  patchConfigValue,
  setConfigBatch,
  setConfigValue,
  unsetConfigValue,
  type ConfigSetResult,
} from './config-mutator.js';
import {
  exportConfigSchema,
  nonAppliedDiagnosticNote,
  type JsonSchemaDocument,
} from './config-schema.js';

export interface ConfigOperation {
  op: 'set' | 'patch' | 'unset';
  key: string;
  oldValue: unknown;
  newValue: unknown;
  dryRun: boolean;
}

export interface ConfigCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ConfigCliReport {
  ok: boolean;
  operations: ConfigOperation[];
  checks: ConfigCheck[];
  errors: string[];
  notes?: string[];
}

function errorText(result: ConfigSetResult): string | null {
  if (result.success) return null;
  return result.error ?? 'échec';
}

function checksFor(results: ConfigSetResult[], dryRun: boolean): ConfigCheck[] {
  const errors = results.map(errorText).filter((item): item is string => item !== null);
  const unknown = errors.some((item) => /inconnue|refusée|refusé|Empty key path|Cannot navigate/i.test(item));
  const typed = errors.some((item) => /Type mismatch|n'est pas pris en charge|Valeur refusée/i.test(item));
  const backup: ConfigCheck = dryRun
    ? { name: 'backup', ok: true, detail: 'non exécuté' }
    : { name: 'backup', ok: errors.length === 0 };
  return [
    { name: 'known-key', ok: !unknown },
    { name: 'type', ok: !typed },
    { name: 'document', ok: errors.length === 0 },
    backup,
  ];
}

function notesFor(results: ConfigSetResult[]): string[] {
  const notes: string[] = [];
  for (const result of results) {
    const note = nonAppliedDiagnosticNote(result.key);
    if (note && !notes.includes(note)) notes.push(note);
  }
  return notes;
}

export function reportFromResults(
  op: ConfigOperation['op'],
  results: ConfigSetResult[],
  dryRun: boolean,
): ConfigCliReport {
  const errors = results.map(errorText).filter((item): item is string => item !== null);
  const notes = notesFor(results);
  return {
    ok: errors.length === 0,
    operations: results.map((result) => ({
      op,
      key: result.key,
      oldValue: result.oldValue,
      newValue: result.newValue,
      dryRun: result.dryRun,
    })),
    checks: checksFor(results, dryRun),
    errors,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

async function ensureCatalogueCheck(): Promise<void> {
  await import('./model-catalogue.js');
}

function parseCliValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

export async function runConfigSet(input: {
  key?: string;
  value?: string;
  batch?: Record<string, unknown>;
  dryRun?: boolean;
}): Promise<ConfigCliReport> {
  await ensureCatalogueCheck();
  const dryRun = input.dryRun === true;
  if (input.batch) {
    const results = await setConfigBatch(input.batch, { dryRun, json: true });
    return reportFromResults('set', results, dryRun);
  }
  if (!input.key || input.value === undefined) {
    const message = 'Usage: buddy config set [--dry-run] [--json] <clé> <valeur>';
    return {
      ok: false,
      operations: [],
      checks: [
        { name: 'known-key', ok: false },
        { name: 'type', ok: true },
        { name: 'document', ok: false },
        { name: 'backup', ok: true, detail: 'non exécuté' },
      ],
      errors: [message],
    };
  }
  const result = await setConfigValue(input.key, parseCliValue(input.value), { dryRun, json: true });
  return reportFromResults('set', [result], dryRun);
}

export async function runConfigPatch(input: {
  key?: string;
  value?: string;
  dryRun?: boolean;
}): Promise<ConfigCliReport> {
  await ensureCatalogueCheck();
  const dryRun = input.dryRun === true;
  if (!input.key || input.value === undefined) {
    return {
      ok: false,
      operations: [],
      checks: [
        { name: 'known-key', ok: false },
        { name: 'type', ok: true },
        { name: 'document', ok: false },
        { name: 'backup', ok: true, detail: 'non exécuté' },
      ],
      errors: ['Usage: buddy config patch [--dry-run] [--json] <clé> <json>'],
    };
  }
  const result = await patchConfigValue(input.key, parseCliValue(input.value), { dryRun, json: true });
  return reportFromResults('patch', [result], dryRun);
}

export async function runConfigUnset(input: {
  key?: string;
  dryRun?: boolean;
}): Promise<ConfigCliReport> {
  await ensureCatalogueCheck();
  const dryRun = input.dryRun === true;
  if (!input.key) {
    return {
      ok: false,
      operations: [],
      checks: [
        { name: 'known-key', ok: false },
        { name: 'type', ok: true },
        { name: 'document', ok: false },
        { name: 'backup', ok: true, detail: 'non exécuté' },
      ],
      errors: ['Usage: buddy config unset [--dry-run] [--json] <clé>'],
    };
  }
  const result = await unsetConfigValue(input.key, { dryRun, json: true });
  return reportFromResults('unset', [result], dryRun);
}

export function runConfigSchema(): JsonSchemaDocument {
  return exportConfigSchema();
}

/** Variables d'environnement et TOML actif. Un fichier absent n'est pas une erreur. */
export async function runConfigValidate(): Promise<{
  ok: boolean;
  envErrors: string[];
  envWarnings: string[];
  tomlProblem: string | null;
}> {
  await ensureCatalogueCheck();
  const { validateEnv } = await import('./env-schema.js');
  const { assessUserConfigText, resolveUserConfigFile } = await import('./toml-config.js');
  const { existsSync, readFileSync } = await import('node:fs');
  const envResult = validateEnv();
  const file = resolveUserConfigFile();
  const tomlProblem = existsSync(file) ? assessUserConfigText(readFileSync(file, 'utf8')) : null;
  return {
    ok: envResult.valid && tomlProblem == null,
    envErrors: envResult.errors,
    envWarnings: envResult.warnings,
    tomlProblem,
  };
}

export function formatConfigReport(report: ConfigCliReport, json: boolean): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [`ok: ${report.ok ? 'true' : 'false'}`];
  for (const note of report.notes ?? []) lines.push(`note: ${note}`);
  for (const operation of report.operations) {
    lines.push(`${operation.op} ${operation.key} dryRun=${operation.dryRun ? 'true' : 'false'}`);
  }
  for (const check of report.checks) {
    lines.push(`check ${check.name}: ${check.ok ? 'ok' : 'échec'}${check.detail ? ` (${check.detail})` : ''}`);
  }
  for (const error of report.errors) lines.push(`error: ${error}`);
  return `${lines.join('\n')}\n`;
}
