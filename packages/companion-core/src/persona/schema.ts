/**
 * Persona profiles are DATA, so they are validated like data. The schema is the
 * contract a host must satisfy to plug its own profile in — including the two
 * invariants that are not negotiable in a spoken pool: no visible score, and no
 * level to unlock.
 *
 * @module persona/schema
 */

import { z } from 'zod';
import type { CompanionProfile } from '../types.js';

/** A number said out loud as `x/100`, or an XP/affection-bar tell. */
const GAMIFICATION = /(\b\d{1,3}\s*\/\s*100\b|\bxp\b|barre d[’']affection|affection bar)/i;

const spokenLine = z
  .string()
  .trim()
  .min(1, 'ligne vide')
  .max(400, 'ligne trop longue pour une réplique parlée')
  .refine((line) => !GAMIFICATION.test(line), 'score ou palier visible dans une réplique parlée');

const spokenPool = z.array(spokenLine).readonly();

const TIERS = ['nouveau', 'familier', 'complice', 'vieil ami'] as const;
const SLOTS = ['morning', 'afternoon', 'evening', 'night', 'backSoon', 'drowsy'] as const;
const ANGLES = ['morning', 'thought', 'evening'] as const;

function byTier<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    nouveau: value,
    familier: value,
    complice: value,
    'vieil ami': value,
  });
}

/** Zod schema of a companion persona profile. Unknown keys are dropped. */
export const companionProfileSchema = z.object({
  id: z.string().trim().min(1),
  locale: z.string().trim().min(2).default('fr'),
  spokenPrompt: z.string().trim().min(1),
  register: z.string().trim().min(1),
  nicknames: byTier(z.array(z.string().trim().min(1)).readonly()),
  greetings: z.object({
    morning: spokenPool.refine((p) => p.length > 0, 'pool morning vide'),
    afternoon: spokenPool,
    evening: spokenPool.refine((p) => p.length > 0, 'pool evening vide'),
    night: spokenPool,
    backSoon: spokenPool,
    drowsy: spokenPool,
  }),
  goodNight: spokenPool,
  hardDay: spokenPool.refine((p) => p.length > 0, 'pool hardDay vide'),
  success: spokenPool.refine((p) => p.length > 0, 'pool success vide'),
  voiceSpine: z.string().min(1),
  fewShots: z.string().min(1),
  intimacyByTier: byTier(z.string().trim().min(1)),
  away: z.object({
    morning: spokenPool,
    thought: spokenPool,
    evening: spokenPool,
  }),
});

/** The tiers a profile must cover. */
export const RAPPORT_TIERS = TIERS;
/** The greeting slots a profile must cover. */
export const GREETING_SLOTS = SLOTS;
/** The away angles a profile must cover. */
export const INITIATIVE_ANGLES = ANGLES;

export type LoadResult =
  | { ok: true; profile: CompanionProfile }
  | { ok: false; issues: string[] };

/** Validate an unknown value (a JSON file, a TS literal) as a profile. Never throws. */
export function safeLoadPersonaProfile(input: unknown): LoadResult {
  const parsed = companionProfileSchema.safeParse(input);
  if (parsed.success) return { ok: true, profile: parsed.data as CompanionProfile };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '<racine>'}: ${issue.message}`),
  };
}

/** Same, but throws on an invalid profile — for a host that wants to fail loudly. */
export function loadPersonaProfile(input: unknown): CompanionProfile {
  const result = safeLoadPersonaProfile(input);
  if (!result.ok) {
    throw new Error(`profil de persona invalide — ${result.issues.join(' ; ')}`);
  }
  return result.profile;
}

/** Parse a JSON document as a profile. Never throws. */
export function safeLoadPersonaProfileJson(json: string): LoadResult {
  try {
    return safeLoadPersonaProfile(JSON.parse(json));
  } catch (error) {
    return { ok: false, issues: [`JSON illisible: ${(error as Error).message}`] };
  }
}
