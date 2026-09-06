/**
 * Companion persona resolver. Default (unset / unknown) → null, so callers keep
 * the historical pools and prompts (byte-identical).
 *
 * @module companion/personas
 */

import { COPINE_PERSONA } from './copine.js';
import type { CompanionPersonaId, CompanionPersonaProfile } from './types.js';

export type { CompanionAwayAngle, CompanionGreetingSlot, CompanionNicknameTier, CompanionPersonaId, CompanionPersonaProfile } from './types.js';
export { COPINE_PERSONA } from './copine.js';

const COPINE_ID: CompanionPersonaId = 'copine';

/** Read CODEBUDDY_COMPANION_PERSONA. Unknown values are treated as unset. */
export function companionPersonaId(env: NodeJS.ProcessEnv = process.env): CompanionPersonaId | null {
  const raw = (env.CODEBUDDY_COMPANION_PERSONA ?? '').trim().toLowerCase();
  return raw === COPINE_ID ? COPINE_ID : null;
}

export function isCopinePersona(env: NodeJS.ProcessEnv = process.env): boolean {
  return companionPersonaId(env) === COPINE_ID;
}

/** Active companion persona profile, or null when the historical default applies. */
export function resolveCompanionPersona(
  env: NodeJS.ProcessEnv = process.env,
): CompanionPersonaProfile | null {
  return isCopinePersona(env) ? COPINE_PERSONA : null;
}

/**
 * Interpolate `{{name}}` from CODEBUDDY_USER_NAME only. Never falls back to a
 * hardcoded first name: absent env → the token is dropped.
 */
export function interpolatePersonaName(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const name = (env.CODEBUDDY_USER_NAME ?? '').trim();
  if (!name) {
    return text.replace(/,?\s*\{\{name\}\}/g, '').replace(/\{\{name\}\}/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  return text.replace(/\{\{name\}\}/g, name);
}
