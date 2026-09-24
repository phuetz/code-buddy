/**
 * Config Mutator — Set config values via dot-notation key paths.
 *
 * Supports:
 * - Dot-notation navigation (e.g., `middleware.max_turns`)
 * - Type validation at the destination
 * - Dry-run mode (preview without writing)
 * - JSON mode (structured result output)
 * - SecretRef stockée telle quelle (`${env:...}`, `${file:...}`), résolue à l'usage
 * - Batch JSON updates
 */

import { logger } from '../utils/logger.js';
import type { CodeBuddyConfig } from './toml-config.js';
import {
  USER_CONFIG_DELETE,
  classifyConfigPath,
  configSegmentError,
  readOwnPath,
  validateConfigValue,
} from './config-schema.js';

async function lazyGetConfigManager() {
  const { getConfigManager } = await import('./toml-config.js');
  return getConfigManager();
}

// ============================================================================
// Types
// ============================================================================

export interface ConfigSetResult {
  success: boolean;
  key: string;
  oldValue: unknown;
  newValue: unknown;
  dryRun: boolean;
  error?: string;
  warning?: string;
}

export interface ConfigSetOptions {
  dryRun?: boolean;
  json?: boolean;
}

// ============================================================================
// Type Validation
// ============================================================================

/**
 * Validate that a value matches the expected type at a config leaf.
 * Returns null if valid, or an error message if not.
 */
function validateValueType(currentValue: unknown, newValue: unknown): string | null {
  // If the existing value is undefined/null, accept anything
  if (currentValue === undefined || currentValue === null) {
    return null;
  }

  const expectedType = typeof currentValue;
  const actualType = typeof newValue;

  // Allow string-to-number coercion for numeric fields
  if (expectedType === 'number' && actualType === 'string') {
    const parsed = Number(newValue);
    if (!isNaN(parsed)) return null;
    return `Expected number, got non-numeric string "${newValue}"`;
  }

  // Allow string-to-boolean coercion
  if (expectedType === 'boolean' && actualType === 'string') {
    if (newValue === 'true' || newValue === 'false') return null;
    return `Expected boolean (true/false), got "${newValue}"`;
  }

  // Object → object (arrays are objects too)
  if (expectedType === 'object' && actualType === 'object') {
    return null;
  }

  if (expectedType !== actualType) {
    return `Expected ${expectedType}, got ${actualType}`;
  }

  return null;
}

/**
 * Coerce a string value to match the expected type.
 */
function isSecretReference(value: unknown): value is string {
  return typeof value === 'string' && (
    /\$\{[a-z][\w-]*:[^}]+\}/.test(value) || value.startsWith('op://')
  );
}

function coerceValue(currentValue: unknown, rawValue: unknown): unknown {
  if (isSecretReference(rawValue)) return rawValue;
  if (currentValue === undefined || currentValue === null) {
    return rawValue;
  }

  const expectedType = typeof currentValue;

  if (expectedType === 'number' && typeof rawValue === 'string') {
    return Number(rawValue);
  }

  if (expectedType === 'boolean' && typeof rawValue === 'string') {
    return rawValue === 'true';
  }

  return rawValue;
}

/**
 * Validate SecretRef patterns in a value.
 * Returns a warning if env vars are missing, or null if OK.
 */
async function validateSecretRef(value: string): Promise<string | null> {
  const envMatches = [...value.matchAll(/\$\{env:([^}]+)\}/g)];
  for (const match of envMatches) {
    const envName = match[1];
    if (envName === undefined) continue;
    if (process.env[envName] === undefined) {
      return `Environment variable "${envName}" is not set — SecretRef will resolve to empty string`;
    }
  }

  const fileMatches = [...value.matchAll(/\$\{file:([^}]+)\}/g)];
  for (const match of fileMatches) {
    const filePath = match[1];
    if (filePath === undefined) continue;
    try {
      const fs = await import('fs');
      if (!fs.existsSync(filePath)) {
        return `File "${filePath}" does not exist — SecretRef will resolve to empty string`;
      }
    } catch {
      return `Cannot check file "${filePath}" — SecretRef may resolve to empty string`;
    }
  }

  return null;
}

