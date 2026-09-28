/**
 * Apply the `env` defaults of the profile named by `--profile <name>`.
 *
 * Named profiles (`local`, `cloud`, `fleet`, `max`, or any `[profiles.<name>]`
 * of config.toml) group advanced settings that are otherwise individual
 * environment variables. The rule that keeps existing setups intact: a profile
 * only fills a variable that is NOT already set — an exported variable, or one
 * loaded from `.env`, always wins.
 */

import { getConfigManager, resolveProfileEntry } from '../config/toml-config.js';
import { getRequestedProfile } from './requested-profile.js';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Pure core: returns the variables that were set (name → value). */
export function applyProfileEnvDefaults(
  profileEnv: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const applied: Record<string, string> = {};
  if (!profileEnv || typeof profileEnv !== 'object' || Array.isArray(profileEnv)) return applied;
  for (const [name, raw] of Object.entries(profileEnv as Record<string, unknown>)) {
    if (!ENV_NAME.test(name)) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;
    if (env[name] !== undefined) continue; // explicit configuration keeps priority
    const value = String(raw);
    env[name] = value;
    applied[name] = value;
  }
  return applied;
}

/**
 * Resolve the `--profile` of `argv` and apply its `env` defaults. Never
 * throws: an unknown profile is already reported by `preloadRequestedProfile`.
 */
export function applyRequestedProfileEnv(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): { profile?: string; applied: Record<string, string> } {
  const requested = getRequestedProfile(argv);
  if (requested.kind !== 'value') return { applied: {} };
  try {
    const entry = resolveProfileEntry(getConfigManager().getConfig().profiles, requested.name);
    return { profile: requested.name, applied: applyProfileEnvDefaults(entry?.env, env) };
  } catch {
    return { profile: requested.name, applied: {} };
  }
}
