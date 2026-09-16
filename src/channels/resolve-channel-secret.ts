/**
 * Channel secret resolution.
 *
 * A channel's auth token can come from two places:
 *   - an explicit literal token in `channels.json` (or an env-derived value),
 *   - the ENCRYPTED secret store the Cowork GUI writes to when you configure a
 *     channel in the Channels panel (`CredentialManager`, AES-256-GCM,
 *     `~/.codebuddy/credentials.enc`) under the key `channel:<type>:token`.
 *
 * The core channel loader historically read `config.token` literally, so a
 * channel configured purely through the GUI (encrypted token, no plaintext in
 * `channels.json`) started with NO token and never authenticated. This helper
 * closes that gap with a strict priority order (additive / backwards compatible):
 *
 *   1. `config.token` literal — a hand-written `channels.json` or env-provided
 *      token stays authoritative; the encrypted store is never consulted.
 *   2. the encrypted `channel:<type>:token` secret from the CredentialManager.
 *   3. the documented process env var (`TELEGRAM_BOT_TOKEN` for Telegram).
 *   4. `undefined` — no token (channel stays unauthenticated, unchanged legacy
 *      behavior).
 *
 * Contract:
 *   - never throws: an unavailable/uninitialised CredentialManager or a missing
 *     key falls back to the legacy "no token" behavior.
 *   - never logs the resolved secret value.
 */

import { getCredentialManager } from '../security/credential-manager.js';

/**
 * The exact CredentialManager key the Cowork Channels panel stores a channel's
 * token under (`cowork/src/main/ipc/channels-ipc.ts` → `channelSecretKey`).
 * Kept in one place so both sides can't drift.
 */
export function channelSecretKey(type: string): string {
  return `channel:${type}:token`;
}

const CHANNEL_ENV_TOKENS: Record<string, string> = {
  telegram: 'TELEGRAM_BOT_TOKEN',
};

/** Documented env var that can supply a channel token (Telegram: TELEGRAM_BOT_TOKEN). */
export function channelEnvToken(type: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = CHANNEL_ENV_TOKENS[type];
  if (!name) return undefined;
  const value = env[name]?.trim();
  return value || undefined;
}

/** The minimal shape `resolveChannelSecret` reads from a channel config. */
export interface ChannelSecretConfig {
  token?: string;
}

/**
 * Resolve a channel's auth token, preferring an explicit literal over the
 * encrypted CredentialManager store. See the file header for the full contract.
 */
export function resolveChannelSecret(
  type: string,
  config: ChannelSecretConfig,
): string | undefined {
  // 1. A literal token always wins — full backwards compatibility. A
  //    hand-written channels.json (or env-derived token) behaves exactly as
  //    before and the encrypted store is never read.
  if (config.token) {
    return config.token;
  }

  // 2. Fall back to the encrypted secret the Cowork GUI stored for this channel.
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
    // never-throws: CredentialManager unavailable / uninitialised → behave as
    // if no token was configured (legacy behavior). The secret is never logged.
  }

  // 3. Documented env var (TELEGRAM_BOT_TOKEN, …) — what `docs/channels.md` tells
  //    a stranger to set. Never logged.
  const fromEnv = channelEnvToken(type);
  if (fromEnv) {
    return fromEnv;
  }

  // 4. No token — channel stays unauthenticated (unchanged legacy behavior).
  return undefined;
}
