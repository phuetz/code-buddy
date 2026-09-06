/**
 * Bridge to `@phuetz/companion-core` — the portable relational core extracted
 * from this repository so the robot and a future multi-persona app share ONE
 * implementation instead of two that drift.
 *
 * Step 1 of the migration: the core is wired but not yet load-bearing. The
 * historical modules (`personas/`, `relationship-state.ts`, `reply-augment.ts`)
 * stay exactly where they are, and this adapter is **opt-in** with
 * `CODEBUDDY_COMPANION_CORE=true`. Unset ⇒ every call here delegates to the
 * historical path and the behaviour is byte-identical (asserted by tests).
 *
 * The package is loaded **dynamically**, only once the flag is on. A published
 * install that does not carry it therefore never resolves it, and a missing or
 * broken core falls back to the historical path with a single warning rather
 * than taking the companion down.
 *
 * @module companion/core-adapter
 */

import type * as CompanionCore from '@phuetz/companion-core';
import { isCopinePersona, resolveCompanionPersona } from './personas/index.js';
import type { CompanionPersonaProfile } from './personas/types.js';
import {
  evolveTraits,
  type RelationalSignal,
  type RelationshipState,
} from './relationship-state.js';
import { applyLimitsContract, LIMITS_REPAIRS, type LimitsVerdict } from './reply-augment.js';
import { logger } from '../utils/logger.js';

type CoreModule = typeof CompanionCore;

let cached: CoreModule | null = null;
let loadFailed = false;

/** True when the operator opted into routing through the extracted core. */
export function companionCoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CODEBUDDY_COMPANION_CORE ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/**
 * Load the core once. Returns null when the flag is off, when the package is
 * absent, or when it failed to load — the caller then keeps the historical path.
 */
export async function loadCompanionCore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CoreModule | null> {
  if (!companionCoreEnabled(env)) return null;
  if (cached) return cached;
  if (loadFailed) return null;
  try {
    cached = (await import('@phuetz/companion-core')) as CoreModule;
    return cached;
  } catch (error) {
    loadFailed = true;
    logger.warn(
      `[companion-core] paquet indisponible, repli sur le chemin historique : ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/** Test seam: drop the memoized module and the failure latch. */
export function resetCompanionCoreCache(): void {
  cached = null;
  loadFailed = false;
}

/**
 * The active persona profile, routed through the core's Zod schema when the flag
 * is on. The core adds a `locale`; the profile handed back to callers is the
 * repository's own object, so pools and prompts are unchanged either way.
 */
export async function resolveCompanionPersonaViaCore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompanionPersonaProfile | null> {
  const historical = resolveCompanionPersona(env);
  const core = await loadCompanionCore(env);
  if (!core || !historical) return historical;
  const validated = core.safeLoadPersonaProfile(historical);
  if (!validated.ok) {
    logger.warn(`[companion-core] profil « ${historical.id} » refusé : ${validated.issues.join(' ; ')}`);
    return historical;
  }
  return historical;
}

/**
 * Validate a persona profile against the core schema. Returns the issues rather
 * than throwing, so a host can surface them in a doctor command.
 */
export async function validateCompanionPersona(
  profile: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true } | { ok: false; issues: string[] }> {
  const core = await loadCompanionCore(env);
  if (!core) return { ok: true };
  const result = core.safeLoadPersonaProfile(profile);
  return result.ok ? { ok: true } : { ok: false, issues: result.issues };
}

/** Trait drift, routed through the core when the flag is on. Same numbers. */
export async function evolveTraitsViaCore(
  state: RelationshipState,
  signal: RelationalSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RelationshipState> {
  const core = await loadCompanionCore(env);
  if (!core) return evolveTraits(state, signal);
  return core.evolveRelationship(state, signal) as RelationshipState;
}

/**
 * The output limits contract. The core has no environment gate, so the persona
 * gate is applied here — off, or outside the copine persona, the reply is
 * returned untouched exactly as before.
 */
export async function applyLimitsContractViaCore(
  output: string,
  opts: { heard?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<LimitsVerdict> {
  const env = opts.env ?? process.env;
  const core = await loadCompanionCore(env);
  if (!core) return applyLimitsContract(output, opts);
  if (!isCopinePersona(env)) return { text: output };
  // Le paquet décide QUEL motif est refusé ; la phrase de réparation reste celle
  // de ce dépôt, mot pour mot — d'où le verdict identique au chemin historique.
  const verdict = core.applyLimitsContract(output, {
    repairs: LIMITS_REPAIRS,
    ...(opts.heard ? { heard: opts.heard } : {}),
  });
  return verdict.reason ? { text: verdict.text, reason: verdict.reason } : { text: verdict.text };
}
