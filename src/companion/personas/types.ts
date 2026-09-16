/**
 * Companion persona profile — data, not code. The runtime selects a profile via
 * CODEBUDDY_COMPANION_PERSONA (default unset = current hardcoded pools, byte-identical).
 *
 * @module companion/personas/types
 */

export type CompanionPersonaId = 'copine';

export type CompanionGreetingSlot =
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'backSoon'
  | 'drowsy';

export type CompanionNicknameTier = 'nouveau' | 'familier' | 'complice' | 'vieil ami';

export type CompanionAwayAngle = 'morning' | 'thought' | 'evening';

/** Phrase pools + spoken register for one companion persona. No intimate copy. */
export interface CompanionPersonaProfile {
  id: CompanionPersonaId;
  /** Short spoken-prompt overlay (no XML, no scores, no intimate register). */
  spokenPrompt: string;
  /** Tone / register line injected on the voice path. */
  register: string;
  nicknames: Record<CompanionNicknameTier, readonly string[]>;
  greetings: Record<CompanionGreetingSlot, readonly string[]>;
  goodNight: readonly string[];
  hardDay: readonly string[];
  success: readonly string[];
  /** Compact voice spine (replaces the default xAI spine when this persona is active). */
  voiceSpine: string;
  fewShots: string;
  intimacyByTier: Record<CompanionNicknameTier, string>;
  away: Record<CompanionAwayAngle, readonly string[]>;
  /** Captions attached to a cache-served selfie (no intimate copy). */
  selfieCaptions: readonly string[];
  /** Polite refusals when an explicit request is blocked by the adult gate. */
  selfieRefusals: readonly string[];
  /** Lines when the allowed-tier cache is empty. */
  selfieEmpty: readonly string[];
}
