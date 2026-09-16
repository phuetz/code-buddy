/**
 * The five nouns of the relational core. Every module below speaks these types
 * and nothing else — no host object, no ORM row, no React prop ever crosses in.
 *
 * @module types
 */

/** Stable identifier of a persona profile (`copine`, …). */
export type PersonaId = string;

/** Time-of-day / situation slot a greeting pool answers. */
export type GreetingSlot =
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'backSoon'
  | 'drowsy';

/**
 * How familiar the companion may be. Derived from shared history, never from a
 * score the user can farm: it shifts PHRASING, it is not a level.
 */
export type RapportTier = 'nouveau' | 'familier' | 'complice' | 'vieil ami';

/** The three angles a capped away-day may spend, at most once each. */
export type InitiativeAngle = 'morning' | 'thought' | 'evening';

/**
 * A persona profile: DATA, not behaviour. Phrase pools plus a spoken register.
 * A host may ship its own profiles; the schema is what the core enforces.
 */
export interface CompanionProfile {
  id: PersonaId;
  /** BCP-47-ish language tag of the pools (`fr`, `en`, …). */
  locale: string;
  /** Short spoken-prompt overlay. No markup, no scores, no intimate copy. */
  spokenPrompt: string;
  /** One-line tone/register instruction for the voice path. */
  register: string;
  /** Terms of endearment per rapport tier. May be empty at the lowest tiers. */
  nicknames: Record<RapportTier, readonly string[]>;
  /** Greeting pools per slot. */
  greetings: Record<GreetingSlot, readonly string[]>;
  goodNight: readonly string[];
  /** What to say when the day was hard: welcome before repairing. */
  hardDay: readonly string[];
  /** What to say on a success: one beat, not a speech. */
  success: readonly string[];
  /** Compact character spine injected on the voice path. */
  voiceSpine: string;
  /** A handful of few-shot exchanges. */
  fewShots: string;
  /** Register sentence per rapport tier. */
  intimacyByTier: Record<RapportTier, string>;
  /** Pools for capped, out-of-home initiatives. */
  away: Record<InitiativeAngle, readonly string[]>;
}

/** Traits (0–100) that DRIFT with the kind of time spent together. */
export interface RelationshipTraits {
  /** Tenderness / closeness. */
  warmth: number;
  /** Playfulness. */
  humor: number;
  /** How deep the exchanges get. */
  depth: number;
  /** Liveliness. */
  energy: number;
}

/**
 * The numeric relational state. Every field decays toward a baseline: nothing
 * here ratchets, and none of it is ever spoken as a number.
 */
export interface RelationshipState {
  /** Epoch ms of the first meeting (set once). */
  firstSeenAt?: number;
  /** Epoch ms of the last confirmed presence. */
  lastPresentAt?: number;
  /** Tenure marks already celebrated, so each fires exactly once. */
  celebratedMilestones: number[];
  /** Expressive mood 0–100 (~60 = content). Presentation, not sentience. */
  mood?: number;
  /** Drifting traits; partial so an older record loads unchanged. */
  traits?: Partial<RelationshipTraits>;
  /** Reunions counted, hard-capped. Drives the phrasing tier, never a reward. */
  sessions?: number;
  /** Civil date (YYYY-MM-DD) of the last mood step, for the gentle wake reset. */
  moodLocalDate?: string;
}

/** Where a remembered fact came from — it gates pinning and soft forgetting. */
export type FactProvenance = 'explicit' | 'confirmed' | 'inferred';

/** One line of the « what matters » sheet. Named, dated, sourced, weighted. */
export interface Fact {
  /** Stable slug, unique within the sheet. */
  key: string;
  /** Plain language. No jargon, no score, no clinical claim. */
  value: string;
  provenance: FactProvenance;
  /** Free-form channel or origin (`voice`, `chat`, …). */
  source?: string;
  /** Epoch ms first recorded. */
  at: number;
  /** Epoch ms last written or reconfirmed. */
  updatedAt: number;
  /** 0..1. Reconfirmation raises it; soft forgetting lowers it. */
  confidence: number;
  /** Pinned facts never fade and are never evicted. */
  pinned: boolean;
}

/** One planned outreach: which angle, which line, when. */
export interface Initiative {
  angle: InitiativeAngle;
  line: string;
  /** Epoch ms the initiative was planned for. */
  at: number;
}

/** Why the output guard rewrote a reply (or `undefined` when it did not). */
export type LimitsReason = 'medical' | 'guilt' | 'fomo' | 'unlock' | 'human-claim';

/** Result of the output limits contract. */
export interface LimitsVerdict {
  /** The reply to actually emit — the original, or its repair. */
  text: string;
  /** Set only when the text was replaced. */
  reason?: LimitsReason;
  /** True when `text` differs from the input. */
  repaired: boolean;
}
