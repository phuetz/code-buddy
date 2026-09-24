/**
 * Préchargement de `--profile`, avant l'analyse Commander.
 * Le fichier lu est celui de `resolveUserConfigFile` : `CODEBUDDY_CONFIG`,
 * puis `$CODEBUDDY_HOME/.codebuddy/config.toml`, puis `~/.codebuddy/config.toml`.
 */

import { getConfigManager, profileNamesOf } from '../config/toml-config.js';
import { getRequestedProfile } from './requested-profile.js';

export function preloadRequestedProfile(
  argv: readonly string[] = process.argv,
  stderr: { write(chunk: string): void } = process.stderr,
): void {
  const requestedProfile = getRequestedProfile(argv);
  if (requestedProfile.kind === 'missing') {
    try {
      getConfigManager().load();
    } catch (_error) {
      // Listing available names is best-effort; the missing-value error still stands.
    }
    let available = '(none defined)';
    try {
      const names = profileNamesOf(getConfigManager().getConfig().profiles);
      if (names.length) available = names.join(', ');
    } catch (_error) {
      available = 'core, all';
    }
    stderr.write(
      `error: option '--profile <name>' argument missing. Available profiles: ${available}\n`,
    );
    process.exitCode = 1;
  } else if (requestedProfile.kind === 'value') {
    try {
      getConfigManager().load();
      getConfigManager().applyProfile(requestedProfile.name);
    } catch (err) {
      stderr.write(`Profile error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  }
}
