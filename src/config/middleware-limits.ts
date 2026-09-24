/**
 * Limites de session lues dans [middleware].
 *
 * Une clé absente du fichier ne vaut pas le défaut du schéma : les constantes
 * historiques restent en vigueur. Priorité : option de ligne de commande,
 * clé explicite (profil, puis projet, puis utilisateur), variable MAX_COST
 * pour le coût seulement, puis la constante.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getRequestedProfile } from '../cli/requested-profile.js';
import { parseTOML, resolveUserConfigFile } from './toml-config.js';

/** Tours d'outils hors YOLO, quand rien n'est écrit. */
export const HISTORICAL_MAX_TOOL_ROUNDS = 50;
/** Tours d'outils en YOLO, quand rien n'est écrit. */
export const HISTORICAL_YOLO_MAX_TOOL_ROUNDS = 400;
/** Plafond de coût hors YOLO, en dollars. */
export const HISTORICAL_SESSION_COST_USD = 10;
/** Plafond de coût en YOLO, en dollars. */
export const HISTORICAL_YOLO_SESSION_COST_USD = 100;
/** Plafond dur déjà appliqué au coût YOLO : 100 × 10. */
export const YOLO_SESSION_COST_HARD_CAP_USD = 1000;
/** Seuil d'avertissement des tours, fraction du plafond. */
export const HISTORICAL_TURN_WARNING_RATIO = 0.8;
/** Seuil d'avertissement du coût, fraction du plafond. */
export const HISTORICAL_COST_WARNING_RATIO = 0.8;

export interface ExplicitMiddlewareLimits {
  maxTurns?: number;
  turnWarningRatio?: number;
  maxCostUsd?: number;
  costWarningRatio?: number;
  autoCompactTokens?: number;
}

export interface SessionLimitResolution {
  maxToolRounds: number;
  sessionCostUsd: number;
  turnWarningRatio: number;
  costWarningRatio: number;
  autoCompactTokens?: number;
}

export interface SessionLimitInput {
  cliMaxToolRounds?: number;
  cliMaxCost?: number;
  envMaxCost?: number;
  toml?: ExplicitMiddlewareLimits;
  yolo: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function accept(field: keyof ExplicitMiddlewareLimits, value: unknown): number | undefined {
  const number = finite(value);
  if (number === undefined) return undefined;
  if (field === 'turnWarningRatio' || field === 'costWarningRatio') {
    return number > 0 && number <= 1 ? number : undefined;
  }
  if (field === 'maxCostUsd') return number >= 0 ? number : undefined;
  return number > 0 ? number : undefined;
}

const FILE_FIELDS: ReadonlyArray<readonly [string, keyof ExplicitMiddlewareLimits]> = [
  ['max_turns', 'maxTurns'],
  ['turn_warning_threshold', 'turnWarningRatio'],
  ['max_cost', 'maxCostUsd'],
  ['cost_warning_threshold', 'costWarningRatio'],
  ['auto_compact_threshold', 'autoCompactTokens'],
];

function overlay(target: ExplicitMiddlewareLimits, table: unknown): void {
  if (!isRecord(table)) return;
  for (const [key, field] of FILE_FIELDS) {
    if (!Object.hasOwn(table, key)) continue;
    const value = accept(field, table[key]);
    if (value !== undefined) target[field] = value;
  }
}

function readDocument(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = parseTOML(readFileSync(file, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function profileTable(document: Record<string, unknown> | undefined, name: string): unknown {
  if (!document) return undefined;
  const profiles = isRecord(document.profiles) ? document.profiles : undefined;
  if (!profiles) return undefined;
  // Le parseur historique aplatit [profiles.nom.middleware] en une seule clé.
  const flat = profiles[`${name}.middleware`];
  if (isRecord(flat)) return flat;
  const entry = isRecord(profiles[name]) ? profiles[name] : undefined;
  return isRecord(entry) ? entry.middleware : undefined;
}

function allowUserFile(env: NodeJS.ProcessEnv): boolean {
  if (env.CODEBUDDY_CONFIG?.trim()) return true;
  if (env.CODEBUDDY_HOME?.trim()) return true;
  return env.VITEST !== 'true';
}

export interface LoadMiddlewareOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  argv?: readonly string[];
}

/**
 * Clés présentes dans les fichiers, pas les défauts du schéma.
 * Le projet recouvre l'utilisateur, le profil demandé recouvre les deux.
 */
export function loadExplicitMiddlewareLimits(
  options: LoadMiddlewareOptions = {},
): ExplicitMiddlewareLimits {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const argv = options.argv ?? process.argv;
  const limits: ExplicitMiddlewareLimits = {};
  const userFile = allowUserFile(env) ? resolveUserConfigFile(env) : undefined;
  const projectFile = join(cwd, '.codebuddy', 'config.toml');
  const userDoc = userFile ? readDocument(userFile) : undefined;
  const projectDoc = readDocument(projectFile);
  overlay(limits, userDoc?.middleware);
  overlay(limits, projectDoc?.middleware);
  const requested = getRequestedProfile(argv);
  if (requested.kind === 'value') {
    overlay(limits, profileTable(userDoc, requested.name));
    overlay(limits, profileTable(projectDoc, requested.name));
  }
  return limits;
}

export function readCliFlagValue(argv: readonly string[], name: string): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') break;
    if (arg === name) {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) return undefined;
      return next;
    }
    if (arg?.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1);
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

function firstUsable(values: Array<number | undefined>, acceptValue: (value: number) => boolean): number | undefined {
  for (const value of values) {
    if (value !== undefined && Number.isFinite(value) && acceptValue(value)) return value;
  }
  return undefined;
}

/** Résout les limites. Les constantes historiques ne bougent que si une source les remplace. */
export function resolveSessionLimits(input: SessionLimitInput): SessionLimitResolution {
  const toml = input.toml ?? {};
  const historicalRounds = input.yolo ? HISTORICAL_YOLO_MAX_TOOL_ROUNDS : HISTORICAL_MAX_TOOL_ROUNDS;
  const historicalCost = input.yolo ? HISTORICAL_YOLO_SESSION_COST_USD : HISTORICAL_SESSION_COST_USD;
  const rounds = firstUsable(
    [input.cliMaxToolRounds, toml.maxTurns, historicalRounds],
    (value) => value > 0,
  ) ?? historicalRounds;
  const requestedCost = firstUsable(
    [input.cliMaxCost, toml.maxCostUsd, input.envMaxCost, historicalCost],
    (value) => value >= 0,
  ) ?? historicalCost;
  const sessionCostUsd = input.yolo
    ? Math.min(requestedCost, YOLO_SESSION_COST_HARD_CAP_USD)
    : requestedCost;
  const resolved: SessionLimitResolution = {
    maxToolRounds: rounds,
    sessionCostUsd,
    turnWarningRatio: toml.turnWarningRatio ?? HISTORICAL_TURN_WARNING_RATIO,
    costWarningRatio: toml.costWarningRatio ?? HISTORICAL_COST_WARNING_RATIO,
  };
  if (toml.autoCompactTokens !== undefined) resolved.autoCompactTokens = toml.autoCompactTokens;
  return resolved;
}
