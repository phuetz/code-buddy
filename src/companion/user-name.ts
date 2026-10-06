/**
 * User name resolution — the single source of truth for the user's form of address.
 *
 * The companion (Lisa) addresses the user by name in prompts, spoken lines, and
 * guidance. That name must NOT be hardcoded: it is configurable via
 * `CODEBUDDY_USER_NAME` (same env the arrival opener already reads) and editable
 * from the Assistant config panel. Every companion/voice surface should call
 * `resolveUserName()` instead of embedding a literal name.
 *
 * @module companion/user-name
 */

/** Neutral default when no name is configured. */
export const DEFAULT_USER_NAME = 'l’utilisateur';

/**
 * The user's configured name when set, else a neutral form of address. Pure
 * (env injectable for tests). Never returns an empty string.
 */
export function resolveUserName(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.CODEBUDDY_USER_NAME ?? '').trim();
  return configured || DEFAULT_USER_NAME;
}
