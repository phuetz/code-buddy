/**
 * `@phuetz/companion-core` — the relational core of an AI companion, in fifteen calls.
 *
 *  1. `loadPersonaProfile(json)`         → a validated `CompanionProfile` (Zod).
 *  2. `createPersonaRegistry(profiles)`  → `.get(id)` for a multi-persona host.
 *  3. `pickGreeting(profile, slot, o)`   → a greeting, avoiding what was just said.
 *  4. `detectEmotion(heard)`             → `{ emotion, intensity, confidence }`.
 *  5. `detectRelationalSignal(heard)`    → the coarse drift signal.
 *  6. `evolveRelationship(state, sig)`   → a new `RelationshipState`; it drifts, never ratchets.
 *  7. `evolveRelationshipWithDayInertia` → same, with a coherent daily mood.
 *  8. `rapportTier(sessions)`            → phrasing tier — never a score, never spoken.
 *  9. `remember(sheet, fact, now)`       → the « what matters » sheet; clinical claims refused.
 * 10. `recall(sheet, options)`           → strongest facts first, pinned ones on top.
 * 11. `forget(sheet, key)` / `applySoftForgetting(sheet, now)` → deletion, and gentle fading.
 * 12. `planInitiative({state, clock, profile})` → may I write first, and with which line.
 * 13. `isPauseRequest(text)` / `pauseInitiatives(state, now)` → the 24 h stop.
 * 14. `applyLimitsContract(output, {heard})` → the output guard → `LimitsVerdict`.
 * 15. `WhatMattersMemory({store, clock})`  → the same sheet, persisted through a `KeyValueStore`.
 *
 * Pure TypeScript: no UI, no network, no filesystem. Time, randomness and storage
 * are injected (`Clock`, `Rng`, `KeyValueStore`), so every behaviour is testable
 * and a host owns its own persistence.
 *
 * @module @phuetz/companion-core
 */

export const COMPANION_CORE_VERSION = '0.1.0';

// ── types ────────────────────────────────────────────────────────────────────
export type {
  CompanionProfile,
  Fact,
  FactProvenance,
  GreetingSlot,
  Initiative,
  InitiativeAngle,
  LimitsReason,
  LimitsVerdict,
  PersonaId,
  RapportTier,
  RelationshipState,
  RelationshipTraits,
} from './types.js';

// ── runtime seams ────────────────────────────────────────────────────────────
export type { Clock, CivilClock } from './runtime/clock.js';
export { fixedClock, resolveCivilClock } from './runtime/clock.js';
export type { Rng } from './runtime/rng.js';
export { constantRng, seededRng } from './runtime/rng.js';
export type { KeyValueStore } from './runtime/store.js';
export { MemoryKeyValueStore } from './runtime/store.js';

// ── persona ──────────────────────────────────────────────────────────────────
export {
  companionProfileSchema,
  GREETING_SLOTS,
  INITIATIVE_ANGLES,
  loadPersonaProfile,
  RAPPORT_TIERS,
  safeLoadPersonaProfile,
  safeLoadPersonaProfileJson,
} from './persona/schema.js';
export type { LoadResult } from './persona/schema.js';
export { COPINE_PROFILE } from './persona/copine.js';
export {
  createPersonaRegistry,
  greetingPool,
  interpolateName,
  nicknamesForTier,
  openerKey,
  pickGreeting,
  pickLine,
} from './persona/registry.js';
export type { PersonaRegistry, PickLineOptions } from './persona/registry.js';

// ── relationship ─────────────────────────────────────────────────────────────
export {
  DECAY,
  DEFAULT_TRAITS,
  MAX_MOOD_STEP_PER_TURN,
  MAX_RELATIONSHIP_SESSIONS,
  MILESTONE_DAYS,
  MOOD_BASELINE,
  MOOD_INERTIA,
  REUNION_DAYS,
  daysBetween,
  describeRapport,
  emptyRelationshipState,
  evolveRelationship,
  evolveRelationshipWithDayInertia,
  markMilestonesUpTo,
  moodBand,
  normalizeRelationshipState,
  pendingMilestone,
  personalityOf,
  rapportTier,
  recordReunion,
  relationshipSummary,
} from './relationship/state.js';
export type { MoodBand, RelationalSignal } from './relationship/state.js';
export {
  STRONG_EMOTION_CONFIDENCE,
  detectEmotion,
  detectRelationalSignal,
  emotionToSignal,
  normalizeUtterance,
} from './relationship/emotion.js';
export type { Emotion, EmotionRead } from './relationship/emotion.js';

// ── memory ───────────────────────────────────────────────────────────────────
export {
  FORGET_FLOOR,
  MAX_FACTS,
  SOFT_FORGET_HALF_LIFE_DAYS,
  applySoftForgetting,
  describeWhatMatters,
  forget,
  isClinicalClaim,
  normalizeSheet,
  recall,
  remember,
} from './memory/what-matters.js';
export type {
  RecallOptions,
  RememberInput,
  RememberResult,
  WhatMattersSheet,
} from './memory/what-matters.js';
export { WhatMattersMemory } from './memory/store.js';
export type { WhatMattersOptions } from './memory/store.js';

// ── initiative ───────────────────────────────────────────────────────────────
export {
  DEFAULT_INITIATIVE_POLICY,
  angleForHour,
  emptyInitiativeState,
  inWindow,
  isHotThread,
  isPauseRequest,
  isPaused,
  isShameLine,
  nextAngle,
  normalizeInitiativeState,
  noteInbound,
  pauseInitiatives,
  planInitiative,
  recordInitiative,
  rollInitiativeDay,
} from './initiative/planner.js';
export type {
  InitiativePlan,
  InitiativePolicy,
  InitiativeState,
  PlanInput,
  PlanRefusal,
} from './initiative/planner.js';
export {
  DEFAULT_INACTIVITY_DAYS,
  evaluateTriggers,
  interpolate,
  pickTrigger,
} from './initiative/triggers.js';
export type { InitiativeTrigger, TriggerCandidate, TriggerContext } from './initiative/triggers.js';

// ── limits ───────────────────────────────────────────────────────────────────
export {
  LIMITS_REPAIRS,
  applyLimitsContract,
  containsGamification,
  isFrankIdentityQuestion,
  limitsContractGuidance,
} from './limits/contract.js';
export type { LimitsLocale, LimitsOptions } from './limits/contract.js';
