/**
 * Resolve deploy tokens from the environment, then the existing encrypted vault.
 * Values are never logged and never written by this module.
 */

import { peekSecret } from '../commands/cli/secrets-command.js';
import type { OneClickDeps } from './one-click-types.js';

export async function resolveFirstSecret(
  names: readonly string[],
  deps: Pick<OneClickDeps, 'env' | 'resolveToken'> = {},
): Promise<{ name: string; value: string; source: 'env' | 'vault' } | null> {
  if (deps.resolveToken) {
    return deps.resolveToken(names);
  }
  const env = deps.env ?? process.env;
  for (const name of names) {
    const fromEnv = env[name];
    if (fromEnv && fromEnv.length > 0) {
      return { name, value: fromEnv, source: 'env' };
    }
  }
  for (const name of names) {
    const fromVault = await peekSecret(name, env);
    if (fromVault && fromVault.length > 0) {
      return { name, value: fromVault, source: 'vault' };
    }
  }
  return null;
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    if (secret.length < 4) continue;
    out = out.split(secret).join('***');
  }
  return out.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');
}