// ============================================================================
// Core: navigate dot-notation path and set value
// ============================================================================

/**
 * Navigate into a config object using a dot-notation key path.
 * Returns the parent object, the leaf key, and the current value.
 */
function navigateKeyPath(
  config: Record<string, unknown>,
  keyPath: string,
): { parent: Record<string, unknown>; leafKey: string; currentValue: unknown } | { error: string } {
  const parts = keyPath.split('.');

  if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) {
    return { error: 'Empty key path' };
  }

  // Single key — top-level assignment
  if (parts.length === 1) {
    const singleKey = parts[0];
    if (singleKey === undefined) {
      return { error: 'Empty key path' };
    }
    const denied = configSegmentError(keyPath, singleKey);
    if (denied) return { error: denied };
    return {
      parent: config,
      leafKey: singleKey,
      currentValue: Object.hasOwn(config, singleKey) ? config[singleKey] : undefined,
    };
  }

  // Multi-part — navigate to parent
  let current: Record<string, unknown> = config;
  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i];
    if (segment === undefined) continue; // safe: i < parts.length - 1, but satisfy noUncheckedIndexedAccess
    const denied = configSegmentError(keyPath, segment);
    if (denied) return { error: denied };
    const next = Object.hasOwn(current, segment) ? current[segment] : undefined;

    if (next === undefined || next === null) {
      // Auto-create intermediate objects
      current[segment] = {};
      current = current[segment] as Record<string, unknown>;
    } else if (typeof next === 'object' && !Array.isArray(next)) {
      current = next as Record<string, unknown>;
    } else {
      return { error: `Cannot navigate through non-object at "${parts.slice(0, i + 1).join('.')}" (type: ${typeof next})` };
    }
  }

  const leafKey = parts[parts.length - 1];
  if (leafKey === undefined) {
    return { error: 'Empty key path' };
  }
  const deniedLeaf = configSegmentError(keyPath, leafKey);
  if (deniedLeaf) return { error: deniedLeaf };
  return {
    parent: current,
    leafKey,
    currentValue: Object.hasOwn(current, leafKey) ? current[leafKey] : undefined,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Set a single config value by dot-notation key path.
 *
 * @param keyPath - Dot-notation path (e.g., `middleware.max_turns`)
 * @param value - The value to set
 * @param opts - Options (dryRun, json)
 */
function failure(
  keyPath: string,
  value: unknown,
  dryRun: boolean,
  error: string,
  oldValue?: unknown,
): ConfigSetResult {
  return {
    success: false,
    key: keyPath,
    oldValue,
    newValue: value,
    dryRun,
    error,
  };
}

async function noteRejection(keyPath: string, reason: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  const configManager = await lazyGetConfigManager() as {
    noteRejectedWrite?: (payload: string, reason: string) => string;
  };
  if (typeof configManager.noteRejectedWrite !== 'function') return;
  configManager.noteRejectedWrite(`# cle: ${keyPath}\n`, reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readAt(root: Record<string, unknown>, keyPath: string): unknown {
  const read = readOwnPath(root, keyPath);
  return read.ok ? read.value : undefined;
}

/** Feuilles d'un patch. `null` demande la suppression de cette feuille. */
function ownKeys(value: Record<string, unknown>): string[] {
  return Object.getOwnPropertyNames(value).filter((key) => Object.hasOwn(value, key));
}

function patchLeaves(prefix: string, value: unknown): Array<[string, unknown]> {
  if (isRecord(value)) {
    const keys = ownKeys(value);
    if (keys.length === 0) return [[prefix, value]];
    return keys.flatMap((key) => patchLeaves(prefix ? `${prefix}.${key}` : key, value[key]));
  }
  return [[prefix, value]];
}

function mergePatch(base: unknown, patch: unknown): unknown {
  if (patch === null) return undefined;
  if (isRecord(base) && isRecord(patch)) {
    const merged: Record<string, unknown> = { ...base };
    for (const key of ownKeys(patch)) {
      if (configSegmentError(key, key)) continue;
      const child = patch[key];
      if (child === null) {
        delete merged[key];
        continue;
      }
      const next = mergePatch(merged[key], child);
      if (next === undefined) delete merged[key];
      else merged[key] = next;
    }
    return merged;
  }
  return patch;
}

export async function setConfigValue(
  keyPath: string,
  value: unknown,
  opts?: ConfigSetOptions,
): Promise<ConfigSetResult> {
  const dryRun = opts?.dryRun ?? false;
  const classified = classifyConfigPath(keyPath);
  if (!classified.ok) {
    await noteRejection(keyPath, classified.message, dryRun);
    return failure(keyPath, value, dryRun, classified.message);
  }

  const configManager = await lazyGetConfigManager();
  const config = configManager.getConfig() as CodeBuddyConfig;

  // Navigate to the target
  const nav = navigateKeyPath(config as unknown as Record<string, unknown>, keyPath);
  if ('error' in nav) {
    return {
      success: false,
      key: keyPath,
      oldValue: undefined,
      newValue: value,
      dryRun,
      error: nav.error,
    };
  }

  const { parent, leafKey, currentValue } = nav;
  let storedValue = value;
  let warning: string | undefined;

  // La référence reste littérale. La résolution se fait à la lecture d'usage.
  if (isSecretReference(value)) {
    const secretWarning = await validateSecretRef(value);
    if (secretWarning) warning = secretWarning;
  }

  // Type validation
  const typeError = validateValueType(currentValue, storedValue);
  if (typeError) {
    const message = `Type mismatch for "${keyPath}": ${typeError}`;
    await noteRejection(keyPath, message, dryRun);
    return failure(keyPath, storedValue, dryRun, message, currentValue);
  }

  // Coerce the value to the expected type
  storedValue = coerceValue(currentValue, storedValue);
  const schemaError = validateConfigValue(keyPath, storedValue);
  if (schemaError) {
    await noteRejection(keyPath, schemaError, dryRun);
    return failure(keyPath, storedValue, dryRun, schemaError, currentValue);
  }

  const preview = (configManager as { previewUserWrite?: (key: string, next: unknown) => string | null })
    .previewUserWrite;
  if (dryRun) {
    const problem = preview?.call(configManager, keyPath, storedValue) ?? null;
    if (problem) return failure(keyPath, storedValue, true, problem, currentValue);
    const result: ConfigSetResult = {
      success: true,
      key: keyPath,
      oldValue: currentValue,
      newValue: storedValue,
      dryRun: true,
    };
    if (warning) result.warning = warning;
    return result;
  }

  // Apply the change
  parent[leafKey] = storedValue;

  // Persist. Une écriture refusée ne reste ni en mémoire ni sur le fichier actif.
  try {
    configManager.saveUserConfig(keyPath, storedValue);
  } catch (err) {
    parent[leafKey] = currentValue;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to save config after setting "${keyPath}": ${message}`, { source: 'ConfigMutator' });
    return failure(keyPath, storedValue, dryRun, message, currentValue);
  }

  const visible = isSecretReference(storedValue) ? '"[référence]"' : JSON.stringify(storedValue);
  logger.info(`Config set: ${keyPath} = ${visible}`, { source: 'ConfigMutator' });

  const result: ConfigSetResult = {
    success: true,
    key: keyPath,
    oldValue: currentValue,
    newValue: storedValue,
    dryRun: false,
  };
  if (warning) result.warning = warning;
  return result;
}

/**
 * Set multiple config values from a batch JSON object.
 * Keys are dot-notation paths, values are the new values.
 *
 * @param batch - Record of keyPath → value pairs
 * @param opts - Options (dryRun, json)
 */
export async function setConfigBatch(
  batch: Record<string, unknown>,
  opts?: ConfigSetOptions,
): Promise<ConfigSetResult[]> {
  const results: ConfigSetResult[] = [];

  for (const [keyPath, value] of Object.entries(batch)) {
    const result = await setConfigValue(keyPath, value, opts);
    results.push(result);
  }

  return results;
}

/**
 * Fusionne un objet dans la couche utilisateur seule.
 * Un scalaire remplace la cible. `null` retire la clé.
 * La couche projet n'est pas relue pour construire la valeur écrite.
 */
export async function patchConfigValue(
  keyPath: string,
  value: unknown,
  opts?: ConfigSetOptions,
): Promise<ConfigSetResult> {
  const dryRun = opts?.dryRun ?? false;
  if (value === null) return unsetConfigValue(keyPath, opts);
  if (!isRecord(value)) return setConfigValue(keyPath, value, opts);

  const leaves = patchLeaves(keyPath, value);
  for (const [leaf, leafValue] of leaves) {
    if (leafValue === null) {
      const classified = classifyConfigPath(leaf);
      if (!classified.ok) {
        await noteRejection(leaf, classified.message, dryRun);
        return failure(keyPath, value, dryRun, classified.message);
      }
      continue;
    }
    const classified = classifyConfigPath(leaf);
    if (!classified.ok) {
      await noteRejection(leaf, classified.message, dryRun);
      return failure(keyPath, value, dryRun, classified.message);
    }
    const schemaError = validateConfigValue(leaf, leafValue);
    if (schemaError) {
      await noteRejection(leaf, schemaError, dryRun);
      return failure(keyPath, value, dryRun, schemaError);
    }
  }

  const configManager = await lazyGetConfigManager() as {
    readUserConfigDocument?: () => Record<string, unknown>;
    saveUserConfig: (keyPath?: string, value?: unknown) => void;
    getConfig: () => CodeBuddyConfig;
    previewUserWrite?: (keyPath: string, value: unknown) => string | null;
  };
  const userDocument = configManager.readUserConfigDocument?.() ?? {};
  const oldValue = readAt(userDocument, keyPath);
  const merged = mergePatch(oldValue, value);
  if (dryRun) {
    const problem = configManager.previewUserWrite?.(keyPath, merged) ?? null;
    if (problem) return failure(keyPath, value, true, problem, oldValue);
    return {
      success: true,
      key: keyPath,
      oldValue,
      newValue: merged,
      dryRun: true,
    };
  }
  try {
    configManager.saveUserConfig(keyPath, merged);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(keyPath, value, false, message, oldValue);
  }
  return {
    success: true,
    key: keyPath,
    oldValue,
    newValue: merged,
    dryRun: false,
  };
}

/** Retire une clé du fichier utilisateur. N'écrit pas `undefined`. */
export async function unsetConfigValue(
  keyPath: string,
  opts?: ConfigSetOptions,
): Promise<ConfigSetResult> {
  const dryRun = opts?.dryRun ?? false;
  const classified = classifyConfigPath(keyPath);
  if (!classified.ok) {
    await noteRejection(keyPath, classified.message, dryRun);
    return failure(keyPath, undefined, dryRun, classified.message);
  }
  const configManager = await lazyGetConfigManager() as {
    readUserConfigDocument?: () => Record<string, unknown>;
    saveUserConfig: (keyPath?: string, value?: unknown) => void;
    getConfig: () => CodeBuddyConfig;
  };
  const userDocument = configManager.readUserConfigDocument?.() ?? {};
  const oldValue = readAt(userDocument, keyPath);
  if (dryRun) {
    return { success: true, key: keyPath, oldValue, newValue: undefined, dryRun: true };
  }
  try {
    configManager.saveUserConfig(keyPath, USER_CONFIG_DELETE);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(keyPath, undefined, false, message, oldValue);
  }
  const memory = configManager.getConfig() as unknown as Record<string, unknown>;
  const parts = keyPath.split('.');
  let cursor: unknown = memory;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!isRecord(cursor)) {
      cursor = undefined;
      break;
    }
    cursor = cursor[parts[index] ?? ''];
  }
  if (isRecord(cursor)) delete cursor[parts[parts.length - 1] ?? ''];
  return { success: true, key: keyPath, oldValue, newValue: undefined, dryRun: false };
}
