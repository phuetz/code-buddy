/**
 * Persona registry — a host holds several profiles (multi-persona, multi-user)
 * and resolves one by id. Every profile that enters is validated first, so an
 * invalid JSON never reaches a prompt.
 *
 * @module persona/registry
 */

import type { CompanionProfile, GreetingSlot, PersonaId, RapportTier } from '../types.js';
import type { Rng } from '../runtime/rng.js';
import { loadPersonaProfile, safeLoadPersonaProfile, type LoadResult } from './schema.js';
import { COPINE_PROFILE } from './copine.js';

export interface PersonaRegistry {
  /** The profile for `id`, or null when unknown. */
  get(id: PersonaId | null | undefined): CompanionProfile | null;
  /** Validate and add (or replace) a profile. Throws on an invalid one. */
  register(profile: unknown): CompanionProfile;
  /** Same, without throwing. */
  tryRegister(profile: unknown): LoadResult;
  /** Registered ids, sorted. */
  ids(): PersonaId[];
}

/** Build a registry. Seeded profiles are validated on the way in. */
export function createPersonaRegistry(seed: readonly unknown[] = [COPINE_PROFILE]): PersonaRegistry {
  const byId = new Map<PersonaId, CompanionProfile>();
  const register = (profile: unknown): CompanionProfile => {
    const parsed = loadPersonaProfile(profile);
    byId.set(parsed.id, parsed);
    return parsed;
  };
  for (const profile of seed) register(profile);
  return {
    get: (id) => (id ? byId.get(id) ?? null : null),
    register,
    tryRegister: (profile) => {
      const result = safeLoadPersonaProfile(profile);
      if (result.ok) byId.set(result.profile.id, result.profile);
      return result;
    },
    ids: () => [...byId.keys()].sort(),
  };
}

/**
 * Fill the `{{name}}` slot. With no name the token is removed cleanly — a
 * companion never says « Bonjour undefined », and a first name is never baked in.
 */
export function interpolateName(text: string, name?: string | null): string {
  const clean = (name ?? '').trim();
  if (!clean) {
    return text
      .replace(/,?\s*\{\{name\}\}/g, '')
      .replace(/\{\{name\}\}/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return text.replace(/\{\{name\}\}/g, clean);
}

/** The pool behind a greeting slot. */
export function greetingPool(profile: CompanionProfile, slot: GreetingSlot): readonly string[] {
  return profile.greetings[slot] ?? [];
}

export interface PickLineOptions {
  /** Injected randomness (default `Math.random`). */
  rng?: Rng;
  /** Openers already used recently — those lines are skipped when possible. */
  avoid?: readonly string[];
  /** Name for the `{{name}}` slot. */
  name?: string | null;
}

/** Normalised opening key of a line — the anti-repetition unit (first 4 words). */
export function openerKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ');
}

/**
 * Pick a line from a pool, preferring one whose opener was not used recently.
 * Falls back to the full pool rather than staying silent.
 */
export function pickLine(pool: readonly string[], options: PickLineOptions = {}): string {
  if (pool.length === 0) return '';
  const rng = options.rng ?? Math.random;
  const used = new Set((options.avoid ?? []).map((line) => openerKey(line)));
  const fresh = pool.filter((line) => !used.has(openerKey(line)));
  const list = fresh.length > 0 ? fresh : pool;
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  return interpolateName(list[index] ?? '', options.name);
}

/** Pick a greeting for a slot. */
export function pickGreeting(
  profile: CompanionProfile,
  slot: GreetingSlot,
  options: PickLineOptions = {},
): string {
  return pickLine(greetingPool(profile, slot), options);
}

/** The nicknames a tier allows — empty at the tiers where a nickname would be premature. */
export function nicknamesForTier(profile: CompanionProfile, tier: RapportTier): readonly string[] {
  return profile.nicknames[tier] ?? [];
}
