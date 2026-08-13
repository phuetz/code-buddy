/**
 * Channel secret resolution.
 *
 * A channel's auth token can come from two places:
 *   - the ENCRYPTED secret store the Cowork GUI writes to when you configure a
 *     channel in the Channels panel (`CredentialManager`, AES-256-GCM,
 *     `~/.codebuddy/credentials.enc`) under the key `channel:<type>:token`.
 *   - an explicit legacy literal token in `channels.json` (or an env-derived value),
 *
 * The core channel loader historically read `config.token` literally, so a
 * channel configured purely through the GUI (encrypted token, no plaintext in
 * `channels.json`) started with NO token and never authenticated. This helper
 * closes that gap with a strict priority order that makes rotations effective:
 *
 *   1. the encrypted `channel:<type>:token` secret from the CredentialManager.
 *   2. `config.token` literal as a migration fallback.
 *   3. `undefined` — no token (channel stays unauthenticated, unchanged legacy
 *      behavior).
 *
 * Contract:
 *   - never throws: an unavailable/uninitialised CredentialManager or a missing
 *     key falls back to the legacy literal, then to "no token".
 *   - never logs the resolved secret value.
 */

import { getCredentialManager } from '../security/credential-manager.js';

/**
 * The exact CredentialManager key the Cowork Channels panel stores a channel's
 * token under (`cowork/src/main/ipc/channels-ipc.ts` → `channelSecretKey`).
 * Kept in one place so both sides can't drift.
 */
export function channelSecretKey(type: string, name = 'token'): string {
  return `channel:${type}:${name}`;
}

/** The minimal shape `resolveChannelSecret` reads from a channel config. */
export interface ChannelSecretConfig {
  token?: string;
}

/**
 * Resolve a channel's auth token, preferring the encrypted vault over a legacy
 * literal. The Cowork writer purges that literal after the first successful
 * save; vault-first resolution also keeps a rotation effective if cleanup fails.
 * See the file header for the full contract.
 */
export function resolveChannelSecret(
  type: string,
  config: ChannelSecretConfig,
): string | undefined {
  // 1. Prefer the encrypted secret the Cowork GUI stored for this channel.
  try {
    const creds = getCredentialManager();
    const key = channelSecretKey(type);
    if (creds.hasCredential(key)) {
      const resolved = creds.getCredential(key);
      if (resolved) {
        return resolved;
      }
    }
  } catch {
    // never-throws: CredentialManager unavailable / uninitialised → try the
    // legacy literal below. The secret is never logged.
  }

  // 2. Migration fallback for hand-written / historical channels.json files.
  return config.token || undefined;
}

/**
 * Resolve a channel-specific secret stored in the encrypted credential vault.
 *
 * Primary credentials (for example `appPassword` on Teams) historically used
 * the generic `channel:<type>:token` key, so callers can opt into that fallback
 * while secondary credentials remain isolated under their own name. Vault
 * values take precedence so replacing a historical literal is effective.
 */
export function resolveChannelNamedSecret(
  type: string,
  name: string,
  literal?: unknown,
  fallbackToPrimary = false,
): string | undefined {
  try {
    const credentials = getCredentialManager();
    const named = credentials.getCredential(channelSecretKey(type, name));
    if (named) return named;
    if (fallbackToPrimary && name !== 'token') {
      const primary = credentials.getCredential(channelSecretKey(type));
      if (primary) return primary;
    }
  } catch {
    // Never throw or log a secret-resolution failure. The channel constructor
    // will surface a missing required credential through its normal validation.
  }

  return typeof literal === 'string' && literal ? literal : undefined;
}
